-- MONEY-10: explicit period rollover without history loss.
--
-- Isolation note: this branch intentionally allocates journal tag 0110 and
-- `when` 1787880000073 so the concurrent MONEY-09 day-close work can take the
-- 0104–0109 range. The two branches must not share a migration tag. If MONEY-09
-- is merged first, renumber this file to the next free tag without editing its
-- content semantics.
--
-- Dependency: MONEY-09 owns the durable day close and is the only producer of
-- `money_periods.lifecycle = 'ended'` with `active_date = end_date`. This
-- migration never fabricates close data; it requires that finished state and
-- stores its own successor link, rollover receipt and correction-bridge rows.
-- The close-snapshot restatement comparison is read through the application
-- port and stays unavailable until MONEY-09 supplies it.
--
-- What this adds (additive only, no second ledger/period/opening owner):
--   1. `money_periods.successor_period_id` and `rolled_over_at`: one successor
--      link per source period, enforced by unique indexes and the update guard.
--   2. `money_period_rollovers`: the idempotent rollover receipt (operation id,
--      request fingerprint, accepted reconciliation provenance, counts).
--   3. `money_period_rollover_bridges`: provenance-linked downstream
--      corrections. A bridge row is either an applied
--      `reconciliation_adjustment` in a derived successor or an explicit
--      variance disclosure where an independently verified opening must not be
--      altered.
--   4. `money_rollover_period(...)`: ONE owner-scoped transaction that creates
--      the successor period, its single opening movement, its initial policy
--      version/day-start baseline, generated occurrences and the source
--      lifecycle link. It re-derives modeled closing cash inside the
--      transaction, so a stale preview is a conflict rather than a silently
--      different opening.
--   5. `money_apply_rollover_bridge(...)`: the compound correction seam for
--      MONEY-09's correction path. It applies only the incremental delta, is
--      idempotent on `bridge:<source>:<correctionVersion>:<destination>` and
--      never mutates a verified opening snapshot.

ALTER TABLE public.money_periods
  ADD COLUMN IF NOT EXISTS successor_period_id uuid;
--> statement-breakpoint
ALTER TABLE public.money_periods
  ADD COLUMN IF NOT EXISTS rolled_over_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.money_periods
  DROP CONSTRAINT IF EXISTS money_periods_successor_not_self_check;
--> statement-breakpoint
ALTER TABLE public.money_periods
  ADD CONSTRAINT money_periods_successor_not_self_check
  CHECK (successor_period_id IS NULL OR successor_period_id <> id);
--> statement-breakpoint
ALTER TABLE public.money_periods
  DROP CONSTRAINT IF EXISTS money_periods_successor_period_id_fkey;
