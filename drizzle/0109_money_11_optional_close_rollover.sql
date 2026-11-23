-- MONEY-001-A: optional day close and explicit finalization with unverified days.
--
-- 1. The active date is a calendar cursor, not a close-driven state machine.
--    Inside a tracking period it may move to any valid later or earlier date
--    without producing a close. The one retained boundary is close evidence:
--    the active date can never move to or behind a closed date. No close row is
--    ever inserted by a date move.
-- 2. A tracking period may be finalized by the explicit rollover transaction.
--    `tracking -> rolled_over` remains impossible for a direct table update:
--    the atomic rollover sets a non-granted finalization reference and a
--    successor link, and this guard re-checks both. A tracking -> ended
--    transition still needs either the final-day close or that same explicit
--    finalization reference, so an ended period keeps its existing meaning.
-- 3. Rollover finalization reviews the whole inclusive source period. Leading
--    days with no close and every other unclosed date are reported exactly and
--    must be acknowledged with a retained note; they are never fabricated as
--    close rows. A fully closed source keeps its previous behavior.
-- 4. The acknowledgement is stored on the rollover receipt (note + exact
--    reviewed count) so the owner's decision remains auditable. The reference
--    column is deliberately outside the authenticated UPDATE grant, so it
--    cannot be forged by a direct client update.
--
-- This migration only replaces guards/functions and adds nullable/defaulted
-- columns. It never edits an applied migration, never inserts close evidence
-- and never rewrites existing rollover or close rows.

ALTER TABLE public.money_periods
  ADD COLUMN IF NOT EXISTS "finalization_reference" uuid;
--> statement-breakpoint
ALTER TABLE public.money_period_rollovers
  ADD COLUMN IF NOT EXISTS "unverified_days_note" text;
--> statement-breakpoint
ALTER TABLE public.money_period_rollovers
  ADD COLUMN IF NOT EXISTS "unverified_days_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.money_period_rollovers
  DROP CONSTRAINT IF EXISTS "money_period_rollovers_unverified_days_count_check";
--> statement-breakpoint
ALTER TABLE public.money_period_rollovers
  ADD CONSTRAINT "money_period_rollovers_unverified_days_count_check"
  CHECK ("unverified_days_count" >= 0);
--> statement-breakpoint
ALTER TABLE public.money_period_rollovers
  DROP CONSTRAINT IF EXISTS "money_period_rollovers_unverified_days_note_check";
--> statement-breakpoint
ALTER TABLE public.money_period_rollovers
  ADD CONSTRAINT "money_period_rollovers_unverified_days_note_check"
  CHECK (
    "unverified_days_note" IS NULL
    OR char_length("unverified_days_note") BETWEEN 3 AND 500
  );
--> statement-breakpoint

-- The existing policy-revision trigger watched only UPDATE, so the first saved
-- savings/emergency target never established the policy version a close needs.
-- Review the initial plan through the same canonical revision function.
DROP TRIGGER IF EXISTS "money_budget_target_revision_insert" ON "public"."money_budget_plans";
CREATE TRIGGER "money_budget_target_revision_insert"
  AFTER INSERT ON "public"."money_budget_plans"
  FOR EACH ROW
  EXECUTE FUNCTION public.record_money_budget_target_revision();
--> statement-breakpoint

-- A new period always begins tracking with no finalization/rollover evidence.
-- The table-wide INSERT grant predates the rollover columns; without this guard
-- an authenticated caller could pre-seed finalization_reference and then pass
-- the lifecycle update guard. `money_create_period` and the rollover function
-- are SECURITY DEFINER and still insert valid tracking rows.
CREATE OR REPLACE FUNCTION public.enforce_money_period_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $insert_guard$
BEGIN
  IF NEW.lifecycle <> 'tracking'
     OR NEW.successor_period_id IS NOT NULL
     OR NEW.rolled_over_at IS NOT NULL
     OR NEW.finalization_reference IS NOT NULL THEN
    RAISE EXCEPTION 'A new Money period must start tracking without finalization evidence.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$insert_guard$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enforce_money_period_insert() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "money_periods_insert_guard" ON "public"."money_periods";
