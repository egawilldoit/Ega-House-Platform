-- MONEY-09 close review fixes: one canonical ledger predicate and one
-- outstanding-commitment rule for stored close evidence, the live restated
-- comparison and the day-start baseline.
--
-- 1. Recorded cash and day totals use the canonical owner + booking-date
--    predicate that already backs the Money cash/daily reads. A legacy row with
--    `period_id IS NULL` is therefore included consistently; it can no longer
--    make a freshly stored close look changed on the first read.
-- 2. Outstanding commitments are the pending occurrences due inside the period
--    at the lifecycle cutoff, including future-due commitments. Close evidence,
--    current reserves and the day-start baseline share this rule.
-- 3. Included final-purchase identities must be canonical expense outflows.
-- 4. Close/daily/reserve reads are single SQL aggregates, so a PostgREST row
--    cap can never silently truncate the evidence comparison.
--
-- The functions here are SECURITY DEFINER and always derive the owner from
-- `auth.uid()`; callers never supply an owner. Internal helpers are not granted
-- to clients, only the three read primitives used by the data-access adapter.

-- Canonical recorded-cash components for an inclusive owner booking-date window.
CREATE OR REPLACE FUNCTION public.money_ledger_direction_totals(
  p_start_date date,
  p_end_date date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $ledger$
BEGIN
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.read') THEN
    RAISE EXCEPTION 'Money read grant required' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object(
    'inflowsMinor', COALESCE(sum(CASE WHEN direction = 'in' THEN amount_minor ELSE 0 END), 0)::integer,
    'outflowsMinor', COALESCE(sum(CASE WHEN direction = 'out' THEN amount_minor ELSE 0 END), 0)::integer,
    'recordCount', count(*)::integer
  )
  FROM public.personal_expenses
  WHERE owner_user_id = auth.uid()
    AND deleted_at IS NULL
    AND kind <> 'opening'
    AND booking_date >= p_start_date
    AND booking_date <= p_end_date);
