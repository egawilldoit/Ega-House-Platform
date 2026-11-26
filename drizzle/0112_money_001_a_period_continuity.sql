-- MONEY-001-A F04: period continuity.
--
-- Starting a new financial period and finalizing the previous period are
-- separate operations. A routine write whose booking date is after the current
-- tracking window may continue the calendar:
--
--   tracking --(routine write needs a later date)--> superseded
--   ended    --(routine write needs a later date)--> ended + one tracking successor
--   superseded --(explicit finalization/rollover)--> rolled_over
--   tracking|ended|superseded --(explicit rollover)--> rolled_over
--
-- `superseded` means only that the routine window closed. It carries no
-- finalization reference, no close row, no successor link and no opening, and
-- it is never a reconciliation approval. `ended` keeps the evidence of an
-- explicit final-day close; continuing from it leaves that evidence untouched.
-- Finalization still requires the explicit reviewed rollover transaction.
--
-- This migration is additive: it extends the lifecycle constraint, replaces the
-- period guards, adds the controlled continuation RPC and teaches the explicit
-- rollover to adopt an already-continued successor instead of duplicating it.

ALTER TABLE public.money_periods
  DROP CONSTRAINT IF EXISTS "money_periods_lifecycle_check";
--> statement-breakpoint
ALTER TABLE public.money_periods
  ADD CONSTRAINT "money_periods_lifecycle_check"
  CHECK ("lifecycle" IN ('tracking', 'superseded', 'ended', 'rolled_over'));
--> statement-breakpoint

-- The lifecycle is now written only by definer functions: continuation
-- (`tracking -> superseded`), close (`tracking -> ended`) and rollover
-- (`... -> rolled_over`). A direct authenticated update could otherwise close
-- the routine window or forge finalization state without the matching evidence.
REVOKE UPDATE ("lifecycle") ON TABLE public.money_periods FROM authenticated;
--> statement-breakpoint

-- One owner-scoped lock order shared by the routine write, the continuation and
-- the explicit rollover. Taking every period in ascending (start_date, id)
-- order first means a later single-row lock can only wait behind a transaction
-- that already holds the whole set; no path can hold a later period and then
-- wait for an earlier one. In particular, a routine write must never hold the
-- tracking row while the rollover holds an earlier source and waits for that
-- same tracking row (the old continuation/adoption deadlock).
CREATE OR REPLACE FUNCTION public.money_lock_owner_periods(p_owner uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $period_lock$
BEGIN
  IF p_owner IS NULL THEN
    RAISE EXCEPTION 'An owner is required to lock Money periods.' USING ERRCODE = '42501';
  END IF;
  PERFORM period."id"
  FROM public.money_periods AS period
  WHERE period."owner_user_id" = p_owner
  ORDER BY period."start_date", period."id"
  FOR UPDATE;
END
$period_lock$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_lock_owner_periods(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Period update guard: keep every existing invariant, add the one controlled
-- lifecycle extension and keep the successor link append-only.
CREATE OR REPLACE FUNCTION public.enforce_money_period_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $period_guard$
DECLARE
  v_opening_kind text;
  v_opening_owner uuid;
  v_opening_period uuid;
  v_opening_deleted timestamptz;
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
     OR NEW."start_date" IS DISTINCT FROM OLD."start_date"
     OR NEW."end_date" IS DISTINCT FROM OLD."end_date"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Period identity, boundaries, currency and timezone are immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."version" IS DISTINCT FROM OLD."version" + 1 THEN
    RAISE EXCEPTION 'Period version must increase by exactly one.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (OLD."lifecycle" = 'tracking' AND NEW."lifecycle" IN ('tracking', 'superseded', 'ended', 'rolled_over'))
    OR (OLD."lifecycle" = 'superseded' AND NEW."lifecycle" IN ('superseded', 'rolled_over'))
    OR (OLD."lifecycle" = 'ended' AND NEW."lifecycle" IN ('ended', 'rolled_over'))
    OR (OLD."lifecycle" = 'rolled_over' AND NEW."lifecycle" = 'rolled_over')
  ) THEN
    RAISE EXCEPTION 'Period lifecycle cannot move backwards.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (OLD."initialization" = 'uninitialized' AND NEW."initialization" IN ('uninitialized', 'initialized', 'reconciled'))
    OR (OLD."initialization" = 'initialized' AND NEW."initialization" IN ('initialized', 'reconciled'))
    OR (OLD."initialization" = 'reconciled' AND NEW."initialization" = 'reconciled')
  ) THEN
    RAISE EXCEPTION 'Period initialization cannot lose recorded evidence.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."successor_period_id" IS DISTINCT FROM OLD."successor_period_id" THEN
    IF OLD."successor_period_id" IS NOT NULL
       OR NEW."successor_period_id" IS NULL
       OR NEW."lifecycle" <> 'rolled_over' THEN
      RAISE EXCEPTION 'A period successor link is append-only and requires the rolled_over lifecycle.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."rolled_over_at" IS DISTINCT FROM OLD."rolled_over_at" THEN
    IF OLD."rolled_over_at" IS NOT NULL
       OR NEW."rolled_over_at" IS NULL
       OR NEW."lifecycle" <> 'rolled_over' THEN
      RAISE EXCEPTION 'The rollover timestamp is append-only and requires the rolled_over lifecycle.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW."opening_movement_id" IS NOT NULL THEN
    SELECT movement."kind", movement."owner_user_id", movement."period_id", movement."deleted_at"
      INTO v_opening_kind, v_opening_owner, v_opening_period, v_opening_deleted
      FROM public.personal_expenses AS movement
      WHERE movement."id" = NEW."opening_movement_id";

    IF NOT FOUND
       OR v_opening_kind IS DISTINCT FROM 'opening'
       OR v_opening_owner IS DISTINCT FROM NEW."owner_user_id"
       OR v_opening_period IS DISTINCT FROM NEW."id"
       OR v_opening_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'The period opening reference is invalid.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$period_guard$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_money_period_update() FROM PUBLIC;
--> statement-breakpoint

-- Movement/period coherence. The application refuses a cross-window date edit
-- and the atomic routine function owns `period_id`, but the table itself must
-- also reject a direct stale reference: a row whose booking date is outside the
-- period it names is not an acceptable ledger state.
--
-- Preflight the rows that already exist. Turning the invariant on over bad data
-- would make those rows impossible to correct (their next update fails) and
-- impossible to soft-delete. Fail the migration with an actionable message
-- instead; soft-deleted history is excluded because it is already read-only.
CREATE OR REPLACE FUNCTION public.money_assert_period_booking_dates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $preflight$
DECLARE
  v_invalid integer;
  v_examples text;
BEGIN
  SELECT count(*)::integer,
         string_agg(
           format('%s (%s outside %s–%s)',
             movement."id", movement."booking_date",
             period."start_date", period."end_date"),
           ', ' ORDER BY movement."id"
         )
    INTO v_invalid, v_examples
  FROM public.personal_expenses AS movement
  JOIN public.money_periods AS period ON period."id" = movement."period_id"
  WHERE movement."deleted_at" IS NULL
    AND (movement."booking_date" < period."start_date"
         OR movement."booking_date" > period."end_date");

  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'Found % active personal_expenses rows whose booking date is outside their period. Repair or soft-delete them before applying this migration. Examples: %',
      v_invalid, v_examples
      USING ERRCODE = '23514';
  END IF;
END
$preflight$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_assert_period_booking_dates() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
SELECT public.money_assert_period_booking_dates();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_personal_expense_period_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $expense_period$
DECLARE
  v_start date;
  v_end date;
  v_owner uuid;
BEGIN
  -- A soft delete only stamps deleted_at. Allow it even for a legacy invalid
  -- row so bad history can be retired instead of becoming undeletable; the
  -- existing update guard keeps deleted rows read-only afterwards.
  IF TG_OP = 'UPDATE' AND NEW."deleted_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."period_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT period."start_date", period."end_date", period."owner_user_id"
    INTO v_start, v_end, v_owner
    FROM public.money_periods AS period
    WHERE period."id" = NEW."period_id";
  IF NOT FOUND
     OR v_owner IS DISTINCT FROM NEW."owner_user_id"
     OR NEW."booking_date" IS NULL
     OR NEW."booking_date" < v_start
     OR NEW."booking_date" > v_end THEN
    RAISE EXCEPTION 'A movement booking date must stay inside its period.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$expense_period$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_personal_expense_period_date() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_expenses_period_date_guard" ON "public"."personal_expenses";
CREATE TRIGGER "personal_expenses_period_date_guard"
  BEFORE INSERT OR UPDATE ON "public"."personal_expenses"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_personal_expense_period_date();
--> statement-breakpoint

-- Close/finalization transition guard. `superseded` is not finalization
-- evidence: it may only be entered without a reference/successor/rollover
-- timestamp, and the only way out is the explicit rollover transaction.
CREATE OR REPLACE FUNCTION public.enforce_money_period_close_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $guard$
DECLARE
  v_last_close date;
  v_close public.money_day_closes;