CREATE TRIGGER "money_periods_insert_guard"
  BEFORE INSERT ON "public"."money_periods"
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_period_insert();
--> statement-breakpoint

-- Calendar progression is independent of the optional close (MONEY-001 ID-07).
CREATE OR REPLACE FUNCTION public.enforce_money_period_close_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $guard$
DECLARE
  v_last_close date;
  v_close public.money_day_closes;
BEGIN
  -- The finalization reference is internal proof written only by the definer
  -- rollover transaction. Authenticated callers have no UPDATE grant for it.
  -- It may be set when finalization starts but can never be replaced or cleared.
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
      -- The explicit rollover transaction ends its source with a non-granted
      -- finalization reference before creating the single successor. This
      -- intermediate state is never visible outside that transaction. Routine
      -- finalization still requires the durable final-day close evidence.
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
    ELSIF NEW.lifecycle = 'rolled_over'
          AND OLD.lifecycle IN ('tracking', 'ended') THEN
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

CREATE OR REPLACE FUNCTION public.money_rollover_close_snapshot_summary(
  p_period_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $close_summary$
DECLARE
  v_owner uuid := auth.uid();
  v_period public.money_periods;
  v_opening integer;
  v_count integer := 0;
  v_last date;
  v_close public.money_day_closes;
  v_totals jsonb;
  v_ledger jsonb;
  v_cash integer;
  v_changed text[];
  v_differences jsonb := '[]'::jsonb;
  v_restated_count integer := 0;
  v_paid_count integer := 0;
  v_paid_mismatch integer := 0;
  v_visit_count integer := 0;
  v_visit_mismatch integer := 0;
  v_savings_target integer;
  v_savings_transferred integer := 0;
  v_policy public.money_policy_versions;
  v_settings jsonb;
  v_first_close date;
  v_missing_dates text[] := ARRAY[]::text[];
  v_closed_dates text[] := ARRAY[]::text[];
  v_period_days integer;
  v_required_closes integer;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.read') THEN
    RAISE EXCEPTION 'Money read grant required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_period
  FROM public.money_periods
  WHERE id = p_period_id AND owner_user_id = v_owner;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('available', false, 'reason', 'source_period_not_found');
  END IF;

  SELECT count(*)::integer, max(close_date), min(close_date)
    INTO v_count, v_last, v_first_close
    FROM public.money_day_closes
    WHERE owner_user_id = v_owner AND period_id = p_period_id;

  -- Finalization reviews the whole inclusive period. Leading days before the
  -- first close are unverified evidence too; they are listed and acknowledged,
  -- never silently treated as verified. A period with no closes at all is a
  -- legal rollover source once its owner accepts every unclosed day.
  v_period_days := v_period.end_date - v_period.start_date + 1;
  v_required_closes := v_period_days;
  SELECT COALESCE(array_agg(day::date::text ORDER BY day), ARRAY[]::text[])
    INTO v_missing_dates
    FROM generate_series(
      v_period.start_date::timestamp,
      v_period.end_date::timestamp,
      interval '1 day'
    ) AS day
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.money_day_closes AS closing
      WHERE closing.owner_user_id = v_owner
        AND closing.period_id = p_period_id
        AND closing.close_date = day::date
    );
  SELECT COALESCE(array_agg(close_date::text ORDER BY close_date), ARRAY[]::text[])
    INTO v_closed_dates
    FROM public.money_day_closes
    WHERE owner_user_id = v_owner AND period_id = p_period_id;

  SELECT amount_minor INTO v_opening
  FROM public.personal_expenses
  WHERE owner_user_id = v_owner
    AND id = v_period.opening_movement_id
    AND kind = 'opening'
    AND deleted_at IS NULL;
  IF v_opening IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'opening_unknown');
  END IF;

  FOR v_close IN
    SELECT * FROM public.money_day_closes
    WHERE owner_user_id = v_owner
      AND period_id = p_period_id
    ORDER BY close_date
  LOOP
    v_totals := public.money_day_expense_totals(p_period_id, v_close.close_date);
    v_ledger := public.money_ledger_direction_totals(v_period.start_date, v_close.close_date);
    v_cash := v_opening
      + COALESCE((v_ledger ->> 'inflowsMinor')::integer, 0)
      - COALESCE((v_ledger ->> 'outflowsMinor')::integer, 0);

    v_changed := ARRAY[]::text[];
    IF (v_close.snapshot ->> 'expenseTotalMinor') IS DISTINCT FROM (v_totals ->> 'expenseTotalMinor') THEN
      v_changed := array_append(v_changed, 'expenseTotal');
    END IF;
    IF (v_close.snapshot ->> 'dailyIncludedSpendMinor') IS DISTINCT FROM (v_totals ->> 'dailyIncludedSpendMinor') THEN
      v_changed := array_append(v_changed, 'dailyIncludedSpend');
    END IF;
    IF (v_close.snapshot ->> 'flexibleExpenseTotalMinor') IS DISTINCT FROM (v_totals ->> 'flexibleExpenseTotalMinor') THEN
      v_changed := array_append(v_changed, 'flexibleExpenseTotal');
    END IF;
    IF (v_close.snapshot ->> 'fixedExpenseTotalMinor') IS DISTINCT FROM (v_totals ->> 'fixedExpenseTotalMinor') THEN
      v_changed := array_append(v_changed, 'fixedExpenseTotal');
    END IF;
    IF (v_close.snapshot ->> 'emergencyExpenseTotalMinor') IS DISTINCT FROM (v_totals ->> 'emergencyExpenseTotalMinor') THEN
      v_changed := array_append(v_changed, 'emergencyExpenseTotal');
    END IF;
    IF COALESCE(v_close.snapshot -> 'categoryTotals', '{}'::jsonb)
       IS DISTINCT FROM COALESCE(v_totals -> 'categoryTotals', '{}'::jsonb) THEN
      v_changed := array_append(v_changed, 'categoryTotals');
    END IF;
    IF (v_close.snapshot ->> 'recordedCashMinor') IS DISTINCT FROM v_cash::text THEN
      v_changed := array_append(v_changed, 'recordedCash');
    END IF;

    IF cardinality(v_changed) > 0 THEN
      v_restated_count := v_restated_count + 1;
      v_differences := v_differences || jsonb_build_array(jsonb_build_object(
        'closeId', v_close.id,
        'closeDate', v_close.close_date,
        'changedFields', to_jsonb(v_changed)
      ));
    END IF;
  END LOOP;

  -- Paid obligations must each have exactly one live canonical payment. MONEY-07
  -- enforces this, so a nonzero mismatch is a repair signal, never a silent pass.
  SELECT count(*)::integer,
         count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM public.personal_expenses AS payment
           WHERE payment.id = obligation.payment_expense_id
             AND payment.owner_user_id = obligation.owner_user_id
             AND payment.kind = 'expense'
             AND payment.direction = 'out'
             AND payment.deleted_at IS NULL
             AND payment.amount_minor = obligation.amount_minor
         ))::integer
    INTO v_paid_count, v_paid_mismatch
    FROM public.money_obligations AS obligation
    WHERE obligation.owner_user_id = v_owner
      AND obligation.state = 'paid'
      AND obligation.payment_expense_id IS NOT NULL
      AND obligation.period_start <= v_period.end_date
      AND obligation.period_end >= v_period.start_date;

  -- A counted visit needs at least one live ledger line and no stale/deleted
  -- line. The visit itself never stores a second cash amount.
  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE NOT EXISTS (
             SELECT 1
             FROM public.money_coffee_visit_lines AS line
             JOIN public.personal_expenses AS expense
               ON expense.id = line.expense_id
              AND expense.owner_user_id = line.owner_user_id
              AND expense.deleted_at IS NULL
             WHERE line.visit_id = visit.id
               AND line.owner_user_id = visit.owner_user_id
           )
           OR EXISTS (
             SELECT 1
             FROM public.money_coffee_visit_lines AS line
             LEFT JOIN public.personal_expenses AS expense
               ON expense.id = line.expense_id
              AND expense.owner_user_id = line.owner_user_id
              AND expense.deleted_at IS NULL
             WHERE line.visit_id = visit.id
               AND line.owner_user_id = visit.owner_user_id
               AND expense.id IS NULL
           )
         )::integer
    INTO v_visit_count, v_visit_mismatch
    FROM public.money_coffee_visits AS visit
    WHERE visit.owner_user_id = v_owner
      AND visit.local_date >= v_period.start_date
      AND visit.local_date <= v_period.end_date;

  SELECT * INTO v_policy
  FROM public.money_policy_versions
  WHERE owner_user_id = v_owner AND period_id = p_period_id
  ORDER BY effective_date DESC, version DESC
  LIMIT 1;
  v_settings := COALESCE(v_policy.policy -> 'settings', v_period.settings, '{}'::jsonb);

  v_savings_target := CASE
    WHEN jsonb_typeof(v_settings -> 'savingsTargetMinor') = 'number'
      THEN (v_settings ->> 'savingsTargetMinor')::integer
    ELSE NULL
  END;
  SELECT COALESCE(sum(amount_minor), 0)::integer INTO v_savings_transferred
  FROM public.personal_expenses
  WHERE owner_user_id = v_owner
    AND kind = 'savings_transfer'
    AND booking_date >= v_period.start_date
    AND booking_date <= v_period.end_date
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'available', true,
    'closeCount', v_count,
    'closedDates', to_jsonb(v_closed_dates),
    'periodDayCount', v_period_days,
    'requiredCloseCount', v_required_closes,
    'trackedFromDate', v_first_close,
    'missingCloseDates', to_jsonb(v_missing_dates),
    'unverifiedDayCount', cardinality(v_missing_dates),
    'completeCloseEvidence', cardinality(v_missing_dates) = 0,
    'lastClosedDate', v_last,
    'comparableToRestatedTotals', true,
    'restatedDifferenceCount', v_restated_count,
    'restatedDifferences', v_differences,
    'paidObligationCount', v_paid_count,
    'paidObligationMismatchCount', v_paid_mismatch,
    'countedVisitCount', v_visit_count,
    'countedVisitMismatchCount', v_visit_mismatch,
    'savingsTargetMinor', v_savings_target,
    'savingsTransferredMinor', v_savings_transferred
  );