END
$ledger$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_ledger_direction_totals(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_ledger_direction_totals(date, date) TO authenticated;
--> statement-breakpoint

-- Canonical day totals: expense outflows on the owner booking date. The period
-- id is used only to prove the requested period is the caller's; the ledger
-- predicate deliberately has no `period_id` filter so legacy unassigned rows
-- project like every other canonical Money read.
CREATE OR REPLACE FUNCTION public.money_day_expense_totals(
  p_period_id uuid,
  p_date date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $day_totals$
DECLARE
  v_count integer := 0;
  v_expense integer := 0;
  v_daily integer := 0;
  v_flexible integer := 0;
  v_fixed integer := 0;
  v_emergency integer := 0;
  v_categories jsonb := '{}'::jsonb;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.read') THEN
    RAISE EXCEPTION 'Money read grant required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.money_periods
    WHERE id = p_period_id AND owner_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Money period is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT
    count(*)::integer,
    COALESCE(sum(amount_minor), 0)::integer,
    COALESCE(sum(amount_minor) FILTER (WHERE counts_in_daily), 0)::integer,
    COALESCE(sum(amount_minor) FILTER (WHERE purpose = 'flexible'), 0)::integer,
    COALESCE(sum(amount_minor) FILTER (WHERE purpose = 'fixed'), 0)::integer,
    COALESCE(sum(amount_minor) FILTER (WHERE purpose = 'emergency'), 0)::integer
    INTO v_count, v_expense, v_daily, v_flexible, v_fixed, v_emergency
    FROM public.personal_expenses
    WHERE owner_user_id = auth.uid()
      AND booking_date = p_date
      AND kind = 'expense'
      AND direction = 'out'
      AND deleted_at IS NULL;

  SELECT COALESCE(jsonb_object_agg(category, total), '{}'::jsonb)
    INTO v_categories
    FROM (
      SELECT category, sum(amount_minor)::integer AS total
      FROM public.personal_expenses
      WHERE owner_user_id = auth.uid()
        AND booking_date = p_date
        AND kind = 'expense'
        AND direction = 'out'
        AND deleted_at IS NULL
        AND category IS NOT NULL
      GROUP BY category
    ) category_rows;

  RETURN jsonb_build_object(
    'complete', true,
    'rowCount', v_count,
    'expenseTotalMinor', v_expense,
    'dailyIncludedSpendMinor', v_daily,
    'flexibleExpenseTotalMinor', v_flexible,
    'fixedExpenseTotalMinor', v_fixed,
    'emergencyExpenseTotalMinor', v_emergency,
    'categoryTotals', v_categories
  );
END
$day_totals$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_day_expense_totals(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_day_expense_totals(uuid, date) TO authenticated;
--> statement-breakpoint

-- Canonical funded-savings and emergency-usage components. These mirror the
-- application movement totals exactly (savings transfers out, emergency expense
-- out minus a matching reversal).
CREATE OR REPLACE FUNCTION public.money_reserve_funding_totals(
  p_start_date date,
  p_end_date date
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $funding$
  SELECT jsonb_build_object(
    'fundedSavingsMinor', COALESCE(sum(amount_minor) FILTER (
      WHERE kind = 'savings_transfer' AND direction = 'out'
    ), 0)::integer,
    'emergencyUsedMinor', COALESCE(sum(CASE
      WHEN kind = 'expense' AND purpose = 'emergency'
        THEN CASE WHEN direction = 'out' THEN amount_minor ELSE -amount_minor END
      ELSE 0 END), 0)::integer
  )
  FROM public.personal_expenses
  WHERE owner_user_id = auth.uid()
    AND deleted_at IS NULL
    AND booking_date >= p_start_date
    AND booking_date <= p_end_date
$funding$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_reserve_funding_totals(date, date) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- One outstanding-commitment rule: every occurrence due inside the period whose
-- reconstructed lifecycle state at the cutoff is still pending. Future-due
-- commitments (later in the period) stay protected; paid/waived/cancelled
-- occurrences release their reserve. `p_include_cutoff = false` is the
-- day-start cutoff used before the selected date.
CREATE OR REPLACE FUNCTION public.money_outstanding_commitments_minor(
  p_period_id uuid,
  p_cutoff date,
  p_include_cutoff boolean
) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $commitments$
DECLARE
  v_period public.money_periods;
  v_total integer;
BEGIN
  SELECT * INTO v_period FROM public.money_periods
    WHERE id = p_period_id AND owner_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Money period is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_cutoff IS NULL
     OR p_cutoff < v_period.start_date
     OR p_cutoff > v_period.end_date THEN
    RAISE EXCEPTION 'Money commitment cutoff is outside its period'
      USING ERRCODE = '22007';
  END IF;

  SELECT COALESCE(sum(o.amount_minor) FILTER (WHERE h.state = 'pending'), 0)::integer
    INTO v_total
    FROM public.money_obligations o
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN jsonb_array_length(o.state_history) > 0 THEN
          COALESCE((
            SELECT e->>'state'
            FROM jsonb_array_elements(o.state_history) e
            WHERE CASE WHEN p_include_cutoff
              THEN (e->>'effectiveDate')::date <= p_cutoff
              ELSE (e->>'effectiveDate')::date < p_cutoff END
            ORDER BY (e->>'effectiveDate')::date DESC,
              (e->>'version')::integer DESC
            LIMIT 1
          ), 'pending')
        WHEN o.created_at::date > p_cutoff THEN NULL
        WHEN NOT p_include_cutoff
          AND o.created_at::date = p_cutoff
          AND NOT (p_cutoff = v_period.start_date AND o.state = 'pending') THEN NULL
        WHEN p_include_cutoff
          AND (o.state = 'pending' OR o.state_effective_date <= p_cutoff)
          THEN o.state
        WHEN NOT p_include_cutoff
          AND (o.state = 'pending' OR o.state_effective_date < p_cutoff)
          THEN o.state
        ELSE 'pending'
      END AS state
    ) h
    WHERE o.owner_user_id = auth.uid()
      AND o.due_date >= v_period.start_date
      AND o.due_date <= v_period.end_date;

  RETURN COALESCE(v_total, 0);
END
$commitments$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_outstanding_commitments_minor(uuid, date, boolean) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- The one reserve input read used by both durable close evidence and the live
-- current-reserve projection. Returning the four canonical inputs together is
-- what makes close and live parity structural rather than a duplicated query.
CREATE OR REPLACE FUNCTION public.money_reserve_inputs(
  p_period_id uuid,
  p_cutoff date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $reserve_inputs$
DECLARE
  v_period public.money_periods;
  v_opening integer;
  v_ledger jsonb;
  v_funding jsonb;
BEGIN
  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
     AND NOT public.mcp_finance_grant_allows('personal_ops.read') THEN
    RAISE EXCEPTION 'Money read grant required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_period FROM public.money_periods
    WHERE id = p_period_id AND owner_user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Money period is unavailable' USING ERRCODE = '42501';
  END IF;
  IF p_cutoff IS NULL
     OR p_cutoff < v_period.start_date
     OR p_cutoff > v_period.end_date THEN
    RAISE EXCEPTION 'Money reserve cutoff is outside its period'
      USING ERRCODE = '22007';
  END IF;

  IF v_period.opening_movement_id IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'opening_unknown');
  END IF;
  SELECT amount_minor INTO v_opening FROM public.personal_expenses
    WHERE owner_user_id = auth.uid()
      AND period_id = p_period_id
      AND id = v_period.opening_movement_id
      AND kind = 'opening'
      AND deleted_at IS NULL;
  IF v_opening IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'opening_unknown');
  END IF;

  v_ledger := public.money_ledger_direction_totals(v_period.start_date, p_cutoff);
  v_funding := public.money_reserve_funding_totals(v_period.start_date, p_cutoff);

  RETURN jsonb_build_object(
    'available', true,
    'recordedCashMinor', v_opening
      + (v_ledger->>'inflowsMinor')::integer
      - (v_ledger->>'outflowsMinor')::integer,
    'unpaidCommitmentsMinor',
      public.money_outstanding_commitments_minor(p_period_id, p_cutoff, true),
    'fundedSavingsMinor', (v_funding->>'fundedSavingsMinor')::integer,
    'emergencyUsedMinor', (v_funding->>'emergencyUsedMinor')::integer
  );
END
$reserve_inputs$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_reserve_inputs(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_reserve_inputs(uuid, date) TO authenticated;
--> statement-breakpoint

-- Day-start baseline now uses the same canonical cash/funding/commitment rule.
-- Cash and funding are strictly before the selected date; commitments use the
-- exclusive day-start lifecycle cutoff.
CREATE OR REPLACE FUNCTION public.money_calculate_day_start_baseline(
  p_period_id uuid, p_date date, p_rebase boolean
) RETURNS public.money_day_start_baselines
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $baseline$
DECLARE
  v_period public.money_periods;
  v_policy public.money_policy_versions;
  v_row public.money_day_start_baselines;
  v_version integer;
  v_opening integer;
  v_cash integer;
  v_commitments integer;
  v_savings integer;
  v_emergency integer;
  v_savings_target integer;
  v_emergency_target integer;
  v_ledger jsonb;
  v_funding jsonb;
  v_unknown boolean := false;
  v_unknown_opening boolean := false;
  v_unknown_obligations boolean := false;
BEGIN
  SELECT * INTO v_period FROM public.money_periods
    WHERE id = p_period_id AND owner_user_id = auth.uid()
      AND start_date <= p_date AND end_date >= p_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Money period or date is unavailable'; END IF;
  SELECT * INTO v_row FROM public.money_day_start_baselines
    WHERE owner_user_id = auth.uid() AND period_id = p_period_id AND date = p_date
    ORDER BY version DESC LIMIT 1;
  IF FOUND AND NOT p_rebase THEN RETURN v_row; END IF;
  -- Initial setup must be explicitly completed by the owner. Until then the
  -- obligation set is unknown, even when it currently contains no rows.
  IF NOT v_period.day_start_setup_completed THEN
    SELECT COALESCE(max(version), 0) + 1 INTO v_version
      FROM public.money_day_start_baselines
      WHERE owner_user_id = auth.uid() AND period_id = p_period_id AND date = p_date;
    INSERT INTO public.money_day_start_baselines
      (owner_user_id, period_id, date, version, policy_version_id, algorithm_version,
       availability, unavailable_reason, inputs)
    VALUES (auth.uid(), p_period_id, p_date, v_version, NULL,
      'safe-flexible-start-of-day-v1', 'unavailable', 'initial_setup_incomplete',
      jsonb_build_object('setupComplete', false));
    RETURN (SELECT b FROM public.money_day_start_baselines b WHERE b.owner_user_id = auth.uid()
      AND b.period_id = p_period_id AND b.date = p_date AND b.version = v_version);
  END IF;
  -- Serialize the version allocation for this period/date via the period lock.
  SELECT * INTO v_policy FROM public.money_policy_versions
    WHERE owner_user_id = auth.uid()
      AND period_id = p_period_id AND effective_date <= p_date
    ORDER BY effective_date DESC, version DESC LIMIT 1;
  SELECT COALESCE(max(version), 0) + 1 INTO v_version
    FROM public.money_day_start_baselines
    WHERE owner_user_id = auth.uid() AND period_id = p_period_id AND date = p_date;
  v_savings_target := CASE WHEN v_policy.policy #> '{settings}' ? 'savingsTargetMinor'
    THEN (v_policy.policy #>> '{settings,savingsTargetMinor}')::integer END;
  v_emergency_target := CASE WHEN v_policy.policy #> '{settings}' ? 'emergencyTargetMinor'
    THEN (v_policy.policy #>> '{settings,emergencyTargetMinor}')::integer END;
  SELECT amount_minor INTO v_opening FROM public.personal_expenses
   WHERE owner_user_id = auth.uid()
     AND period_id = p_period_id AND id = v_period.opening_movement_id
     AND kind = 'opening' AND deleted_at IS NULL;
  IF v_opening IS NULL THEN v_unknown_opening := true; END IF;

  -- Canonical owner + booking-date window, never a `period_id` filter.
  v_ledger := public.money_ledger_direction_totals(
    v_period.start_date, p_date - 1
  );
  v_cash := COALESCE(v_opening, 0)
    + (v_ledger->>'inflowsMinor')::integer
    - (v_ledger->>'outflowsMinor')::integer;
  v_funding := public.money_reserve_funding_totals(
    v_period.start_date, p_date - 1
  );
  v_savings := (v_funding->>'fundedSavingsMinor')::integer;
  v_emergency := (v_funding->>'emergencyUsedMinor')::integer;

  v_commitments := public.money_outstanding_commitments_minor(
    p_period_id, p_date, false
  );

  -- Current state alone cannot reconstruct prior days. Require history for any
  -- obligation whose state has changed; events effective on p_date are excluded.
  SELECT COALESCE(bool_or(state_history = '[]'::jsonb AND state_effective_date < p_date AND state <> 'pending'), false)
    INTO v_unknown_obligations FROM public.money_obligations
   WHERE owner_user_id = auth.uid()
     AND due_date >= v_period.start_date AND due_date <= v_period.end_date;
  v_unknown := v_unknown_opening OR v_unknown_obligations;
  IF v_savings_target IS NULL OR v_emergency_target IS NULL OR v_unknown THEN
    INSERT INTO public.money_day_start_baselines
      (owner_user_id, period_id, date, version, policy_version_id, algorithm_version,
       availability, unavailable_reason, inputs)
    VALUES (auth.uid(), p_period_id, p_date, v_version, v_policy.id,
      COALESCE(v_policy.policy->>'algorithmVersion', 'safe-flexible-start-of-day-v1'),
      'unavailable', CASE
        WHEN v_unknown_obligations THEN 'obligation_history_incomplete'
        WHEN v_unknown_opening THEN 'opening_balance_unknown'
        ELSE 'effective_policy_incomplete'
      END,
      jsonb_build_object('policyEffectiveDate', v_policy.effective_date, 'lifecycleCutoff', p_date));
  ELSE
    INSERT INTO public.money_day_start_baselines
      (owner_user_id, period_id, date, version, policy_version_id, algorithm_version,
       availability, cash_minor, commitments_minor, savings_target_minor, savings_funded_minor,
       emergency_target_minor, emergency_used_minor, inputs)
    VALUES (auth.uid(), p_period_id, p_date, v_version, v_policy.id,
      COALESCE(v_policy.policy->>'algorithmVersion', 'safe-flexible-start-of-day-v1'), 'available',
      v_cash, v_commitments, v_savings_target, v_savings, v_emergency_target, v_emergency,
      jsonb_build_object('policyEffectiveDate', v_policy.effective_date, 'lifecycleCutoff', p_date,
        'openingAmountMinor', v_opening));
  END IF;
  SELECT * INTO v_row FROM public.money_day_start_baselines
   WHERE owner_user_id = auth.uid() AND period_id = p_period_id AND date = p_date AND version = v_version;
  RETURN v_row;
END
$baseline$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_calculate_day_start_baseline(uuid, date, boolean) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint

-- Durable close. Compared with 0105 this:
--   * reads every reserve input from money_reserve_inputs (the same read the
--     live projection uses);
--   * reads day totals from money_day_expense_totals (owner + booking date);
--   * requires included final purchases to be canonical expense outflows.
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
  v_reserve_inputs jsonb;
  v_day_totals jsonb;
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

  -- Every included final purchase must already exist on this exact day/period
  -- and be a canonical expense outflow. An opening, income or savings row is
  -- never a final purchase.
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
        AND e.kind = 'expense'
        AND e.direction = 'out'
        AND e.id = ANY(p_included_movement_ids)
    ) <> cardinality(p_included_movement_ids) THEN
      RETURN jsonb_build_object(
        'status', 'included_movement_invalid',
        'detail', 'missing, mismatched or non-expense final purchase'
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

  -- Day totals and the end-of-day reserve inputs come from the same canonical
  -- reads as the live Money surface. No `period_id` ledger filter is applied.
  v_day_totals := public.money_day_expense_totals(p_period_id, p_date);
  v_expense := (v_day_totals->>'expenseTotalMinor')::integer;
  v_daily := (v_day_totals->>'dailyIncludedSpendMinor')::integer;
  v_flexible := (v_day_totals->>'flexibleExpenseTotalMinor')::integer;
  v_fixed := (v_day_totals->>'fixedExpenseTotalMinor')::integer;
  v_emergency := (v_day_totals->>'emergencyExpenseTotalMinor')::integer;
  v_categories := COALESCE(v_day_totals->'categoryTotals', '{}'::jsonb);

  v_reserve_inputs := public.money_reserve_inputs(p_period_id, p_date);
  IF (v_reserve_inputs->>'available')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'opening_unknown');
  END IF;
  v_cash := (v_reserve_inputs->>'recordedCashMinor')::integer;
  v_commitments := (v_reserve_inputs->>'unpaidCommitmentsMinor')::integer;
  v_funded := (v_reserve_inputs->>'fundedSavingsMinor')::integer;
  v_emergency_used := (v_reserve_inputs->>'emergencyUsedMinor')::integer;

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
