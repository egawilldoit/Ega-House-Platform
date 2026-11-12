-- MONEY-08 durable policy revisions and day-start calculation inputs.
-- Historical unknowns stay NULL and are marked unavailable; this migration
-- deliberately does not synthesize snapshots for existing periods.
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
