-- MONEY-09 review fixes.
--
-- 1. A transition to a new active date must not reuse a stale preexisting
--    baseline. It now appends a fresh canonical version, retaining history.
-- 2. The close reserve snapshot uses one inclusive close-date cutoff for cash,
--    commitments, funded savings and emergency usage, matching the canonical
--    calculateMoneyReserves composition. The day-start daily reference remains
--    a separate start-of-day projection.
-- 3. Once durable close evidence exists, active-date/lifecycle transitions are
--    close-driven. Direct table updates and the period settings RPC cannot skip
--    unclosed days, advance twice or rewind a closed date.
-- 4. Direct baseline/policy inserts are no longer available to authenticated
--    callers; the SECURITY DEFINER primitives remain the only writers.

-- Force a new versioned day-start snapshot for an active-date transition.
-- The previous versions stay as retained history.
CREATE OR REPLACE FUNCTION public.money_refresh_day_start_baseline(
  p_period_id uuid,
  p_date date
)
RETURNS public.money_day_start_baselines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $refresh$
BEGIN
  IF auth.uid() IS NULL OR (
    (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
    AND NOT public.mcp_finance_grant_allows('personal_ops.write')
  ) THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;
  RETURN public.money_calculate_day_start_baseline(p_period_id, p_date, true);
END
$refresh$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_refresh_day_start_baseline(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_refresh_day_start_baseline(uuid, date) TO authenticated;
--> statement-breakpoint

-- Period settings remain an explicit pre-close setup path. A forward move
-- refreshes the target day's snapshot instead of reusing an older version.
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

  IF v_period."active_date" > v_previous_active_date THEN
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

-- Durable close with a coherent end-of-day reserve snapshot and a fresh
-- next-day baseline. The day-start reference remains a separate projection.
CREATE OR REPLACE FUNCTION public.money_close_day(
  p_period_id uuid,
  p_expected_version integer,
  p_date date,
  p_note text,
  p_operation_id uuid,
  p_close_fingerprint text,
  p_included_movement_ids uuid[],
  p_created_at timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $close$
DECLARE
  v_owner uuid := auth.uid();
  v_period public.money_periods;
  v_existing public.money_day_closes;
  v_baseline public.money_day_start_baselines;
  v_policy public.money_policy_versions;
  v_close public.money_day_closes;
  v_opening integer;
  v_cash integer;
  v_expense integer := 0;
  v_daily integer := 0;
  v_flexible integer := 0;
  v_fixed integer := 0;
  v_emergency integer := 0;
  v_categories jsonb := '{}'::jsonb;
  v_funded integer := 0;
  v_emergency_used integer := 0;
  v_commitments integer := 0;
  v_unfunded_start integer;
  v_emergency_remaining_start integer;
  v_unfunded_cutoff integer;
  v_emergency_remaining_cutoff integer;
  v_safe_start integer;
  v_safe_cutoff integer;
  v_days integer;
  v_reference integer;
  v_daily_remaining integer;
  v_snapshot jsonb;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.jwt()) ->> 'client_id' IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.write') THEN
    RAISE EXCEPTION 'Finance write grant required' USING ERRCODE = '42501';
  END IF;

  -- Serialize every close for this period and read the current state once.
  SELECT * INTO v_period FROM public.money_periods
    WHERE id = p_period_id AND owner_user_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Operation replay is checked before version/date preconditions. After a
  -- successful close the original expected version and date are deliberately
  -- stale, so an ambiguous retry must still return the retained close.
  SELECT * INTO v_existing FROM public.money_day_closes
    WHERE owner_user_id = v_owner AND operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.close_fingerprint <> p_close_fingerprint THEN
      RETURN jsonb_build_object('status', 'operation_conflict');
    END IF;
    RETURN jsonb_build_object(
      'status', 'replayed',
      'close', to_jsonb(v_existing),
      'period', to_jsonb(v_period)
    );
  END IF;

  IF v_period.lifecycle <> 'tracking' THEN
    RETURN jsonb_build_object('status', 'period_not_tracking');
  END IF;
  IF p_expected_version IS NULL OR v_period.version <> p_expected_version THEN
    RETURN jsonb_build_object('status', 'stale_version');
  END IF;
  IF p_date IS NULL OR p_date < v_period.start_date OR p_date > v_period.end_date THEN
    RETURN jsonb_build_object('status', 'date_out_of_period');
  END IF;
  -- A lagging active date is never replaced by today, an earlier day is never
  -- skipped and a past day is never reopened for a routine close.
  IF p_date <> v_period.active_date THEN
    RETURN jsonb_build_object(
      'status', 'close_date_not_active',
      'detail', v_period.active_date::text
    );
  END IF;

  -- A distinct operation that repeats identical evidence replays it; a
  -- different snapshot for the same day is a conflict, never a second close.
  SELECT * INTO v_existing FROM public.money_day_closes
    WHERE owner_user_id = v_owner AND period_id = p_period_id
      AND close_date = p_date;
  IF FOUND THEN
    IF v_existing.close_fingerprint <> p_close_fingerprint THEN
      RETURN jsonb_build_object('status', 'duplicate_close');
    END IF;
    RETURN jsonb_build_object(
      'status', 'replayed',
      'close', to_jsonb(v_existing),
      'period', to_jsonb(v_period)
    );
  END IF;

  -- Every final purchase must already exist on this exact day/period.
  IF p_included_movement_ids IS NOT NULL
     AND cardinality(p_included_movement_ids) > 0 THEN
    IF cardinality(p_included_movement_ids) > 100 THEN
      RETURN jsonb_build_object(
        'status', 'included_movement_invalid',
        'detail', 'too many purchase identities'
      );
    END IF;
    IF cardinality(p_included_movement_ids) <> (
      SELECT count(DISTINCT entry.id)
      FROM unnest(p_included_movement_ids) AS entry(id)
    ) THEN
      RETURN jsonb_build_object(
        'status', 'included_movement_invalid',
        'detail', 'duplicate purchase identity'
      );
    END IF;
    IF (
      SELECT count(*)
      FROM public.personal_expenses e
      WHERE e.owner_user_id = v_owner
        AND e.period_id = p_period_id
        AND e.deleted_at IS NULL
        AND e.booking_date = p_date
        AND e.id = ANY(p_included_movement_ids)
    ) <> cardinality(p_included_movement_ids) THEN
      RETURN jsonb_build_object(
        'status', 'included_movement_invalid',
        'detail', 'missing or mismatched final purchase'
      );
    END IF;
  END IF;

  IF v_period.opening_movement_id IS NULL THEN
    RETURN jsonb_build_object('status', 'opening_unknown');
  END IF;
  SELECT amount_minor INTO v_opening FROM public.personal_expenses
    WHERE owner_user_id = v_owner AND period_id = p_period_id
      AND id = v_period.opening_movement_id
      AND kind = 'opening' AND deleted_at IS NULL;
  IF v_opening IS NULL THEN
    RETURN jsonb_build_object('status', 'opening_unknown');
  END IF;

  -- Close must snapshot a complete day-start baseline. Closing never
  -- materializes one on failure: setup/rebase is the explicit owner action.
  SELECT * INTO v_baseline FROM public.money_day_start_baselines
    WHERE owner_user_id = v_owner AND period_id = p_period_id AND date = p_date
    ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'baseline_unavailable',
      'detail', 'baseline_missing'
    );
  END IF;
  IF v_baseline.availability <> 'available' THEN
    RETURN jsonb_build_object(
      'status', 'baseline_unavailable',
      'detail', COALESCE(v_baseline.unavailable_reason, 'baseline_incomplete')
    );
  END IF;

  IF v_baseline.policy_version_id IS NOT NULL THEN
    SELECT * INTO v_policy FROM public.money_policy_versions
      WHERE owner_user_id = v_owner AND period_id = p_period_id
        AND id = v_baseline.policy_version_id;
  END IF;

  -- Recorded cash through the closed day; the opening is counted once and never
  -- as an inflow. Date-only and timestamped rows both use booking_date.
  SELECT (v_opening + COALESCE(sum(CASE
      WHEN kind = 'income'
        OR (kind = 'reconciliation_adjustment' AND direction = 'in') THEN amount_minor
      WHEN kind = 'expense'
        OR kind = 'savings_transfer'
        OR (kind = 'reconciliation_adjustment' AND direction = 'out') THEN -amount_minor
      ELSE 0 END), 0))::integer
    INTO v_cash
    FROM public.personal_expenses
    WHERE owner_user_id = v_owner AND period_id = p_period_id
      AND booking_date <= p_date AND deleted_at IS NULL AND kind <> 'opening';

  SELECT
    COALESCE(sum(amount_minor), 0)::integer,
    COALESCE(sum(amount_minor) FILTER (WHERE counts_in_daily), 0)::integer,
    COALESCE(sum(amount_minor) FILTER (WHERE purpose = 'flexible'), 0)::integer,
    COALESCE(sum(amount_minor) FILTER (WHERE purpose = 'fixed'), 0)::integer,
    COALESCE(sum(amount_minor) FILTER (WHERE purpose = 'emergency'), 0)::integer
    INTO v_expense, v_daily, v_flexible, v_fixed, v_emergency
    FROM public.personal_expenses
    WHERE owner_user_id = v_owner AND period_id = p_period_id
      AND booking_date = p_date AND kind = 'expense' AND direction = 'out'
      AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_object_agg(category, total), '{}'::jsonb)
    INTO v_categories
    FROM (
      SELECT category, sum(amount_minor)::integer AS total
      FROM public.personal_expenses
      WHERE owner_user_id = v_owner AND period_id = p_period_id
        AND booking_date = p_date AND kind = 'expense' AND direction = 'out'
        AND deleted_at IS NULL AND category IS NOT NULL
      GROUP BY category
    ) category_rows;

  -- End-of-day cutoff inputs. Cash, funded savings, emergency usage and
  -- outstanding commitments all use the inclusive close date, so the reserve
  -- snapshot matches the canonical calculateMoneyReserves composition.
  SELECT COALESCE(sum(amount_minor) FILTER (WHERE direction = 'out'), 0)::integer
    INTO v_funded
    FROM public.personal_expenses
    WHERE owner_user_id = v_owner AND period_id = p_period_id
      AND booking_date <= p_date AND deleted_at IS NULL
      AND kind = 'savings_transfer';

  SELECT COALESCE(sum(CASE
      WHEN direction = 'out' THEN amount_minor
      ELSE -amount_minor END), 0)::integer
    INTO v_emergency_used
    FROM public.personal_expenses
    WHERE owner_user_id = v_owner AND period_id = p_period_id
      AND booking_date <= p_date AND deleted_at IS NULL
      AND kind = 'expense' AND purpose = 'emergency';

  -- Obligations are evaluated at the end-of-day lifecycle cutoff, including
  -- transitions effective on the close date. An obligation created after the
  -- cutoff with no history is not retroactively reserved.
  SELECT COALESCE(sum(o.amount_minor) FILTER (WHERE h.state = 'pending'), 0)::integer
    INTO v_commitments
    FROM public.money_obligations o
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN jsonb_array_length(o.state_history) > 0 THEN
          COALESCE((
            SELECT e->>'state'
            FROM jsonb_array_elements(o.state_history) e
            WHERE (e->>'effectiveDate')::date <= p_date
            ORDER BY (e->>'effectiveDate')::date DESC,
              (e->>'version')::integer DESC
            LIMIT 1
          ), 'pending')
        WHEN o.created_at::date > p_date THEN NULL
        WHEN o.state = 'pending' OR o.state_effective_date <= p_date THEN o.state
        ELSE 'pending'
      END AS state
    ) h
    WHERE o.owner_user_id = v_owner
      AND o.period_start >= v_period.start_date
      AND o.period_end <= v_period.end_date
      AND o.period_start <= p_date
      AND o.period_end >= p_date;

  -- The daily reference is a start-of-day projection and deliberately keeps
  -- the retained day-start baseline. Reserves below use the close cutoff.
  v_unfunded_start := GREATEST(
    0, v_baseline.savings_target_minor - v_baseline.savings_funded_minor
  );
  v_emergency_remaining_start := GREATEST(
    0, v_baseline.emergency_target_minor - v_baseline.emergency_used_minor
  );
  v_safe_start := v_baseline.cash_minor - v_baseline.commitments_minor
    - v_unfunded_start - v_emergency_remaining_start;
  v_days := v_period.end_date - p_date + 1;
  IF v_days > 0 THEN
    v_reference := floor(GREATEST(0, v_safe_start)::numeric / v_days)::integer;
    v_daily_remaining := v_reference - v_daily;
  END IF;

  v_unfunded_cutoff := GREATEST(
    0, v_baseline.savings_target_minor - v_funded
  );
  v_emergency_remaining_cutoff := GREATEST(
    0, v_baseline.emergency_target_minor - v_emergency_used
  );
  v_safe_cutoff := v_cash - v_commitments
    - v_unfunded_cutoff - v_emergency_remaining_cutoff;

  v_snapshot := jsonb_build_object(
    'currency', 'MAD',
    'expenseTotalMinor', v_expense,
    'dailyIncludedSpendMinor', v_daily,
    'flexibleExpenseTotalMinor', v_flexible,
    'fixedExpenseTotalMinor', v_fixed,
    'emergencyExpenseTotalMinor', v_emergency,
    'categoryTotals', v_categories,
    'recordedCashMinor', v_cash,
    'recordedCashBasis', 'recorded',
    'dayStartBaseline', jsonb_build_object(
      'date', v_baseline.date,
      'version', v_baseline.version,
      'availability', v_baseline.availability,
      'policyVersionId', v_baseline.policy_version_id,
      'cashMinor', v_baseline.cash_minor,
      'commitmentsMinor', v_baseline.commitments_minor,
      'savingsTargetMinor', v_baseline.savings_target_minor,
      'savingsFundedMinor', v_baseline.savings_funded_minor,
      'emergencyTargetMinor', v_baseline.emergency_target_minor,
      'emergencyUsedMinor', v_baseline.emergency_used_minor
    ),
    'dailyReference', CASE WHEN v_days > 0 THEN jsonb_build_object(
      'available', true,
      'algorithm', v_baseline.algorithm_version,
      'daysRemaining', v_days,
      'safePoolMinor', v_safe_start,
      'referenceMinor', v_reference,
      'dailyRemainingMinor', v_daily_remaining
    ) ELSE jsonb_build_object('available', false, 'reason', 'no_days_left') END,
    'reserves', jsonb_build_object(
      'recordedCashMinor', v_cash,
      'unpaidCommitmentsMinor', v_commitments,
      'savingsTargetMinor', v_baseline.savings_target_minor,
      'fundedSavingsMinor', v_funded,
      'unfundedSavingsMinor', v_unfunded_cutoff,
      'emergencyTargetMinor', v_baseline.emergency_target_minor,
      'emergencyUsedMinor', v_emergency_used,
      'remainingEmergencyMinor', v_emergency_remaining_cutoff,
      'safeFlexibleMinor', v_safe_cutoff
    )
  );

  INSERT INTO public.money_day_closes (
    owner_user_id, period_id, close_date, status, note, operation_id,
    close_fingerprint, expected_period_version, period_version_after,
    active_date_after, lifecycle_after, is_final_day, algorithm_version,
    policy_version_id, policy_version, baseline_version,
    included_movement_ids, snapshot, created_at
  ) VALUES (
    v_owner, p_period_id, p_date, 'closed',
    COALESCE(NULLIF(btrim(p_note), ''), 'CLOSED'),
    p_operation_id,
    p_close_fingerprint, p_expected_version, p_expected_version + 1,
    CASE WHEN p_date = v_period.end_date THEN p_date ELSE p_date + 1 END,
    CASE WHEN p_date = v_period.end_date THEN 'ended' ELSE 'tracking' END,
    p_date = v_period.end_date,
    v_baseline.algorithm_version,
    v_baseline.policy_version_id, v_policy.version, v_baseline.version,
    COALESCE(p_included_movement_ids, '{}'::uuid[]), v_snapshot,
    COALESCE(p_created_at, now())
  ) RETURNING * INTO v_close;

  IF p_date = v_period.end_date THEN
    UPDATE public.money_periods
    SET lifecycle = 'ended',
        active_date = p_date,
        version = version + 1,
        updated_at = COALESCE(p_created_at, now())
    WHERE id = p_period_id AND owner_user_id = v_owner
    RETURNING * INTO v_period;
  ELSE
    UPDATE public.money_periods
    SET active_date = p_date + 1,
        version = version + 1,
        updated_at = COALESCE(p_created_at, now())
    WHERE id = p_period_id AND owner_user_id = v_owner
    RETURNING * INTO v_period;
    -- A target date may already have a baseline from an earlier forward/rewind
    -- cycle. Force a fresh canonical version so the next day never inherits a
    -- stale snapshot; the prior versions stay as history.
    PERFORM public.money_refresh_day_start_baseline(p_period_id, v_period.active_date);
  END IF;

  RETURN jsonb_build_object(
    'status', 'closed',
    'close', to_jsonb(v_close),
    'period', to_jsonb(v_period)
  );
