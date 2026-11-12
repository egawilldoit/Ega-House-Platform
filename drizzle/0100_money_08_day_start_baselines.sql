-- MONEY-08 durable policy revisions and day-start calculation inputs.
-- Historical unknowns stay NULL and are marked unavailable; this migration
-- deliberately does not synthesize snapshots for existing periods.
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS money_periods_owner_id_unique
  ON public.money_periods(owner_user_id, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.money_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES public.money_periods(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  effective_date date NOT NULL,
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, period_id, version),
  UNIQUE (owner_user_id, period_id, id),
  FOREIGN KEY (owner_user_id, period_id)
    REFERENCES public.money_periods(owner_user_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS money_policy_versions_effective_idx
  ON public.money_policy_versions(owner_user_id, period_id, effective_date, version);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.money_day_start_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_id uuid NOT NULL,
  date date NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  policy_version_id uuid,
  algorithm_version text NOT NULL,
  availability text NOT NULL CHECK (availability IN ('available', 'unavailable')),
  unavailable_reason text,
  cash_minor integer,
  commitments_minor integer,
  savings_target_minor integer,
  savings_funded_minor integer,
  emergency_target_minor integer,
  emergency_used_minor integer,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(inputs) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id, period_id)
    REFERENCES public.money_periods(owner_user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (owner_user_id, period_id, policy_version_id)
    REFERENCES public.money_policy_versions(owner_user_id, period_id, id) ON DELETE RESTRICT,
  UNIQUE (owner_user_id, period_id, date, version),
  CHECK ((availability = 'available' AND unavailable_reason IS NULL
      AND cash_minor IS NOT NULL AND commitments_minor IS NOT NULL
      AND savings_target_minor IS NOT NULL AND savings_funded_minor IS NOT NULL
      AND emergency_target_minor IS NOT NULL AND emergency_used_minor IS NOT NULL)
    OR (availability = 'unavailable' AND unavailable_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS money_day_start_baselines_date_idx
  ON public.money_day_start_baselines(owner_user_id, period_id, date DESC, version DESC);
--> statement-breakpoint
-- Materialize from retained ledger and obligation lifecycle history. The period
-- period row lock serializes concurrent callers; all inputs are read in this transaction.
CREATE OR REPLACE FUNCTION public.money_ensure_day_start_baseline(
  p_period_id uuid, p_date date
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
  IF FOUND THEN RETURN v_row; END IF;
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
  SELECT COALESCE(v_opening, 0) + COALESCE(sum(CASE
      WHEN kind = 'income' OR (kind = 'reconciliation_adjustment' AND direction = 'in') THEN amount_minor
      WHEN kind = 'expense' OR kind = 'savings_transfer' OR (kind = 'reconciliation_adjustment' AND direction = 'out') THEN -amount_minor
      ELSE 0 END), 0)::integer
    INTO v_cash FROM public.personal_expenses
   WHERE owner_user_id = auth.uid()
     AND period_id = p_period_id AND booking_date < p_date AND deleted_at IS NULL AND kind <> 'opening';
  SELECT COALESCE(sum(amount_minor), 0)::integer INTO v_savings
    FROM public.personal_expenses WHERE owner_user_id = auth.uid()
      AND period_id = p_period_id AND booking_date < p_date AND deleted_at IS NULL AND kind = 'savings_transfer';
  SELECT COALESCE(sum(amount_minor), 0)::integer INTO v_emergency
    FROM public.personal_expenses WHERE owner_user_id = auth.uid()
      AND period_id = p_period_id AND booking_date < p_date AND deleted_at IS NULL AND kind = 'expense' AND purpose = 'emergency';
  -- Current state alone cannot reconstruct prior days. Require history for any
  -- obligation whose state has changed; events effective on p_date are excluded.
  SELECT COALESCE(sum(o.amount_minor) FILTER (WHERE h.state = 'pending'), 0)::integer
    INTO v_commitments
    FROM public.money_obligations o
    CROSS JOIN LATERAL (SELECT COALESCE((SELECT e->>'state' FROM jsonb_array_elements(o.state_history) e
       WHERE (e->>'effectiveDate')::date < p_date ORDER BY (e->>'effectiveDate')::date DESC,
         (e->>'version')::integer DESC LIMIT 1),
       CASE WHEN o.created_at::date < p_date THEN 'pending' END) AS state) h
   WHERE o.owner_user_id = auth.uid()
     AND o.period_start >= v_period.start_date AND o.period_end <= v_period.end_date
     AND o.period_start < p_date AND o.period_end >= p_date;
  SELECT COALESCE(bool_or(state_history = '[]'::jsonb AND state_effective_date < p_date AND state <> 'pending'), false)
    INTO v_unknown_obligations FROM public.money_obligations
   WHERE owner_user_id = auth.uid()
     AND period_start >= v_period.start_date AND period_end <= v_period.end_date
     AND period_start < p_date AND period_end >= p_date;
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
REVOKE ALL ON FUNCTION public.money_ensure_day_start_baseline(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_ensure_day_start_baseline(uuid, date) TO authenticated;
--> statement-breakpoint
-- Extend the existing atomic period-creation boundary. The first-day snapshot
-- is deliberately unavailable: settings/opening alone cannot establish the
-- initial obligation lifecycle or funded/used reserve history.
ALTER FUNCTION public.money_create_period(
  date, date, text, date, text, integer, date, text, jsonb, jsonb, timestamp with time zone
) RENAME TO money_create_period_v3;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.money_create_period(
  p_start_date date,
  p_end_date date,
  p_timezone text,
  p_active_date date,
  p_initialization text,
  p_opening_amount_minor integer,
  p_opening_booking_date date,
  p_opening_create_fingerprint text,
  p_provenance jsonb,
  p_settings jsonb,
  p_created_at timestamp with time zone
)
RETURNS public.money_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_period$
DECLARE
  v_period public.money_periods;
  v_policy_id uuid;
  v_commitments integer;
  v_savings_target integer;
  v_emergency_target integer;
  v_availability text := 'unavailable';
  v_unavailable_reason text := 'initial_setup_inputs_unknown';
BEGIN
  v_period := public.money_create_period_v3(
    p_start_date, p_end_date, p_timezone, p_active_date, p_initialization,
    p_opening_amount_minor, p_opening_booking_date, p_opening_create_fingerprint,
    p_provenance, p_settings, p_created_at
  );
  INSERT INTO public.money_policy_versions
    (owner_user_id, period_id, version, effective_date, policy, created_at)
  VALUES (auth.uid(), v_period.id, 1, p_active_date,
    jsonb_build_object('settings', p_settings, 'algorithmVersion', 'safe-flexible-start-of-day-v1'), p_created_at)
  RETURNING id INTO v_policy_id;
  v_savings_target := CASE WHEN p_settings ? 'savingsTargetMinor'
    THEN (p_settings ->> 'savingsTargetMinor')::integer END;
  v_emergency_target := CASE WHEN p_settings ? 'emergencyTargetMinor'
    THEN (p_settings ->> 'emergencyTargetMinor')::integer END;
  SELECT COALESCE(sum(amount_minor), 0)::integer INTO v_commitments
  FROM public.money_obligations
  WHERE owner_user_id = auth.uid()
    AND period_start <= p_active_date AND period_end >= p_active_date
    AND state = 'pending' AND state_effective_date <= p_active_date;
  IF p_opening_amount_minor IS NOT NULL
    AND v_savings_target IS NOT NULL AND v_emergency_target IS NOT NULL THEN
    v_availability := 'available';
    v_unavailable_reason := NULL;
  END IF;
  INSERT INTO public.money_day_start_baselines
    (owner_user_id, period_id, date, version, policy_version_id, algorithm_version,
     availability, unavailable_reason, cash_minor, commitments_minor,
     savings_target_minor, savings_funded_minor, emergency_target_minor,
     emergency_used_minor, inputs, created_at)
  VALUES (auth.uid(), v_period.id, p_active_date, 1, v_policy_id,
    'safe-flexible-start-of-day-v1', v_availability, v_unavailable_reason,
    CASE WHEN v_availability = 'available' THEN p_opening_amount_minor END,
    CASE WHEN v_availability = 'available' THEN v_commitments END,
    CASE WHEN v_availability = 'available' THEN v_savings_target END,
    CASE WHEN v_availability = 'available' THEN 0 END,
    CASE WHEN v_availability = 'available' THEN v_emergency_target END,
    CASE WHEN v_availability = 'available' THEN 0 END,
    jsonb_build_object('setupDate', p_active_date, 'openingAmountMinor', p_opening_amount_minor,
      'commitmentsAsOf', p_active_date, 'savingsFundedBeforeMinor', 0, 'emergencyUsedBeforeMinor', 0),
    p_created_at);
  RETURN v_period;
END
$create_period$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.money_create_period(
  date, date, text, date, text, integer, date, text, jsonb, jsonb, timestamp with time zone
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_create_period(
  date, date, text, date, text, integer, date, text, jsonb, jsonb, timestamp with time zone
) TO authenticated;
--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE public.money_policy_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_policy_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY money_policy_versions_owner_select ON public.money_policy_versions
  FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND
    (((SELECT auth.jwt()) ->> 'client_id') IS NULL OR public.mcp_finance_grant_allows('personal_ops.read')));
--> statement-breakpoint
CREATE POLICY money_policy_versions_owner_insert ON public.money_policy_versions
  FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND
    (((SELECT auth.jwt()) ->> 'client_id') IS NULL OR public.mcp_finance_grant_allows('personal_ops.write')));
--> statement-breakpoint
ALTER TABLE public.money_day_start_baselines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_day_start_baselines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY money_day_start_baselines_owner_select ON public.money_day_start_baselines
  FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND
    (((SELECT auth.jwt()) ->> 'client_id') IS NULL OR public.mcp_finance_grant_allows('personal_ops.read')));
--> statement-breakpoint
CREATE POLICY money_day_start_baselines_owner_insert ON public.money_day_start_baselines
  FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND
    (((SELECT auth.jwt()) ->> 'client_id') IS NULL OR public.mcp_finance_grant_allows('personal_ops.write')));
--> statement-breakpoint
REVOKE ALL ON public.money_policy_versions, public.money_day_start_baselines FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.money_policy_versions, public.money_day_start_baselines TO authenticated;