END
$close_summary$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_rollover_close_snapshot_summary(uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_rollover_close_snapshot_summary(uuid) TO authenticated;
--> statement-breakpoint

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
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'Only a tracking period accepts routine settings changes.'
      USING ERRCODE = '23514';
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

    UPDATE public.money_periods
    SET "active_date" = COALESCE(p_active_date, "active_date"),
        "settings" = COALESCE(p_settings, "settings"),
        "initialization" = p_initialization,
        "opening_movement_id" = v_opening."id",
        "provenance" = p_provenance,
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
REVOKE ALL ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_update_period(
  uuid, integer, date, jsonb, integer, text, text, jsonb, text, timestamp with time zone
) TO authenticated;
--> statement-breakpoint

-- The active date is a financial baseline cutoff. The definitions RPC above
-- (and the close/rollover definitions) are the only writers; a direct column
-- update could skip the fresh day-start baseline. Reading remains granted.
REVOKE UPDATE ("active_date") ON TABLE public.money_periods FROM authenticated;
--> statement-breakpoint

-- Replace the rollover RPC with the finalization variant. The old signature is dropped so PostgREST cannot resolve an obsolete overload.
DROP FUNCTION IF EXISTS public.money_rollover_period(
  uuid, integer, date, date, date, text, text, boolean,
  integer, date, text, text, text, jsonb, jsonb, text, text, text,
  text, text, text, jsonb, jsonb, jsonb, timestamptz
);
--> statement-breakpoint
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
  IF v_source.lifecycle NOT IN ('tracking', 'ended') THEN
    RAISE EXCEPTION 'Only a tracking or ended period can be rolled over.'
      USING ERRCODE = '23514';
  END IF;
  IF v_source.successor_period_id IS NOT NULL THEN
    RAISE EXCEPTION 'This period already has a successor.' USING ERRCODE = '23505';
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

  IF EXISTS (
    SELECT 1 FROM public.money_periods AS existing
    WHERE existing.owner_user_id = v_owner
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

  -- The explicit finalization owns this transaction. End the reviewed source
  -- before inserting the successor so the owner's one-tracking-period invariant
  -- holds inside the transaction; the final update below links and marks it
  -- rolled_over. `finalization_reference` is internal proof written only by this
  -- definer function and cannot be set through the authenticated column grant.
  UPDATE public.money_periods
  SET lifecycle = 'ended',
      finalization_reference = v_successor_id,
      version = version + 1,
      updated_at = p_created_at
  WHERE id = v_source.id AND owner_user_id = v_owner
  RETURNING * INTO v_source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The source period could not enter finalization.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.money_periods (
    id, owner_user_id, start_date, end_date, currency, timezone, active_date,
    lifecycle, initialization, opening_movement_id, provenance, settings,
    version, created_at, updated_at
  ) VALUES (
    v_successor_id, v_owner, p_start_date, p_end_date, 'MAD', btrim(p_timezone),
    p_active_date, 'tracking', 'uninitialized', NULL, p_provenance, v_successor_settings,
    1, p_created_at, p_created_at
  );

  INSERT INTO public.personal_expenses (
    owner_user_id, occurred_at, amount_minor, currency, category, note, merchant,
    need_vs_want, payment_method, idempotency_key, create_fingerprint, kind,
    direction, booking_date, counts_in_daily, period_id, created_at, updated_at
  ) VALUES (
    v_owner, NULL, p_opening_amount_minor, 'MAD', NULL, p_opening_note, NULL,
    NULL, NULL, 'opening:' || v_successor_id, p_opening_create_fingerprint,
    'opening', 'in', p_start_date, false, v_successor_id, p_created_at, p_created_at
  )
  RETURNING id INTO v_opening_id;

  UPDATE public.money_periods
  SET initialization = p_initialized,
      opening_movement_id = v_opening_id,
      provenance = p_provenance,
      version = version + 1,
      updated_at = p_created_at
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
    p_created_at
  )
  RETURNING id INTO v_policy_id;

  INSERT INTO public.money_day_start_baselines (
    owner_user_id, period_id, date, version, policy_version_id, algorithm_version,
    availability, unavailable_reason, inputs, created_at
  ) VALUES (
    v_owner, v_successor_id, p_active_date, 1, v_policy_id,
    'safe-flexible-start-of-day-v1', 'unavailable', 'initial_setup_incomplete',
    jsonb_build_object('setupComplete', false, 'rolledOverFrom', v_source.id),
    p_created_at
  );

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
      1, p_created_at, p_created_at
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
          updated_at = p_created_at
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
        1, p_created_at, p_created_at
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
          updated_at = p_created_at
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
      rolled_over_at = p_created_at,
      finalization_reference = COALESCE(finalization_reference, v_successor_id),
      version = version + 1,
      updated_at = p_created_at
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
    v_generated, v_carried, v_cancelled, p_created_at
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