END
$close$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_close_day(
  uuid, integer, date, text, uuid, text, uuid[], timestamp with time zone
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_close_day(
  uuid, integer, date, text, uuid, text, uuid[], timestamp with time zone
) TO authenticated;
--> statement-breakpoint

-- Once close evidence exists, period state transitions are close-driven.
-- Before the first close, MONEY-03/08 setup may still move the active date.
CREATE OR REPLACE FUNCTION public.enforce_money_period_close_transition()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $guard$
DECLARE
  v_has_close boolean;
  v_close public.money_day_closes;
BEGIN
  IF NEW.active_date IS NOT DISTINCT FROM OLD.active_date
     AND NEW.lifecycle IS NOT DISTINCT FROM OLD.lifecycle THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.money_day_closes
    WHERE owner_user_id = OLD.owner_user_id AND period_id = OLD.id
  ) INTO v_has_close;

  IF NOT v_has_close THEN
    RETURN NEW;
  END IF;

  IF NEW.active_date < OLD.active_date THEN
    RAISE EXCEPTION 'The active date cannot move backwards once a day has been closed; correct the closed day through versioned movements.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.active_date > OLD.active_date THEN
    IF NEW.active_date <> OLD.active_date + 1 THEN
      RAISE EXCEPTION 'The active date advances one calendar day per close; skipped days are not allowed.'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_close FROM public.money_day_closes
      WHERE owner_user_id = OLD.owner_user_id
        AND period_id = OLD.id
        AND close_date = OLD.active_date
        AND period_version_after = NEW.version
        AND active_date_after = NEW.active_date;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The active date advances only through the atomic day close.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
    IF OLD.lifecycle = 'tracking' AND NEW.lifecycle = 'ended' THEN
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
    ELSIF OLD.lifecycle = 'tracking' AND NEW.lifecycle = 'rolled_over' THEN
      RAISE EXCEPTION 'Rolling over a tracking period requires the explicit rollover operation.'
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

-- Baseline and policy rows are computed evidence, not directly editable input.
-- The SECURITY DEFINER primitives remain the only writers.
REVOKE INSERT ON public.money_day_start_baselines FROM authenticated;
--> statement-breakpoint
REVOKE INSERT ON public.money_policy_versions FROM authenticated;