BEGIN
  IF NEW.finalization_reference IS DISTINCT FROM OLD.finalization_reference THEN
    IF OLD.finalization_reference IS NOT NULL
       OR NEW.finalization_reference IS NULL
       OR NEW.lifecycle NOT IN ('ended', 'rolled_over') THEN
      RAISE EXCEPTION 'A period finalization reference is append-only and requires explicit finalization.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.active_date IS NOT DISTINCT FROM OLD.active_date
     AND NEW.lifecycle IS NOT DISTINCT FROM OLD.lifecycle
     AND NEW.finalization_reference IS NOT DISTINCT FROM OLD.finalization_reference THEN
    RETURN NEW;
  END IF;

  IF NEW.active_date IS DISTINCT FROM OLD.active_date THEN
    IF NEW.lifecycle <> 'tracking' THEN
      RAISE EXCEPTION 'Only a tracking period can move its active date.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.active_date < OLD.start_date OR NEW.active_date > OLD.end_date THEN
      RAISE EXCEPTION 'The active date must stay inside the period.'
        USING ERRCODE = '23514';
    END IF;
    SELECT max(close_date) INTO v_last_close
    FROM public.money_day_closes
    WHERE owner_user_id = OLD.owner_user_id AND period_id = OLD.id;
    IF v_last_close IS NOT NULL AND NEW.active_date <= v_last_close THEN
      RAISE EXCEPTION 'The active date cannot move to or behind the retained close %.', v_last_close
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
    IF OLD.lifecycle = 'tracking' AND NEW.lifecycle = 'ended' THEN
      IF NEW.finalization_reference IS NOT NULL THEN
        RETURN NEW;
      END IF;
      SELECT * INTO v_close FROM public.money_day_closes
        WHERE owner_user_id = OLD.owner_user_id
          AND period_id = OLD.id
          AND close_date = OLD.active_date
          AND is_final_day
          AND lifecycle_after = 'ended'
          AND period_version_after = NEW.version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A period ends only by closing its final active day.'
          USING ERRCODE = '23514';
      END IF;
    ELSIF OLD.lifecycle = 'tracking' AND NEW.lifecycle = 'superseded' THEN
      -- Calendar continuation only. No finalization evidence may be attached.
      IF NEW.finalization_reference IS NOT NULL
         OR NEW.successor_period_id IS NOT NULL
         OR NEW.rolled_over_at IS NOT NULL THEN
        RAISE EXCEPTION 'A superseded period carries no finalization evidence.'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.active_date IS DISTINCT FROM OLD.active_date THEN
        RAISE EXCEPTION 'Superseding a period does not move its active date.'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.lifecycle = 'rolled_over'
          AND OLD.lifecycle IN ('tracking', 'superseded', 'ended') THEN
      IF NEW.successor_period_id IS NULL
         OR NEW.finalization_reference IS NULL THEN
        RAISE EXCEPTION 'Finalizing a period requires the explicit rollover operation.'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unsupported Money period lifecycle transition.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$guard$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_money_period_close_transition() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "money_periods_close_transition_guard" ON "public"."money_periods";
CREATE TRIGGER "money_periods_close_transition_guard"
  BEFORE UPDATE ON "public"."money_periods"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_period_close_transition();
--> statement-breakpoint

