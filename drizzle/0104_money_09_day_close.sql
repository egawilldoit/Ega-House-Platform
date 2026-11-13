-- MONEY-09 durable day close with retained correction history.
--
-- One close row stores the CLOSED note, the day totals, the chosen day-start
-- baseline, the reference/reserve snapshot and the close identity. The same
-- SECURITY DEFINER transaction advances the active date exactly once (or ends
-- the period on its final day) and creates the next day-start baseline. Final
-- purchases are recorded by the application through the canonical movement
-- path before this call; their ids are validated here so a close can never
-- proceed over an unrecorded purchase.
CREATE TABLE IF NOT EXISTS public.money_day_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_id uuid NOT NULL,
  close_date date NOT NULL,
  status text NOT NULL DEFAULT 'closed' CHECK (status = 'closed'),
  note text,
  operation_id uuid NOT NULL,
  close_fingerprint text NOT NULL CHECK (close_fingerprint ~ '^[0-9a-f]{64}$'),
  expected_period_version integer NOT NULL CHECK (expected_period_version > 0),
  period_version_after integer NOT NULL CHECK (period_version_after = expected_period_version + 1),
  active_date_after date NOT NULL,
  lifecycle_after text NOT NULL CHECK (lifecycle_after IN ('tracking', 'ended')),
  is_final_day boolean NOT NULL,
  algorithm_version text NOT NULL CHECK (btrim(algorithm_version) <> ''),
  policy_version_id uuid,
  policy_version integer,
  baseline_version integer NOT NULL CHECK (baseline_version > 0),
  included_movement_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id, period_id)
    REFERENCES public.money_periods(owner_user_id, id) ON DELETE RESTRICT,
  CHECK ((is_final_day AND lifecycle_after = 'ended')
    OR (NOT is_final_day AND lifecycle_after = 'tracking')),
  CHECK (lifecycle_after <> 'ended' OR close_date = active_date_after),
  CHECK (lifecycle_after <> 'tracking' OR active_date_after = close_date + 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS money_day_closes_owner_operation_unique
  ON public.money_day_closes(owner_user_id, operation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS money_day_closes_owner_period_date_unique
  ON public.money_day_closes(owner_user_id, period_id, close_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS money_day_closes_owner_period_history_idx
  ON public.money_day_closes(owner_user_id, period_id, close_date DESC, created_at DESC);
--> statement-breakpoint
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
  v_unfunded integer;
  v_emergency_remaining integer;
  v_safe integer;
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

  v_unfunded := GREATEST(
    0, v_baseline.savings_target_minor - v_baseline.savings_funded_minor
  );
  v_emergency_remaining := GREATEST(
    0, v_baseline.emergency_target_minor - v_baseline.emergency_used_minor
  );
  v_safe := v_baseline.cash_minor - v_baseline.commitments_minor
    - v_unfunded - v_emergency_remaining;
  v_days := v_period.end_date - p_date + 1;
  IF v_days > 0 THEN
    v_reference := floor(GREATEST(0, v_safe)::numeric / v_days)::integer;
    v_daily_remaining := v_reference - v_daily;
  END IF;

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
      'safePoolMinor', v_safe,
      'referenceMinor', v_reference,
      'dailyRemainingMinor', v_daily_remaining
    ) ELSE jsonb_build_object('available', false, 'reason', 'no_days_left') END,
    'reserves', jsonb_build_object(
      'recordedCashMinor', v_cash,
      'unpaidCommitmentsMinor', v_baseline.commitments_minor,
      'savingsTargetMinor', v_baseline.savings_target_minor,
      'fundedSavingsMinor', v_baseline.savings_funded_minor,
      'unfundedSavingsMinor', v_unfunded,
      'emergencyTargetMinor', v_baseline.emergency_target_minor,
      'emergencyUsedMinor', v_baseline.emergency_used_minor,
      'remainingEmergencyMinor', v_emergency_remaining,
      'safeFlexibleMinor', v_safe
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
    -- The next day has its own immutable day-start inputs; closing today never
    -- copies an allowance or mutates budgets/savings policy.
    PERFORM public.money_ensure_day_start_baseline(p_period_id, v_period.active_date);
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
ALTER TABLE public.money_day_closes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_day_closes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY money_day_closes_owner_select ON public.money_day_closes
  FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND
    (((SELECT auth.jwt()) ->> 'client_id') IS NULL OR public.mcp_finance_grant_allows('personal_ops.read')));
--> statement-breakpoint
REVOKE ALL ON public.money_day_closes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.money_day_closes TO authenticated;