--> statement-breakpoint
ALTER TABLE public.money_periods
  ADD CONSTRAINT money_periods_successor_period_id_fkey
  FOREIGN KEY (owner_user_id, successor_period_id)
  REFERENCES public.money_periods(owner_user_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
-- One successor per source row (the source column) and one predecessor per
-- successor row (the successor column). A period can never be consumed twice
-- or be claimed by two different sources.
CREATE UNIQUE INDEX IF NOT EXISTS money_periods_owner_successor_unique
  ON public.money_periods(owner_user_id, successor_period_id)
  WHERE successor_period_id IS NOT NULL;
--> statement-breakpoint

-- Period update guard: keep every existing invariant and make the successor
-- link append-only. The link may only appear together with `rolled_over`.
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
    (OLD."lifecycle" = 'tracking' AND NEW."lifecycle" IN ('tracking', 'ended', 'rolled_over'))
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

CREATE TABLE IF NOT EXISTS public.money_period_rollovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_period_id uuid NOT NULL,
  successor_period_id uuid NOT NULL,
  operation_id varchar(128) NOT NULL,
  request_fingerprint varchar(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  opening_mode varchar(24) NOT NULL CHECK (opening_mode IN ('carry_forward', 'verified_source')),
  opening_amount_minor integer NOT NULL CHECK (opening_amount_minor >= 0),
  closing_cash_minor integer,
  closing_cutoff_date date NOT NULL,
  unpaid_treatment varchar(24)
    CHECK (unpaid_treatment IS NULL OR unpaid_treatment IN ('keep_pending', 'carry_forward', 'cancel')),
  reconciliation_accepted_note varchar(500),
  reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(reconciliation) = 'object'),
  generated_occurrence_count integer NOT NULL DEFAULT 0 CHECK (generated_occurrence_count >= 0),
  carried_occurrence_count integer NOT NULL DEFAULT 0 CHECK (carried_occurrence_count >= 0),
  cancelled_occurrence_count integer NOT NULL DEFAULT 0 CHECK (cancelled_occurrence_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT money_period_rollovers_operation_check CHECK (btrim(operation_id) <> ''),
  CONSTRAINT money_period_rollovers_distinct_periods_check
    CHECK (source_period_id <> successor_period_id),
  FOREIGN KEY (owner_user_id, source_period_id)
    REFERENCES public.money_periods(owner_user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id, successor_period_id)
    REFERENCES public.money_periods(owner_user_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, operation_id),
  UNIQUE (owner_user_id, source_period_id),
  UNIQUE (owner_user_id, successor_period_id)
);
--> statement-breakpoint
ALTER TABLE public.money_period_rollovers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_period_rollovers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS money_period_rollovers_owner_select ON public.money_period_rollovers;
CREATE POLICY money_period_rollovers_owner_select ON public.money_period_rollovers
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_period_rollovers FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.money_period_rollovers TO authenticated;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.money_period_rollover_bridges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_period_id uuid NOT NULL,
  destination_period_id uuid NOT NULL,
  movement_id uuid NOT NULL,
  correction_version integer NOT NULL CHECK (correction_version > 0),
  identity varchar(200) NOT NULL CHECK (btrim(identity) <> ''),
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  direction varchar(3) NOT NULL CHECK (direction IN ('in', 'out')),
  booking_date date NOT NULL,
  adjustment_expense_id uuid REFERENCES public.personal_expenses(id) ON DELETE RESTRICT,
  applied boolean NOT NULL DEFAULT false,
  variance_reason varchar(48)
    CHECK (variance_reason IS NULL OR variance_reason IN ('verified_opening_covered_cutoff', 'verified_opening_excludes_correction')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT money_period_rollover_bridges_applied_check
    CHECK (
      (applied AND adjustment_expense_id IS NOT NULL AND variance_reason IS NULL)
      OR (NOT applied AND adjustment_expense_id IS NULL AND variance_reason IS NOT NULL)
    ),
  FOREIGN KEY (owner_user_id, source_period_id)
    REFERENCES public.money_periods(owner_user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id, destination_period_id)
    REFERENCES public.money_periods(owner_user_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, identity)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS money_period_rollover_bridges_destination_idx
  ON public.money_period_rollover_bridges(owner_user_id, destination_period_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE public.money_period_rollover_bridges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_period_rollover_bridges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS money_period_rollover_bridges_owner_select ON public.money_period_rollover_bridges;
CREATE POLICY money_period_rollover_bridges_owner_select ON public.money_period_rollover_bridges
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_period_rollover_bridges FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.money_period_rollover_bridges TO authenticated;
--> statement-breakpoint

-- Atomic rollover. SECURITY DEFINER is used only to compose the existing
-- owner-scoped writes (period, opening movement, policy/baseline, occurrences)
-- in one transaction; every statement filters `owner_user_id = auth.uid()` and
-- no parameter can select an owner. RLS remains authoritative for direct table
-- access, and the tables above grant no INSERT/UPDATE to clients.
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
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
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
  IF v_source.lifecycle <> 'ended' THEN
    RAISE EXCEPTION 'Only an ended period can be rolled over. Close the final day first.'
      USING ERRCODE = '23514';
  END IF;
  IF v_source.active_date <> v_source.end_date THEN
    RAISE EXCEPTION 'The source period still has unclosed tracked days.'
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
  IF p_unpaid_treatment IS NOT NULL
     AND p_unpaid_treatment NOT IN ('keep_pending', 'carry_forward', 'cancel') THEN
    RAISE EXCEPTION 'The unpaid-item treatment is invalid.' USING ERRCODE = '23514';
  END IF;
  IF p_unpaid_treatment IN ('carry_forward', 'cancel')
     AND NULLIF(btrim(COALESCE(p_unpaid_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Cancelling or carrying forward unpaid occurrences needs a reason.'
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
    WHERE existing.owner_user_id = v_owner AND existing.lifecycle = 'tracking'
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

  INSERT INTO public.money_periods (
    id, owner_user_id, start_date, end_date, currency, timezone, active_date,
    lifecycle, initialization, opening_movement_id, provenance, settings,
    version, created_at, updated_at
  ) VALUES (
    v_successor_id, v_owner, p_start_date, p_end_date, 'MAD', btrim(p_timezone),
    p_active_date, 'tracking', 'uninitialized', NULL, p_provenance, p_settings,
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
      'settings', p_settings,
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
        v_source_occurrence.purpose, v_source_occurrence.counts_in_daily,
        v_source_occurrence.category, 'pending',
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
    reconciliation, generated_occurrence_count, carried_occurrence_count,
    cancelled_occurrence_count, created_at
  ) VALUES (
    v_owner, v_source.id, v_successor_id, btrim(p_operation_id),
    p_request_fingerprint, p_opening_mode, p_opening_amount_minor,
    v_modeled_closing, v_source.end_date, p_unpaid_treatment,
    p_reconciliation_accepted_note, COALESCE(p_reconciliation, '{}'::jsonb),
    v_generated, v_carried, v_cancelled, p_created_at
  )
  RETURNING * INTO v_record;

  RETURN jsonb_build_object('rollover', to_jsonb(v_record), 'replayed', false);
END
$rollover$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_rollover_period(
  uuid, integer, date, date, date, text, text, boolean, integer, date, text, text,
  text, jsonb, jsonb, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamp with time zone
) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_rollover_period(
  uuid, integer, date, date, date, text, text, boolean, integer, date, text, text,
  text, jsonb, jsonb, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamp with time zone
) TO authenticated;
--> statement-breakpoint

-- Compound downstream correction seam. MONEY-09's correction path calls this
-- inside the same transaction as the source movement edit/delete. It applies
-- only the incremental delta and never touches a verified opening snapshot.
CREATE OR REPLACE FUNCTION public.money_apply_rollover_bridge(
  p_movement_id uuid,
  p_previous_cash_delta_minor integer,
  p_new_cash_delta_minor integer,
  p_correction_version integer,
  p_correction_date date,
  p_created_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bridge$
DECLARE
  v_owner uuid := auth.uid();
  v_movement public.personal_expenses;
  v_current public.money_periods;
  v_next public.money_periods;
  v_delta integer;
  v_identity text;
  v_direction text;
  v_bridge_id uuid;
  v_adjustment_id uuid;
  v_postings integer := 0;
  v_variances integer := 0;
  v_replayed integer := 0;
  v_destinations uuid[] := '{}';
  v_reason text;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF p_correction_version IS NULL OR p_correction_version < 1 THEN
    RAISE EXCEPTION 'A positive correction version is required.' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_movement
  FROM public.personal_expenses
  WHERE id = p_movement_id AND owner_user_id = v_owner;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The corrected movement was not found.' USING ERRCODE = 'P0002';
  END IF;

  v_delta := p_new_cash_delta_minor - p_previous_cash_delta_minor;
  IF v_delta = 0 OR v_movement.period_id IS NULL THEN
    RETURN jsonb_build_object(
      'postings', 0, 'variances', 0, 'replayed', 0,
      'destination_period_ids', to_jsonb(v_destinations)
    );
  END IF;

  SELECT * INTO v_current
  FROM public.money_periods
  WHERE id = v_movement.period_id AND owner_user_id = v_owner
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'postings', 0, 'variances', 0, 'replayed', 0,
      'destination_period_ids', to_jsonb(v_destinations)
    );
  END IF;

  -- Post-cutoff corrections never bridge a balance that never included them.
  IF v_movement.booking_date > v_current.end_date THEN
    RETURN jsonb_build_object(
      'postings', 0, 'variances', 0, 'replayed', 0,
      'destination_period_ids', to_jsonb(v_destinations)
    );
  END IF;

  LOOP
    SELECT * INTO v_next
    FROM public.money_periods
    WHERE id = v_current.successor_period_id AND owner_user_id = v_owner
    FOR UPDATE;
    EXIT WHEN NOT FOUND;

    v_identity := 'bridge:' || v_current.id || ':' || p_correction_version || ':' || v_next.id;
    v_direction := CASE WHEN v_delta > 0 THEN 'in' ELSE 'out' END;

    IF v_next.initialization = 'reconciled'
       AND COALESCE(v_next.provenance #>> '{opening,source}', '') = 'verified_source' THEN
      v_reason := CASE
        WHEN v_movement.booking_date <= COALESCE(
          NULLIF(v_next.provenance #>> '{opening,cutoffDate}', '')::date,
          v_next.start_date
        ) THEN 'verified_opening_covered_cutoff'
        ELSE 'verified_opening_excludes_correction'
      END;
      INSERT INTO public.money_period_rollover_bridges (
        owner_user_id, source_period_id, destination_period_id, movement_id,
        correction_version, identity, amount_minor, direction, booking_date,
        adjustment_expense_id, applied, variance_reason, created_at
      ) VALUES (
        v_owner, v_current.id, v_next.id, v_movement.id, p_correction_version,
        v_identity, abs(v_delta), v_direction, v_next.start_date,
        NULL, false, v_reason, p_created_at
      )
      ON CONFLICT (owner_user_id, identity) DO NOTHING
      RETURNING id INTO v_bridge_id;
      IF v_bridge_id IS NOT NULL THEN
        v_variances := v_variances + 1;
      END IF;
      v_destinations := array_append(v_destinations, v_next.id);
      EXIT;
    END IF;

    -- Insert the canonical adjustment first: the ledger's own
    -- (owner, idempotency_key) uniqueness is the retry fence. The bridge row is
    -- written with its final adjustment link so the applied check holds at
    -- insert time.
    INSERT INTO public.personal_expenses (
      owner_user_id, occurred_at, amount_minor, currency, category, note,
      merchant, need_vs_want, payment_method, idempotency_key,
      create_fingerprint, kind, direction, booking_date, counts_in_daily,
      period_id, created_at, updated_at
    ) VALUES (
      v_owner, NULL, abs(v_delta), 'MAD', NULL,
      left('Reconciliation bridge from period ' || v_current.id
        || ' correction of movement ' || v_movement.id
        || ' version ' || p_correction_version, 500),
      NULL, NULL, NULL, v_identity,
      md5(v_identity) || md5(v_identity || ':receipt'),
      'reconciliation_adjustment', v_direction, v_next.start_date, false,
      v_next.id, p_created_at, p_created_at
    )
    ON CONFLICT (owner_user_id, idempotency_key) DO NOTHING
    RETURNING id INTO v_adjustment_id;

    IF v_adjustment_id IS NULL THEN
      SELECT adjustment.id INTO v_adjustment_id
      FROM public.personal_expenses AS adjustment
      WHERE adjustment.owner_user_id = v_owner
        AND adjustment.idempotency_key = v_identity
        AND adjustment.kind = 'reconciliation_adjustment';
      IF v_adjustment_id IS NULL THEN
        RAISE EXCEPTION 'The bridge identity collides with an unrelated ledger row.'
          USING ERRCODE = '23505';
      END IF;
      v_replayed := v_replayed + 1;
    ELSE
      v_postings := v_postings + 1;
    END IF;

    INSERT INTO public.money_period_rollover_bridges (
      owner_user_id, source_period_id, destination_period_id, movement_id,
      correction_version, identity, amount_minor, direction, booking_date,
      adjustment_expense_id, applied, variance_reason, created_at
    ) VALUES (
      v_owner, v_current.id, v_next.id, v_movement.id, p_correction_version,
      v_identity, abs(v_delta), v_direction, v_next.start_date,
      v_adjustment_id, true, NULL, p_created_at
    )
    ON CONFLICT (owner_user_id, identity) DO NOTHING;

    v_destinations := array_append(v_destinations, v_next.id);
    v_current := v_next;
  END LOOP;

  RETURN jsonb_build_object(
    'postings', v_postings,
    'variances', v_variances,
    'replayed', v_replayed,
    'destination_period_ids', to_jsonb(v_destinations)
  );
END
$bridge$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_apply_rollover_bridge(
  uuid, integer, integer, integer, date, timestamp with time zone
) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.money_apply_rollover_bridge(
  uuid, integer, integer, integer, date, timestamp with time zone
) TO authenticated;