-- Opening initialization on a non-finalized superseded period.
--
-- Automatic continuation may leave the predecessor `superseded` with an
-- unknown opening. Finalization cannot review cash without that opening, and
-- the tracking-only settings RPC would otherwise make the range permanently
-- unfinalizable. The one allowed transition is exactly: initialize the missing
-- opening, never move the active date and never change settings. A finalized
-- (`rolled_over`) range still uses the explicit historical correction path.
CREATE OR REPLACE FUNCTION public.money_update_period(
  p_period_id uuid,
  p_expected_version integer,
  p_active_date date,
  p_settings jsonb,
  p_opening_amount_minor integer,
  p_opening_create_fingerprint text,
  p_opening_note text,
  p_provenance jsonb,
  p_initialization text,
  p_updated_at timestamp with time zone
)
RETURNS SETOF public.money_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $update_period$
DECLARE
  v_owner uuid := auth.uid();
  v_period public.money_periods;
  v_opening public.personal_expenses;
  v_previous_active_date date;
  v_merged_provenance jsonb;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  -- This function is SECURITY DEFINER so it can maintain the active-date
  -- baseline after the column grant is revoked. It must still enforce the same
  -- finance-write grant as the old RLS UPDATE path.
  IF (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_period
  FROM public.money_periods
  WHERE "id" = p_period_id AND "owner_user_id" = v_owner
  FOR UPDATE;

  v_previous_active_date := v_period."active_date";

  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'An expected period version is required.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT FOUND OR v_period."version" <> p_expected_version THEN
    RETURN;
  END IF;

  IF v_period."lifecycle" <> 'tracking' THEN
    IF v_period."lifecycle" = 'superseded'
       AND v_period."opening_movement_id" IS NULL
       AND p_opening_amount_minor IS NOT NULL
       AND p_active_date IS NULL
       AND p_settings IS NULL THEN
      -- The missing-opening initialization path. Every other update stays
      -- closed until the explicit rollover review.
      NULL;
    ELSE
      RAISE EXCEPTION 'Only a tracking period accepts routine settings changes; a non-finalized superseded period accepts only its missing opening initialization.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_opening_amount_minor IS NOT NULL THEN
    IF p_initialization IS NULL OR p_provenance IS NULL THEN
      RAISE EXCEPTION 'Opening updates require initialization and provenance.'
        USING ERRCODE = '23514';
    END IF;

    IF v_period."opening_movement_id" IS NULL THEN
      INSERT INTO public.personal_expenses (
        "owner_user_id", "occurred_at", "amount_minor", "currency",
        "category", "note", "merchant", "need_vs_want", "payment_method",
        "idempotency_key", "create_fingerprint", "kind", "direction",
        "booking_date", "counts_in_daily", "period_id", "created_at", "updated_at"
      ) VALUES (
        v_owner, NULL, p_opening_amount_minor, 'MAD',
        NULL, p_opening_note, NULL, NULL, NULL,
        'opening:' || v_period."id", p_opening_create_fingerprint, 'opening', 'in',
        v_period."start_date", false, v_period."id", p_updated_at, p_updated_at
      )
      RETURNING * INTO v_opening;
    ELSE
      UPDATE public.personal_expenses
      SET "amount_minor" = p_opening_amount_minor,
          "note" = p_opening_note,
          "version" = "version" + 1,
          "updated_at" = p_updated_at
      WHERE "id" = v_period."opening_movement_id"
        AND "owner_user_id" = v_owner
        AND "kind" = 'opening'
        AND "deleted_at" IS NULL
      RETURNING * INTO v_opening;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'The period opening movement is missing or not owned.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    -- Opening initialization merges into the existing descriptive provenance.
    -- A continuation successor keeps its `continuedFrom` pointer even when the
    -- caller omits it from the update payload. An adopted opening also keeps
    -- its system-recorded `evidenceUpgrade` history: a normal correction
    -- replaces the active opening fields but must not erase how the verified
    -- evidence was established. Caller-supplied upgrade JSON is not evidence
    -- and is removed; only this database path can retain a recorded upgrade.
    v_merged_provenance := COALESCE(v_period."provenance", '{}'::jsonb)
      || COALESCE(p_provenance, '{}'::jsonb);
    IF jsonb_typeof(v_merged_provenance -> 'opening') = 'object' THEN
      IF jsonb_typeof(v_period."provenance" -> 'opening') = 'object'
         AND (v_period."provenance" -> 'opening') ? 'evidenceUpgrade' THEN
        v_merged_provenance := jsonb_set(
          v_merged_provenance,
          '{opening,evidenceUpgrade}',
          v_period."provenance" -> 'opening' -> 'evidenceUpgrade',
          true
        );
      ELSE
        v_merged_provenance := v_merged_provenance #- '{opening,evidenceUpgrade}';
      END IF;
    END IF;
    IF v_period."provenance" ? 'continuedFrom' THEN
      v_merged_provenance := v_merged_provenance || jsonb_build_object(
        'continuedFrom', v_period."provenance" -> 'continuedFrom'
      );
    END IF;

    UPDATE public.money_periods
    SET "active_date" = COALESCE(p_active_date, "active_date"),
        "settings" = COALESCE(p_settings, "settings"),
        "initialization" = p_initialization,
        "opening_movement_id" = v_opening."id",
        "provenance" = v_merged_provenance,
        "version" = "version" + 1,
        "updated_at" = p_updated_at
    WHERE "id" = p_period_id AND "owner_user_id" = v_owner
    RETURNING * INTO v_period;
  ELSE
    UPDATE public.money_periods
    SET "active_date" = COALESCE(p_active_date, "active_date"),
        "settings" = COALESCE(p_settings, "settings"),
        "version" = "version" + 1,
        "updated_at" = p_updated_at
    WHERE "id" = p_period_id AND "owner_user_id" = v_owner
    RETURNING * INTO v_period;
  END IF;

  -- Any explicit active-date move gets a fresh canonical day-start version.
  -- Forward movement is not the only path now that day close is optional: a
  -- rewind to an earlier unclosed date must also get an honest baseline instead
  -- of inheriting a stale one. Prior versions remain retained history.
  IF v_period."active_date" IS DISTINCT FROM v_previous_active_date THEN
    PERFORM public.money_refresh_day_start_baseline(p_period_id, v_period."active_date");
  END IF;

  RETURN NEXT v_period;
  RETURN;
END
$update_period$;
--> statement-breakpoint

-- Controlled calendar continuation. Called only from the application routine
-- write guard; reads never invoke it. It creates exactly one later tracking
-- period with an unknown opening. A tracking source is superseded first; a
-- source already closed by its final-day close stays `ended`, so its retained
-- close evidence is neither replaced nor upgraded into a routine transition.
CREATE OR REPLACE FUNCTION public.money_continue_period(
  p_booking_date date
)
RETURNS public.money_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $continue$
DECLARE
  v_owner uuid := auth.uid();
  v_tracking public.money_periods;
  v_continuing_ended boolean := false;
  v_existing public.money_periods;
  v_successor public.money_periods;
  v_new_id uuid := gen_random_uuid();
  v_start date;
  v_end date;
  v_gap integer;
  v_policy public.money_policy_versions;
  v_settings jsonb;
  v_policy_id uuid;
  v_today date;
  v_now timestamptz := statement_timestamp();
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;
  IF p_booking_date IS NULL THEN
    RAISE EXCEPTION 'A booking date is required.' USING ERRCODE = '23514';
  END IF;

  -- Lock the owner's whole period set in the shared stable order so concurrent
  -- first writes in a new month converge on one successor and no caller can
  -- invert the lock order against the explicit rollover.
  PERFORM public.money_lock_owner_periods(v_owner);

  SELECT * INTO v_tracking
  FROM public.money_periods
  WHERE owner_user_id = v_owner AND lifecycle = 'tracking'
  ORDER BY start_date DESC
  LIMIT 1;

  IF v_tracking.id IS NULL THEN
    -- A final-day close ends the period without superseding it. A later
    -- routine write still needs a writable window, so an ended latest period
    -- may continue the calendar; it keeps its `ended` lifecycle and close
    -- evidence. The latest period must be the ended one: continuing an earlier
    -- range past a later superseded/rolled-over range would overlap it.
    SELECT * INTO v_tracking
    FROM public.money_periods
    WHERE owner_user_id = v_owner
    ORDER BY end_date DESC, start_date DESC
    LIMIT 1;
    IF v_tracking.id IS NULL OR v_tracking.lifecycle <> 'ended' THEN
      RAISE EXCEPTION 'There is no tracking or latest ended period to continue. Create a Money period explicitly.'
        USING ERRCODE = '23514';
    END IF;
    v_continuing_ended := true;
  END IF;
  IF p_booking_date BETWEEN v_tracking.start_date AND v_tracking.end_date THEN
    -- A tracking source owns its own dates. An ended source does not: the
    -- closed-period check below reports the explicit historical correction.
    IF NOT v_continuing_ended THEN
      RETURN v_tracking;
    END IF;
  END IF;
  IF p_booking_date < v_tracking.start_date THEN
    RAISE EXCEPTION 'The date % is before the latest period. Use the explicit historical correction path.', p_booking_date
      USING ERRCODE = '23514';
  END IF;

  -- A later routine write continues the calendar only up to owner-local today
  -- in the source period timezone. A future date would supersede the current
  -- window before its day has arrived and leave no period that owns today.
  v_today := (v_now AT TIME ZONE v_tracking."timezone")::date;
  IF p_booking_date > v_today THEN
    RAISE EXCEPTION 'The date % is in the future. A routine write can continue the calendar only up to today (%) in the period timezone %.',
      p_booking_date, v_today, v_tracking."timezone"
      USING ERRCODE = '23514';
  END IF;

  -- A date inside any non-tracking period is a historical correction.
  IF EXISTS (
    SELECT 1 FROM public.money_periods AS period
    WHERE period.owner_user_id = v_owner
      AND period.lifecycle <> 'tracking'
      AND p_booking_date BETWEEN period.start_date AND period.end_date
  ) THEN
    RAISE EXCEPTION 'The date % belongs to a closed period. Use the explicit historical correction path.', p_booking_date
      USING ERRCODE = '23514';
  END IF;

  v_gap := p_booking_date - v_tracking.end_date;
  IF v_gap > 366 THEN
    RAISE EXCEPTION 'The date % is more than 366 days after the latest period. Create a Money period explicitly.', p_booking_date
      USING ERRCODE = '23514';
  END IF;

  v_start := v_tracking.end_date + 1;
  -- The smallest contiguous successor contains the booking month. A full
  -- calendar month is used where possible; a long gap keeps the 366-day cap.
  v_end := (date_trunc('month', p_booking_date) + interval '1 month - 1 day')::date;
  IF v_end < v_start THEN
    v_end := v_start;
  END IF;
  IF v_end - v_start + 1 > 366 THEN
    v_end := v_start + 365;
  END IF;

  -- A concurrent continuation may have won after the lock was acquired. Adopt
  -- that exact period when it contains the date; never create a second one.
  SELECT * INTO v_existing
  FROM public.money_periods
  WHERE owner_user_id = v_owner AND start_date = v_start
  ORDER BY end_date
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.lifecycle = 'tracking'
       AND p_booking_date BETWEEN v_existing.start_date AND v_existing.end_date THEN
      RETURN v_existing;
    END IF;
    RAISE EXCEPTION 'A Money period already starts on % and does not contain the booking date.', v_start
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_policy
  FROM public.money_policy_versions
  WHERE owner_user_id = v_owner AND period_id = v_tracking.id
  ORDER BY effective_date DESC, version DESC
  LIMIT 1;
  v_settings := COALESCE(v_policy.policy -> 'settings', v_tracking.settings, '{}'::jsonb);

  IF NOT v_continuing_ended THEN
    UPDATE public.money_periods
    SET lifecycle = 'superseded',
        version = version + 1,
        updated_at = v_now
    WHERE id = v_tracking.id AND owner_user_id = v_owner;
  END IF;

  INSERT INTO public.money_periods (
    id, owner_user_id, start_date, end_date, currency, timezone, active_date,
    lifecycle, initialization, opening_movement_id, day_start_setup_completed,
    provenance, settings, version, created_at, updated_at
  ) VALUES (
    v_new_id, v_owner, v_start, v_end, v_tracking.currency, v_tracking.timezone,
    p_booking_date, 'tracking', 'uninitialized', NULL, false,
    jsonb_build_object(
      'opening', NULL,
      'createdFrom',
        CASE WHEN (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL THEN 'mcp' ELSE 'web' END,
      'continuedFrom', v_tracking.id
    ),
    v_settings, 1, v_now, v_now
  )
  RETURNING * INTO v_successor;

  INSERT INTO public.money_policy_versions (
    owner_user_id, period_id, version, effective_date, policy, created_at
  ) VALUES (
    v_owner, v_new_id, 1, v_start,
    jsonb_build_object(
      'settings', v_settings,
      'algorithmVersion', 'safe-flexible-start-of-day-v1',
      'continuedFrom', v_tracking.id
    ),
    v_now
  )
  RETURNING id INTO v_policy_id;

  -- Use the canonical baseline path so a still-unconfirmed setup stores the
  -- same explicit `initial_setup_incomplete` evidence as any other fresh
  -- period. The policy copy above remains effective from the range start.
  PERFORM public.money_calculate_day_start_baseline(
    v_new_id,
    v_successor.active_date,
    false
  );

  RETURN v_successor;
END
$continue$;
--> statement-breakpoint
-- `money_continue_period` is an internal step of the atomic routine write.
-- Authenticated callers reach it only through money_record_routine_movement so
-- the lifecycle transition (when any) and the financial insert share one
-- transaction; a direct call could leave a superseded window without the
-- movement that required it.
REVOKE ALL ON FUNCTION public.money_continue_period(date) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Atomic routine entry. The application resolves the same policy for its
-- message, but the row insert and any continuation happen in this one
-- transaction. A rejected insert therefore rolls the supersession back instead
-- of leaving a period the write never served. The database also owns the final
-- `period_id`, so a cross-window write cannot keep a stale period reference.
CREATE OR REPLACE FUNCTION public.money_record_routine_movement(
  p_booking_date date,
  p_kind text,
  p_direction text,
  p_occurred_at timestamptz,
  p_amount_minor integer,
  p_category text,
  p_note text,
  p_merchant text,
  p_need_vs_want text,
  p_payment_method text,
  p_purpose text,
  p_counts_in_daily boolean,
  p_idempotency_key text,
  p_create_fingerprint text
)
RETURNS public.personal_expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $routine_write$
DECLARE
  v_owner uuid := auth.uid();
  v_tracking public.money_periods;
  v_period public.money_periods;
  v_derived date;
  v_row public.personal_expenses;
  v_attempt integer;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;
  IF p_booking_date IS NULL THEN
    RAISE EXCEPTION 'A booking date is required.' USING ERRCODE = '23514';
  END IF;
  IF p_kind IS NULL OR p_kind = 'opening' THEN
    RAISE EXCEPTION 'The routine write kind is invalid.' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_create_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The routine write receipt is incomplete.' USING ERRCODE = '23514';
  END IF;

  -- Take the shared owner-scoped lock before resolving any row. The routine
  -- write, continuation and rollover adoption all enter through the same
  -- ascending order, so a concurrent rollover cannot invert the order and
  -- deadlock, and the lifecycle re-read below happens under that lock.
  PERFORM public.money_lock_owner_periods(v_owner);

  -- Lock the target period through the insert. A concurrent rollover cannot
  -- finalize the range between period resolution and the financial write.
  --
  -- A concurrent continuation can also supersede the exact row this statement
  -- was waiting on. PostgreSQL then re-checks the updated row against
  -- `lifecycle = 'tracking'`, finds no match, and returns no row: the committed
  -- successor is not in that statement's snapshot. Re-read in a fresh statement
  -- (a new READ COMMITTED snapshot) before concluding that no tracking period
  -- exists. This is the routine-write retry the continuation path needs so two
  -- first writes of a new month converge on the same successor.
  FOR v_attempt IN 1..3 LOOP
    SELECT * INTO v_tracking
    FROM public.money_periods
    WHERE owner_user_id = v_owner AND lifecycle = 'tracking'
    ORDER BY start_date DESC
    LIMIT 1
    FOR UPDATE;
    EXIT WHEN v_tracking.id IS NOT NULL;
  END LOOP;

  IF v_tracking.id IS NOT NULL THEN
    IF p_booking_date BETWEEN v_tracking.start_date AND v_tracking.end_date THEN
      v_period := v_tracking;
    ELSIF p_booking_date > v_tracking.end_date THEN
      -- The one controlled calendar continuation. It is nested in this
      -- transaction, so its supersession and successor roll back with a failed
      -- insert below.
      SELECT * INTO v_period
      FROM public.money_continue_period(p_booking_date);
    ELSE
      -- A non-finalized superseded period still owns routine entry for its own
      -- dates. `superseded` closes the forward window; it is not approval.
      SELECT * INTO v_period
      FROM public.money_periods
      WHERE owner_user_id = v_owner
        AND lifecycle = 'superseded'
        AND p_booking_date BETWEEN start_date AND end_date
      ORDER BY start_date DESC
      LIMIT 1
      FOR UPDATE;
      IF v_period.id IS NULL THEN
        RAISE EXCEPTION 'The date % is outside the writable period. Use the explicit historical correction path.', p_booking_date
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSE
    SELECT * INTO v_period
    FROM public.money_periods
    WHERE owner_user_id = v_owner
      AND lifecycle = 'superseded'
      AND p_booking_date BETWEEN start_date AND end_date
    ORDER BY start_date DESC
    LIMIT 1
    FOR UPDATE;
    IF v_period.id IS NULL THEN
      -- With no tracking window, the latest ended period is the only source
      -- that may continue the calendar. Its own dates stay historical
      -- corrections; only later dates are continued. The continuation creates
      -- the successor atomically with this insert and leaves the source ended.
      SELECT * INTO v_period
      FROM public.money_periods
      WHERE owner_user_id = v_owner
      ORDER BY end_date DESC, start_date DESC
      LIMIT 1;
      IF v_period.id IS NOT NULL AND v_period.lifecycle = 'ended' THEN
        IF p_booking_date > v_period.end_date THEN
          SELECT * INTO v_period
          FROM public.money_continue_period(p_booking_date);
        ELSIF p_booking_date BETWEEN v_period.start_date AND v_period.end_date THEN
          RAISE EXCEPTION 'The date % belongs to the ended period %–%. Use the explicit historical correction path.',
            p_booking_date, v_period.start_date, v_period.end_date
            USING ERRCODE = '23514';
        ELSE
          RAISE EXCEPTION 'The date % is outside the writable period. Use the explicit historical correction path.', p_booking_date
            USING ERRCODE = '23514';
        END IF;
      ELSIF v_period.id IS NOT NULL THEN
        RAISE EXCEPTION 'There is no tracking period. Ended, superseded or rolled-over periods accept their own dates only through the explicit historical correction path.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF v_period.id IS NOT NULL AND p_occurred_at IS NOT NULL THEN
    v_derived := (p_occurred_at AT TIME ZONE v_period.timezone)::date;
    IF v_derived IS DISTINCT FROM p_booking_date THEN
      RAISE EXCEPTION 'Booking date % does not match the supplied occurrence time in the Money period timezone (%).',
        p_booking_date, v_derived
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.personal_expenses (
    owner_user_id, occurred_at, amount_minor, currency, category, note, merchant,
    need_vs_want, payment_method, purpose, counts_in_daily, idempotency_key,
    create_fingerprint, kind, direction, booking_date, period_id, created_at,
    updated_at
  ) VALUES (
    v_owner, p_occurred_at, p_amount_minor, 'MAD', p_category, p_note, p_merchant,
    p_need_vs_want, p_payment_method, p_purpose, COALESCE(p_counts_in_daily, false),
    p_idempotency_key, p_create_fingerprint, p_kind, p_direction, p_booking_date,
    v_period.id, statement_timestamp(), statement_timestamp()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END
$routine_write$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_record_routine_movement(
  date, text, text, timestamptz, integer, text, text, text, text, text, text,
  boolean, text, text
) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_record_routine_movement(
  date, text, text, timestamptz, integer, text, text, text, text, text, text,
  boolean, text, text
) TO authenticated;
--> statement-breakpoint

-- Replace the rollover RPC with the continuity-aware finalization variant. The
-- signature is unchanged, so CREATE OR REPLACE keeps the compatibility overload
-- and its dependency intact.
CREATE OR REPLACE FUNCTION public.money_rollover_period(
  p_source_period_id uuid,
  p_expected_version integer,
  p_start_date date,
  p_end_date date,
  p_active_date date,
  p_timezone text,
  p_initialized text,
  p_allow_uncovered_days boolean,
  p_opening_amount_minor integer,
  p_opening_cutoff_date date,
  p_opening_evidence text,
  p_opening_note text,
  p_opening_create_fingerprint text,
  p_provenance jsonb,
  p_settings jsonb,
  p_operation_id text,
  p_request_fingerprint text,
  p_opening_mode text,
  p_unpaid_treatment text,
  p_unpaid_reason text,
  p_reconciliation_accepted_note text,
  p_unverified_days_note text,
  p_unverified_days_count integer,
  p_reconciliation jsonb,
  p_occurrences jsonb,
  p_carried_occurrences jsonb,
  -- Accepted for signature compatibility only. Every stored timestamp and the
  -- verified-cutoff boundary come from the trusted database clock below.
  p_created_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rollover$
DECLARE
  v_owner uuid := auth.uid();
  v_source public.money_periods;
  v_existing public.money_period_rollovers;
  v_successor_id uuid := gen_random_uuid();
  v_opening_id uuid;
  v_policy_id uuid;
  v_record public.money_period_rollovers;
  v_pending_count integer := 0;
  v_generated integer := 0;
  v_carried integer := 0;
  v_cancelled integer := 0;
  v_item jsonb;
  v_source_occurrence public.money_obligations;
  v_receipt_id uuid;
  v_source_opening integer;
  v_modeled_closing integer;
  v_close_summary jsonb;
  v_restated_closes integer;
  v_paid_mismatches integer;
  v_visit_mismatches integer;
  v_source_policy public.money_policy_versions;
  v_successor_settings jsonb;
  v_unverified_count integer := 0;
  v_unverified_dates text;
  v_now timestamptz := statement_timestamp();
  v_adopting boolean := false;
  v_continuation public.money_periods;
  v_continuation_opening integer;
  v_policy_version integer;
  v_provenance jsonb;
  v_opening_provenance jsonb;
  v_existing_opening_provenance jsonb;
  v_evidence_upgrade jsonb;
  v_predecessor public.money_periods;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR btrim(p_operation_id) = '' THEN
    RAISE EXCEPTION 'A stable operation id is required.' USING ERRCODE = '23514';
  END IF;

  -- The same owner-scoped lock order as the routine write and continuation.
  -- The source and the adopted successor are already covered by this lock, so
  -- a routine write cannot hold the tracking row while this transaction holds
  -- an earlier source and waits for it.
  PERFORM public.money_lock_owner_periods(v_owner);

  SELECT * INTO v_source
  FROM public.money_periods
  WHERE id = p_source_period_id AND owner_user_id = v_owner
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source Money period was not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM public.money_period_rollovers
  WHERE owner_user_id = v_owner AND operation_id = btrim(p_operation_id);
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'This operation id was used for a different rollover request.'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('rollover', to_jsonb(v_existing), 'replayed', true);
  END IF;

  IF v_source.version <> p_expected_version THEN
    RAISE EXCEPTION 'The source period changed since it was read.' USING ERRCODE = '40001';
  END IF;
  IF v_source.lifecycle NOT IN ('tracking', 'superseded', 'ended') THEN
    RAISE EXCEPTION 'Only a tracking, superseded or ended period can be rolled over.'
      USING ERRCODE = '23514';
  END IF;
  IF v_source.successor_period_id IS NOT NULL THEN
    RAISE EXCEPTION 'This period already has a successor.' USING ERRCODE = '23505';
  END IF;

  -- Finalizing a continuation successor before the period it continues would
  -- leave the predecessor permanently unfinalizable: the successor is already
  -- rolled over, so the predecessor's adoption path no longer exists. A
  -- predecessor left superseded by a routine continuation and one left ended
  -- by its final-day close both continue into this period. Block either with an
  -- actionable message before any preview comparison.
  SELECT * INTO v_predecessor
  FROM public.money_periods
  WHERE owner_user_id = v_owner
    AND end_date = v_source.start_date - 1
    AND lifecycle IN ('superseded', 'ended')
    AND successor_period_id IS NULL
  ORDER BY start_date DESC
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Finalize the preceding period %–% first. This period continues it and cannot be finalized before its predecessor.',
      v_predecessor.start_date, v_predecessor.end_date
      USING ERRCODE = '23514';
  END IF;

  IF p_start_date < v_source.end_date + 1 OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'The successor dates must start after the source period ends.'
      USING ERRCODE = '23514';
  END IF;
  IF p_start_date > v_source.end_date + 1 AND NOT COALESCE(p_allow_uncovered_days, false) THEN
    RAISE EXCEPTION 'Days between the source end and the successor start would belong to no period. Allow them explicitly.'
      USING ERRCODE = '23514';
  END IF;
  IF p_end_date - p_start_date + 1 > 366 THEN
    RAISE EXCEPTION 'A Money period can cover at most 366 days.' USING ERRCODE = '23514';
  END IF;
  IF p_active_date <> p_start_date THEN
    RAISE EXCEPTION 'The successor active date must be its start date.'
      USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(p_timezone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'The successor timezone is required.' USING ERRCODE = '23514';
  END IF;
  IF p_initialized NOT IN ('initialized', 'reconciled') THEN
    RAISE EXCEPTION 'The successor opening initialization is invalid.' USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode NOT IN ('carry_forward', 'verified_source') THEN
    RAISE EXCEPTION 'The successor opening mode is invalid.' USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode = 'carry_forward' AND p_initialized <> 'initialized' THEN
    RAISE EXCEPTION 'A carried opening is initialized, not independently reconciled.'
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode = 'verified_source' AND p_initialized <> 'reconciled' THEN
    RAISE EXCEPTION 'A verified opening must retain reconciled evidence.'
      USING ERRCODE = '23514';
  END IF;
  -- Any unfinalized source that still owns the current local day (including
  -- its exact end date) cannot be finalized. The day would stop belonging to
  -- any writable period and a later same-day entry would have no legal target.
  -- An ended source is exempt because its retained final-day close is the
  -- explicit decision. The source's stored timezone owns the calendar day.
  IF v_source.lifecycle IN ('tracking', 'superseded')
     AND v_source.end_date >= (v_now AT TIME ZONE v_source.timezone)::date THEN
    RAISE EXCEPTION 'Finalizing now would leave the current local day outside a writable period. Finalize after % instead.', v_source.end_date
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_amount_minor IS NULL OR p_opening_amount_minor < 0 THEN
    RAISE EXCEPTION 'A known non-negative successor opening is required.'
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_cutoff_date IS NULL OR p_opening_cutoff_date > p_start_date THEN
    RAISE EXCEPTION 'The opening cutoff must be recorded on or before the successor start.'
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode = 'verified_source'
     AND NULLIF(btrim(COALESCE(p_opening_evidence, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A verified opening must retain its evidence.'
      USING ERRCODE = '23514';
  END IF;
  IF p_opening_mode = 'verified_source' THEN
    IF p_opening_cutoff_date < v_source.end_date THEN
      RAISE EXCEPTION 'A verified opening must cover the source period end (%).',
        v_source.end_date
        USING ERRCODE = '23514';
    END IF;
    IF p_opening_cutoff_date > (v_now AT TIME ZONE v_source.timezone)::date THEN
      RAISE EXCEPTION 'A verified opening cannot be dated in the future.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  -- A carried opening is the source's modeled cash at its close, so its
  -- retained cutoff is exactly the source end. A scalar cutoff that disagrees
  -- cannot be stored beside a provenance object that claims to carry this
  -- balance.
  IF p_opening_mode = 'carry_forward'
     AND p_opening_cutoff_date IS DISTINCT FROM v_source.end_date THEN
    RAISE EXCEPTION 'A carried opening must use the source period end (%) as its cutoff.',
      v_source.end_date
      USING ERRCODE = '23514';
  END IF;
  IF p_settings IS NOT NULL AND jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'Successor settings overrides must be a JSON object.'
      USING ERRCODE = '23514';
  END IF;
  IF p_settings ? 'savingsTargetMinor' AND jsonb_typeof(p_settings -> 'savingsTargetMinor') <> 'null' AND (
    jsonb_typeof(p_settings -> 'savingsTargetMinor') <> 'number'
    OR (p_settings ->> 'savingsTargetMinor')::numeric < 0
    OR (p_settings ->> 'savingsTargetMinor')::numeric > 2147483647
    OR (p_settings ->> 'savingsTargetMinor')::numeric <> trunc((p_settings ->> 'savingsTargetMinor')::numeric)
  ) THEN
    RAISE EXCEPTION 'savingsTargetMinor must be a non-negative integer.'
      USING ERRCODE = '23514';
  END IF;
  IF p_settings ? 'emergencyTargetMinor' AND jsonb_typeof(p_settings -> 'emergencyTargetMinor') <> 'null' AND (
    jsonb_typeof(p_settings -> 'emergencyTargetMinor') <> 'number'
    OR (p_settings ->> 'emergencyTargetMinor')::numeric < 0
    OR (p_settings ->> 'emergencyTargetMinor')::numeric > 2147483647
    OR (p_settings ->> 'emergencyTargetMinor')::numeric <> trunc((p_settings ->> 'emergencyTargetMinor')::numeric)
  ) THEN
    RAISE EXCEPTION 'emergencyTargetMinor must be a non-negative integer.'
      USING ERRCODE = '23514';
  END IF;
  IF p_unpaid_treatment IS NOT NULL
     AND p_unpaid_treatment NOT IN ('keep_pending', 'carry_forward', 'cancel') THEN
    RAISE EXCEPTION 'The unpaid-item treatment is invalid.' USING ERRCODE = '23514';
  END IF;
  IF p_unpaid_treatment IN ('carry_forward', 'cancel')
     AND NULLIF(btrim(COALESCE(p_unpaid_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Cancelling or carrying forward unpaid occurrences needs a reason.'
      USING ERRCODE = '23514';
  END IF;

  -- Retained opening evidence is constructed from the validated scalar inputs
  -- and the trusted database clock. Caller-supplied provenance may describe the
  -- surface and retain corrections, but it cannot move the verified cutoff or
  -- timestamp. A conflicting cutoff is refused instead of being stored beside
  -- the validated one.
  IF p_provenance IS NOT NULL AND jsonb_typeof(p_provenance) <> 'object' THEN
    RAISE EXCEPTION 'Rollover provenance must be a JSON object.' USING ERRCODE = '23514';
  END IF;
  IF p_provenance IS NOT NULL
     AND p_provenance ? 'opening'
     AND jsonb_typeof(p_provenance -> 'opening') NOT IN ('null', 'object') THEN
    RAISE EXCEPTION 'Opening provenance must be an object or null.' USING ERRCODE = '23514';
  END IF;
  IF p_provenance IS NOT NULL
     AND jsonb_typeof(p_provenance -> 'opening') = 'object' THEN
    IF (p_provenance -> 'opening' ->> 'source') IS DISTINCT FROM p_opening_mode THEN
      RAISE EXCEPTION 'The opening provenance source must match the approved opening mode.'
        USING ERRCODE = '23514';
    END IF;
    IF (p_provenance -> 'opening' ->> 'cutoffDate')
       IS DISTINCT FROM p_opening_cutoff_date::text THEN
      RAISE EXCEPTION 'The opening provenance cutoff does not match the validated opening cutoff.'
        USING ERRCODE = '40001';
    END IF;
    IF COALESCE(jsonb_typeof(p_provenance -> 'opening' -> 'corrections'), 'array')
       IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Opening provenance corrections must be an array.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  v_opening_provenance := jsonb_build_object(
    'source', p_opening_mode,
    'recordedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cutoffDate', p_opening_cutoff_date,
    'evidence', p_opening_evidence,
    'note', p_opening_note,
    'corrections', COALESCE(p_provenance -> 'opening' -> 'corrections', '[]'::jsonb)
  );
  v_provenance := (COALESCE(p_provenance, '{}'::jsonb) - 'opening')
    || jsonb_build_object('opening', v_opening_provenance);

  -- Adoption of a continuation-created successor. The identity comes from the
  -- real date chain (the immediate next period that starts the day after the
  -- source ends), never from forgeable provenance JSON. A source may be
  -- superseded by a routine continuation or ended by its final-day close; the
  -- immediate successor may still be tracking, may already be superseded by a
  -- later continuation, or may already be ended by its own final-day close.
  -- Either way it is the one period that owns those dates. The requested range
  -- must be exactly that period; anything else is a conflict, not a duplicate.
  IF v_source.lifecycle IN ('superseded', 'ended') THEN
    SELECT * INTO v_continuation
    FROM public.money_periods
    WHERE owner_user_id = v_owner
      AND start_date = v_source.end_date + 1
      AND lifecycle IN ('tracking', 'superseded', 'ended')
    FOR UPDATE;
    IF FOUND THEN
      IF v_continuation.start_date <> p_start_date
         OR v_continuation.end_date <> p_end_date THEN
        RAISE EXCEPTION 'The continued period already covers %–%. Finalize it with exactly that range.',
          v_continuation.start_date, v_continuation.end_date
          USING ERRCODE = '40001';
      END IF;
      v_adopting := true;
      v_successor_id := v_continuation.id;
    ELSE
      -- Defensive recovery: a successor finalized before this fix already has
      -- its own rollover, so the date chain exists but must not be re-created.
      SELECT * INTO v_continuation
      FROM public.money_periods
      WHERE owner_user_id = v_owner
        AND start_date = v_source.end_date + 1
        AND lifecycle = 'rolled_over'
      LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION 'The continued period %–% was already finalized before this period. The predecessor cannot be silently re-linked to a finalized period; repair the predecessor with an explicit period decision.',
          v_continuation.start_date, v_continuation.end_date
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- Finalization reviews evidence instead of requiring a complete close chain.
  -- A source may be tracking or ended; every unclosed date in its inclusive
  -- range is reported and must be explicitly acknowledged with a retained note.
  -- This repeats the preview comparison inside the atomic write so a stale
  -- preview cannot roll over an unexamined restatement.
  v_close_summary := public.money_rollover_close_snapshot_summary(v_source.id);
  IF COALESCE((v_close_summary ->> 'available')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'The source period close evidence is unavailable (%).',
      COALESCE(v_close_summary ->> 'reason', 'unknown')
      USING ERRCODE = '23514';
  END IF;
  v_unverified_count := COALESCE((v_close_summary ->> 'unverifiedDayCount')::integer, 0);
  v_unverified_dates := (
    SELECT string_agg(entry, ', ')
    FROM jsonb_array_elements_text(
      COALESCE(v_close_summary -> 'missingCloseDates', '[]'::jsonb)
    ) AS entry
  );
  IF v_unverified_count > 0 THEN
    IF NULLIF(btrim(COALESCE(p_unverified_days_note, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Unverified source days need an explicit acknowledgment note before rollover.'
        USING ERRCODE = '23514',
              DETAIL = 'Unverified dates: ' || COALESCE(v_unverified_dates, 'unknown');
    END IF;
    IF p_unverified_days_count IS DISTINCT FROM v_unverified_count THEN
      RAISE EXCEPTION 'The reviewed unverified days changed since the preview. Reload before rolling over.'
        USING ERRCODE = '40001',
              DETAIL = 'The source now has ' || v_unverified_count || ' unverified days.';
    END IF;
  ELSIF COALESCE(p_unverified_days_count, 0) <> 0 THEN
    RAISE EXCEPTION 'The unverified-day acknowledgment no longer matches the source. Reload before rolling over.'
      USING ERRCODE = '40001';
  END IF;
  IF COALESCE((v_close_summary ->> 'comparableToRestatedTotals')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Stored day closes could not be compared with restated totals.'
      USING ERRCODE = '23514';
  END IF;
  v_restated_closes := COALESCE((v_close_summary ->> 'restatedDifferenceCount')::integer, 0);
  v_paid_mismatches := COALESCE((v_close_summary ->> 'paidObligationMismatchCount')::integer, 0);
  v_visit_mismatches := COALESCE((v_close_summary ->> 'countedVisitMismatchCount')::integer, 0);
  IF (v_restated_closes > 0 OR v_paid_mismatches > 0 OR v_visit_mismatches > 0
      OR (v_close_summary ->> 'savingsTargetMinor' IS NOT NULL
          AND (v_close_summary ->> 'savingsTargetMinor')::integer
              <> (v_close_summary ->> 'savingsTransferredMinor')::integer))
     AND NULLIF(btrim(COALESCE(p_reconciliation_accepted_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Restated closes, payment, counted-visit or savings differences need an explicit acceptance note before rollover.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM public.money_obligations
  WHERE owner_user_id = v_owner
    AND state = 'pending'
    AND period_start <= v_source.end_date
    AND period_end >= v_source.start_date;
  IF v_pending_count > 0 AND p_unpaid_treatment IS NULL THEN
    RAISE EXCEPTION 'Unpaid source occurrences need an explicit treatment.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT v_adopting THEN
    IF EXISTS (
      SELECT 1 FROM public.money_periods AS existing
      WHERE existing.owner_user_id = v_owner
        AND existing.id <> v_successor_id
        AND daterange(existing.start_date, existing.end_date, '[]')
            && daterange(p_start_date, p_end_date, '[]')
    ) THEN
      RAISE EXCEPTION 'A Money period already overlaps those dates.' USING ERRCODE = '23505';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.money_periods AS existing
      WHERE existing.owner_user_id = v_owner
        AND existing.lifecycle = 'tracking'
        AND existing.id <> v_source.id
    ) THEN
      RAISE EXCEPTION 'A tracking period already exists; rollover creates the only tracking period.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Re-derive modeled closing cash in this transaction. Unknown stays unknown:
  -- a missing source opening cannot be carried forward as zero.
  SELECT amount_minor INTO v_source_opening
  FROM public.personal_expenses
  WHERE owner_user_id = v_owner
    AND id = v_source.opening_movement_id
    AND kind = 'opening'
    AND deleted_at IS NULL;

  IF v_source_opening IS NULL THEN
    IF p_opening_mode = 'carry_forward' THEN
      RAISE EXCEPTION 'Closing cash is unknown and cannot be carried forward as zero.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT v_source_opening + COALESCE(sum(
        CASE WHEN movement.direction = 'in' THEN movement.amount_minor
             ELSE -movement.amount_minor END
      ), 0)::integer
      INTO v_modeled_closing
    FROM public.personal_expenses AS movement
    WHERE movement.owner_user_id = v_owner
      AND movement.booking_date >= v_source.start_date
      AND movement.booking_date <= v_source.end_date
      AND movement.deleted_at IS NULL
      AND movement.kind <> 'opening';
  END IF;

  IF p_opening_mode = 'carry_forward' THEN
    IF v_modeled_closing IS DISTINCT FROM p_opening_amount_minor THEN
      RAISE EXCEPTION 'Closing cash changed since the preview. Reload before rolling over.'
        USING ERRCODE = '40001';
    END IF;
  END IF;

  SELECT * INTO v_source_policy
  FROM public.money_policy_versions
  WHERE owner_user_id = v_owner AND period_id = v_source.id
  ORDER BY effective_date DESC, version DESC
  LIMIT 1;
  v_successor_settings := COALESCE(v_source_policy.policy -> 'settings', v_source.settings, '{}'::jsonb)
    || COALESCE(p_settings, '{}'::jsonb);

  -- The explicit finalization owns this transaction.
  --
  -- A tracking source is ended before the new successor is inserted so the
  -- one-tracking-period invariant holds inside the transaction. An ended or
  -- superseded source is already non-tracking. `finalization_reference` is
  -- internal proof written only by this definer function and cannot be set
  -- through the authenticated column grant.
  IF NOT v_adopting THEN
    IF v_source.lifecycle = 'tracking' THEN
      UPDATE public.money_periods
      SET lifecycle = 'ended',
          finalization_reference = v_successor_id,
          version = version + 1,
          updated_at = v_now
      WHERE id = v_source.id AND owner_user_id = v_owner
      RETURNING * INTO v_source;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The source period could not enter finalization.' USING ERRCODE = '40001';
      END IF;
    END IF;

    INSERT INTO public.money_periods (
      id, owner_user_id, start_date, end_date, currency, timezone, active_date,
      lifecycle, initialization, opening_movement_id, day_start_setup_completed,
      provenance, settings, version, created_at, updated_at
    ) VALUES (
      v_successor_id, v_owner, p_start_date, p_end_date, 'MAD', btrim(p_timezone),
      p_active_date, 'tracking', 'uninitialized', NULL, false,
      v_provenance, v_successor_settings,
      1, v_now, v_now
    );

    INSERT INTO public.personal_expenses (
      owner_user_id, occurred_at, amount_minor, currency, category, note, merchant,
      need_vs_want, payment_method, idempotency_key, create_fingerprint, kind,
      direction, booking_date, counts_in_daily, period_id, created_at, updated_at
    ) VALUES (
      v_owner, NULL, p_opening_amount_minor, 'MAD', NULL, p_opening_note, NULL,
      NULL, NULL, 'opening:' || v_successor_id, p_opening_create_fingerprint,
      'opening', 'in', p_start_date, false, v_successor_id, v_now, v_now
    )
    RETURNING id INTO v_opening_id;

    UPDATE public.money_periods
    SET initialization = p_initialized,
        opening_movement_id = v_opening_id,
        provenance = v_provenance,
        version = version + 1,
        updated_at = v_now
    WHERE id = v_successor_id AND owner_user_id = v_owner;

    INSERT INTO public.money_policy_versions (
      owner_user_id, period_id, version, effective_date, policy, created_at
    ) VALUES (
      v_owner, v_successor_id, 1, p_active_date,
      jsonb_build_object(
        'settings', v_successor_settings,
        'algorithmVersion', 'safe-flexible-start-of-day-v1',
        'rolledOverFrom', v_source.id
      ),
      v_now
    )
    RETURNING id INTO v_policy_id;

    INSERT INTO public.money_day_start_baselines (
      owner_user_id, period_id, date, version, policy_version_id, algorithm_version,
      availability, unavailable_reason, inputs, created_at
    ) VALUES (
      v_owner, v_successor_id, p_active_date, 1, v_policy_id,
      'safe-flexible-start-of-day-v1', 'unavailable', 'initial_setup_incomplete',
      jsonb_build_object('setupComplete', false, 'rolledOverFrom', v_source.id),
      v_now
    );
  ELSE
    -- Adopt the continuation-created successor. Movements already recorded in
    -- it stay untouched; only an honest opening and, when requested, a policy
    -- revision are added. The period identity/range was validated against the
    -- real date chain above.
    SELECT amount_minor INTO v_continuation_opening
    FROM public.personal_expenses
    WHERE owner_user_id = v_owner
      AND id = v_continuation.opening_movement_id
      AND kind = 'opening'
      AND deleted_at IS NULL;

    v_existing_opening_provenance := v_continuation.provenance -> 'opening';
    IF jsonb_typeof(v_existing_opening_provenance) IS DISTINCT FROM 'object' THEN
      v_existing_opening_provenance := NULL;
    END IF;

    IF v_continuation_opening IS NULL THEN
      v_provenance := COALESCE(v_continuation.provenance, '{}'::jsonb)
        || (COALESCE(p_provenance, '{}'::jsonb) - 'opening')
        || jsonb_build_object(
             'opening', v_opening_provenance,
             'continuedFrom', v_source.id
           );

      INSERT INTO public.personal_expenses (
        owner_user_id, occurred_at, amount_minor, currency, category, note, merchant,
        need_vs_want, payment_method, idempotency_key, create_fingerprint, kind,
        direction, booking_date, counts_in_daily, period_id, created_at, updated_at
      ) VALUES (
        v_owner, NULL, p_opening_amount_minor, 'MAD', NULL, p_opening_note, NULL,
        NULL, NULL, 'opening:' || v_successor_id, p_opening_create_fingerprint,
        'opening', 'in', p_start_date, false, v_successor_id, v_now, v_now
      )
      RETURNING id INTO v_opening_id;

      UPDATE public.money_periods
      SET initialization = p_initialized,
          opening_movement_id = v_opening_id,
          provenance = v_provenance,
          version = version + 1,
          updated_at = v_now
      WHERE id = v_successor_id AND owner_user_id = v_owner;
    ELSE
      IF v_continuation_opening IS DISTINCT FROM p_opening_amount_minor THEN
        RAISE EXCEPTION 'The continued period already has a different opening amount. Reload and review it instead of overwriting.'
          USING ERRCODE = '40001';
      END IF;
      IF v_continuation.initialization = 'uninitialized' THEN
        RAISE EXCEPTION 'The continued period has an opening recovery row but is not initialized. Reload and review it instead of rewriting the evidence.'
          USING ERRCODE = '23514';
      END IF;
      IF v_continuation.initialization = 'reconciled'
         AND p_initialized <> 'reconciled' THEN
        RAISE EXCEPTION 'A reconciled continued opening cannot lose its verified evidence.'
          USING ERRCODE = '23514';
      END IF;

      IF v_continuation.initialization = 'reconciled' THEN
        -- The retained verified cutoff is evidence. A different approved
        -- cutoff cannot silently rewrite it; the owner must reload and review.
        IF v_existing_opening_provenance IS NOT NULL
           AND (v_existing_opening_provenance ->> 'cutoffDate')
               IS DISTINCT FROM p_opening_cutoff_date::text THEN
          RAISE EXCEPTION 'The retained verified opening cutoff % does not match the approved cutoff %. Reload and review the opening instead of rewriting its evidence.',
            COALESCE(v_existing_opening_provenance ->> 'cutoffDate', 'unknown'),
            p_opening_cutoff_date
            USING ERRCODE = '40001';
        END IF;
        -- Equal-amount adoption keeps the retained leading, cutoff and
        -- correction history exactly as recorded.
        v_opening_provenance := COALESCE(
          v_existing_opening_provenance,
          v_opening_provenance
        );
      ELSIF p_initialized = 'reconciled' THEN
        -- Evidence upgrade, not an overwrite. The active verified evidence is
        -- built from the validated cutoff and the trusted database clock, while
        -- the previous evidence and every retained correction stay explicit.
        v_evidence_upgrade := jsonb_build_object(
          'at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'fromInitialization', v_continuation.initialization,
          'from', COALESCE(v_existing_opening_provenance, 'null'::jsonb),
          'toInitialization', p_initialized,
          'toSource', p_opening_mode,
          'toCutoffDate', p_opening_cutoff_date
        );
        v_opening_provenance := COALESCE(v_existing_opening_provenance, '{}'::jsonb)
          || jsonb_build_object(
               'source', p_opening_mode,
               'recordedAt', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'cutoffDate', p_opening_cutoff_date,
               'evidence', p_opening_evidence,
               'note', p_opening_note,
               'corrections', COALESCE(
                 v_existing_opening_provenance -> 'corrections',
                 '[]'::jsonb
               ),
               'evidenceUpgrade', v_evidence_upgrade
             );
      ELSE
        v_opening_provenance := COALESCE(
          v_existing_opening_provenance,
          v_opening_provenance
        );
      END IF;

      v_provenance := COALESCE(v_continuation.provenance, '{}'::jsonb)
        || (COALESCE(p_provenance, '{}'::jsonb) - 'opening' - 'evidenceUpgrade')
        || jsonb_build_object(
             'opening', v_opening_provenance,
             'continuedFrom', v_source.id
           );

      IF v_continuation.initialization IS DISTINCT FROM p_initialized
         OR v_continuation.provenance IS DISTINCT FROM v_provenance THEN
        UPDATE public.money_periods
        SET initialization = p_initialized,
            provenance = v_provenance,
            version = version + 1,
            updated_at = v_now
        WHERE id = v_successor_id AND owner_user_id = v_owner;
      END IF;
    END IF;

    -- Accepted settings overrides become a new append-only policy revision.
    -- With no overrides the continuation already copied the effective source
    -- policy, so no duplicate version is written.
    IF (p_settings IS NOT NULL AND p_settings <> '{}'::jsonb)
       OR NOT EXISTS (
         SELECT 1 FROM public.money_policy_versions
         WHERE owner_user_id = v_owner AND period_id = v_successor_id
       ) THEN
      SELECT COALESCE(max(version), 0) + 1 INTO v_policy_version
      FROM public.money_policy_versions
      WHERE owner_user_id = v_owner AND period_id = v_successor_id;
      INSERT INTO public.money_policy_versions (
        owner_user_id, period_id, version, effective_date, policy, created_at
      ) VALUES (
        v_owner, v_successor_id, v_policy_version, p_active_date,
        jsonb_build_object(
          'settings', v_successor_settings,
          'algorithmVersion', 'safe-flexible-start-of-day-v1',
          'rolledOverFrom', v_source.id
        ),
        v_now
      )
      RETURNING id INTO v_policy_id;
    END IF;

    -- Keep the mutable period copy aligned with an explicit override. The
    -- policy version remains authoritative; this avoids a stale fallback.
    IF p_settings IS NOT NULL AND p_settings <> '{}'::jsonb THEN
      UPDATE public.money_periods
      SET settings = v_successor_settings,
          version = version + 1,
          updated_at = v_now
      WHERE id = v_successor_id AND owner_user_id = v_owner;
    END IF;

    -- The continuation baseline (unavailable / initial_setup_incomplete) stays
    -- as retained history. The owner completes or rebases setup before the
    -- first successor day is closed.
  END IF;

  -- Generated occurrences come from the canonical recurrence rules resolved in
  -- the application. The stable idempotency key and the partial
  -- (owner, template, period_start) index make this regeneration idempotent.
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_occurrences, '[]'::jsonb))
  LOOP
    INSERT INTO public.money_obligations (
      owner_user_id, template_id, kind, description, amount_minor, currency,
      period_start, period_end, due_date, need_vs_want, purpose, counts_in_daily,
      category, state, state_effective_date, state_history, idempotency_key,
      create_fingerprint, version, created_at, updated_at
    ) VALUES (
      v_owner,
      NULLIF(v_item->'values'->>'templateId', '')::uuid,
      v_item->'values'->>'kind',
      v_item->'values'->>'description',
      (v_item->'values'->>'amountMinor')::integer,
      'MAD',
      (v_item->'values'->>'periodStart')::date,
      (v_item->'values'->>'periodEnd')::date,
      (v_item->'values'->>'dueDate')::date,
      NULLIF(v_item->'values'->>'needVsWant', ''),
      v_item->'values'->>'purpose',
      (v_item->'values'->>'countsInDaily')::boolean,
      NULLIF(v_item->'values'->>'category', ''),
      'pending',
      (v_item->'values'->>'stateEffectiveDate')::date,
      '[]'::jsonb,
      v_item->'values'->>'idempotencyKey',
      v_item->>'createFingerprint',
      1, v_now, v_now
    )
    ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;
    IF FOUND THEN
      v_generated := v_generated + 1;
    END IF;
  END LOOP;

  -- Explicit unpaid-item treatment. A template-backed occurrence is already
  -- regenerated by its template for the new period, so carry_forward applies to
  -- one-off occurrences; cancel is available for any pending occurrence.
  IF p_unpaid_treatment = 'cancel' THEN
    FOR v_source_occurrence IN
      SELECT * FROM public.money_obligations
      WHERE owner_user_id = v_owner
        AND state = 'pending'
        AND period_start <= v_source.end_date
        AND period_end >= v_source.start_date
      FOR UPDATE
    LOOP
      UPDATE public.money_obligations
      SET state = 'cancelled',
          state_effective_date = v_source.end_date,
          state_reason = left(btrim(p_unpaid_reason), 200),
          version = version + 1,
          updated_at = v_now
      WHERE id = v_source_occurrence.id
        AND owner_user_id = v_owner
        AND version = v_source_occurrence.version;
      IF FOUND THEN
        v_cancelled := v_cancelled + 1;
      ELSE
        RAISE EXCEPTION 'An unpaid occurrence changed during rollover.' USING ERRCODE = '40001';
      END IF;
    END LOOP;
  ELSIF p_unpaid_treatment = 'carry_forward' THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_carried_occurrences, '[]'::jsonb))
    LOOP
      SELECT * INTO v_source_occurrence
      FROM public.money_obligations
      WHERE id = (v_item->>'occurrenceId')::uuid
        AND owner_user_id = v_owner
        AND state = 'pending'
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A carried pending occurrence changed during rollover.'
          USING ERRCODE = '40001';
      END IF;
      IF v_source_occurrence.template_id IS NOT NULL THEN
        RAISE EXCEPTION 'A template-backed occurrence is regenerated by its template and cannot be carried forward as a second row.'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO public.money_obligations (
        owner_user_id, template_id, kind, description, amount_minor, currency,
        period_start, period_end, due_date, need_vs_want, purpose, counts_in_daily,
        category, state, state_effective_date, state_history, idempotency_key,
        create_fingerprint, version, created_at, updated_at
      ) VALUES (
        v_owner, NULL, v_source_occurrence.kind, v_source_occurrence.description,
        v_source_occurrence.amount_minor, 'MAD',
        (v_item->>'periodStart')::date, (v_item->>'periodEnd')::date,
        (v_item->>'dueDate')::date, v_source_occurrence.need_vs_want,
        COALESCE(v_source_occurrence.purpose, 'fixed'),
        COALESCE(v_source_occurrence.counts_in_daily, false),
        COALESCE(
          v_source_occurrence.category,
          CASE WHEN v_source_occurrence.kind = 'subscription'
            THEN 'subscriptions' ELSE 'bills' END
        ), 'pending',
        (v_item->>'periodStart')::date, '[]'::jsonb,
        v_item->>'idempotencyKey', v_item->>'createFingerprint',
        1, v_now, v_now
      )
      ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING;
      IF FOUND THEN
        v_carried := v_carried + 1;
      END IF;

      UPDATE public.money_obligations
      SET state = 'cancelled',
          state_effective_date = v_source.end_date,
          state_reason = left(btrim(p_unpaid_reason), 200),
          version = version + 1,
          updated_at = v_now
      WHERE id = v_source_occurrence.id
        AND owner_user_id = v_owner
        AND version = v_source_occurrence.version;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A carried pending occurrence changed during rollover.'
          USING ERRCODE = '40001';
      END IF;
      v_cancelled := v_cancelled + 1;
    END LOOP;
  END IF;

  UPDATE public.money_periods
  SET lifecycle = 'rolled_over',
      successor_period_id = v_successor_id,
      rolled_over_at = v_now,
      finalization_reference = COALESCE(finalization_reference, v_successor_id),
      version = version + 1,
      updated_at = v_now
  WHERE id = v_source.id AND owner_user_id = v_owner
  RETURNING * INTO v_source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source period could not be marked rolled over.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.money_period_rollovers (
    owner_user_id, source_period_id, successor_period_id, operation_id,
    request_fingerprint, opening_mode, opening_amount_minor, closing_cash_minor,
    closing_cutoff_date, unpaid_treatment, reconciliation_accepted_note,
    unverified_days_note, unverified_days_count,
    reconciliation, generated_occurrence_count, carried_occurrence_count,
    cancelled_occurrence_count, created_at
  ) VALUES (
    v_owner, v_source.id, v_successor_id, btrim(p_operation_id),
    p_request_fingerprint, p_opening_mode, p_opening_amount_minor,
    v_modeled_closing, v_source.end_date, p_unpaid_treatment,
    p_reconciliation_accepted_note, p_unverified_days_note, v_unverified_count,
    COALESCE(p_reconciliation, '{}'::jsonb) || jsonb_build_object('closeSummary', v_close_summary),
    v_generated, v_carried, v_cancelled, v_now
  )
  RETURNING * INTO v_record;

  RETURN jsonb_build_object('rollover', to_jsonb(v_record), 'replayed', false);
END
$rollover$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_rollover_period(
  uuid, integer, date, date, date, text, text, boolean,
  integer, date, text, text, text, jsonb, jsonb, text, text, text,
  text, text, text, text, integer, jsonb, jsonb, jsonb, timestamptz
) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_rollover_period(
  uuid, integer, date, date, date, text, text, boolean,
  integer, date, text, text, text, jsonb, jsonb, text, text, text,
  text, text, text, text, integer, jsonb, jsonb, jsonb, timestamptz
) TO authenticated;
--> statement-breakpoint
-- Compatibility overload for the pre-MONEY-001-A 25-argument RPC. A fully
-- closed source keeps working for existing callers; an unverified source is
-- refused by the new function because this overload cannot carry the retained
-- acknowledgment note. New callers should use the 27-argument signature.
CREATE OR REPLACE FUNCTION public.money_rollover_period(
  p_source_period_id uuid,
  p_expected_version integer,
  p_start_date date,
  p_end_date date,
  p_active_date date,
  p_timezone text,
  p_initialized text,
  p_allow_uncovered_days boolean,
  p_opening_amount_minor integer,
  p_opening_cutoff_date date,
  p_opening_evidence text,
  p_opening_note text,
  p_opening_create_fingerprint text,
  p_provenance jsonb,
  p_settings jsonb,
  p_operation_id text,
  p_request_fingerprint text,
  p_opening_mode text,
  p_unpaid_treatment text,
  p_unpaid_reason text,
  p_reconciliation_accepted_note text,
  p_reconciliation jsonb,
  p_occurrences jsonb,
  p_carried_occurrences jsonb,
  p_created_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $compat$
  SELECT public.money_rollover_period(
    p_source_period_id, p_expected_version, p_start_date, p_end_date,
    p_active_date, p_timezone, p_initialized, p_allow_uncovered_days,
    p_opening_amount_minor, p_opening_cutoff_date, p_opening_evidence,
    p_opening_note, p_opening_create_fingerprint, p_provenance, p_settings,
    p_operation_id, p_request_fingerprint, p_opening_mode, p_unpaid_treatment,
    p_unpaid_reason, p_reconciliation_accepted_note,
    NULL::text, 0::integer,
    p_reconciliation, p_occurrences, p_carried_occurrences, p_created_at
  );
$compat$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_rollover_period(
  uuid, integer, date, date, date, text, text, boolean,
  integer, date, text, text, text, jsonb, jsonb, text, text, text,
  text, text, text, jsonb, jsonb, jsonb, timestamptz
) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_rollover_period(
  uuid, integer, date, date, date, text, text, boolean,
  integer, date, text, text, text, jsonb, jsonb, text, text, text,
  text, text, text, jsonb, jsonb, jsonb, timestamptz
) TO authenticated;
