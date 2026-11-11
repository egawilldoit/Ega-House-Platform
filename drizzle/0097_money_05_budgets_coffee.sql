-- MONEY-05: period budget allocations, additive category taxonomy and counted
-- coffee visits.
--
-- Baseline: 0096 (MONEY-04) is the journal tail for Money: the one
-- `personal_expenses` ledger already carries kind/direction/booking date,
-- `counts_in_daily`, `purpose`, `period_id` and the MONEY-03 `money_periods`
-- table. This migration only adds on top of that state and never replaces a
-- stronger MONEY-03/04 rule with a weaker one.
--
-- Additive only:
--   * The existing nine expense categories stay valid and unmodified; five
--     reporting categories are appended to the check constraint.
--   * Advisory category caps accept the appended categories with the same
--     whole-centime rule; no stored cap value is rewritten.
--   * Budget plans reference exactly one canonical `money_periods` row and own
--     the editable period allocation/targets/coffee limits. Routine spending
--     never writes them, and period dates are read from that row.
--   * Counted visits are unique/replayable by `(owner_user_id, visit_key)`;
--     one expense can belong to at most one visit, and a visit counts once even
--     with several purchase lines. Visits never duplicate a cash amount.
--
-- Security: owner_user_id defaults to auth.uid(); RLS and every repository
-- statement scope by the owner. A direct-user token and an explicit active
-- personal_ops grant are the only allowed paths, mirroring 0093.

-- 1. Additive category taxonomy ------------------------------------------------
ALTER TABLE public.personal_expenses
  DROP CONSTRAINT IF EXISTS personal_expenses_category_check;
--> statement-breakpoint
ALTER TABLE public.personal_expenses
  ADD CONSTRAINT personal_expenses_category_check
  CHECK (
    category IN (
      'coffee', 'groceries', 'eating_out', 'transport', 'bills',
      'subscriptions', 'household', 'health', 'other',
      'daily_usage', 'personal_care', 'work_tools', 'fun', 'emergency'
    )
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valid_category_caps(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  item text;
  cap jsonb;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  FOR item IN SELECT jsonb_object_keys(value) LOOP
    IF item NOT IN (
      'coffee', 'groceries', 'eating_out', 'transport', 'bills',
      'subscriptions', 'household', 'health', 'other',
      'daily_usage', 'personal_care', 'work_tools', 'fun', 'emergency'
    ) THEN
      RETURN false;
    END IF;
    cap := value->item;
    IF jsonb_typeof(cap) IS DISTINCT FROM 'number'
       OR (cap #>> '{}') !~ '^(0|[1-9][0-9]*)$'
       OR (cap #>> '{}')::numeric > 2147483647 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.valid_money_budget_allocations(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  item text;
  amount jsonb;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
  FOR item IN SELECT jsonb_object_keys(value) LOOP
    IF item NOT IN (
      'coffee', 'groceries', 'eating_out', 'transport', 'bills',
      'subscriptions', 'household', 'health', 'other',
      'daily_usage', 'personal_care', 'work_tools', 'fun', 'emergency'
    ) THEN
      RETURN false;
    END IF;
    amount := value->item;
    IF jsonb_typeof(amount) IS DISTINCT FROM 'number'
       OR (amount #>> '{}') !~ '^(0|[1-9][0-9]*)$'
       OR (amount #>> '{}')::numeric > 2147483647 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN others THEN RETURN FALSE;
END $$;

-- 2. Period budget plans -------------------------------------------------------
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.money_budget_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  owner_user_id uuid DEFAULT auth.uid() NOT NULL,
  -- One plan per canonical period. The period row owns the dates; this table
  -- never stores a second editable copy of them.
  period_id uuid NOT NULL REFERENCES public.money_periods(id) ON DELETE CASCADE,
  currency varchar(3) DEFAULT 'MAD' NOT NULL,
  allocations jsonb DEFAULT '{}'::jsonb NOT NULL,
  savings_target_minor integer,
  emergency_target_minor integer,
  coffee_weekly_spend_limit_minor integer,
  coffee_weekly_visit_limit integer,
  version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT money_budget_plans_currency_check CHECK (currency = 'MAD'),
  CONSTRAINT money_budget_plans_allocations_check
    CHECK (public.valid_money_budget_allocations(allocations)),
  CONSTRAINT money_budget_plans_savings_target_check
    CHECK (savings_target_minor IS NULL OR (savings_target_minor >= 0 AND savings_target_minor <= 2147483647)),
  CONSTRAINT money_budget_plans_emergency_target_check
    CHECK (emergency_target_minor IS NULL OR (emergency_target_minor >= 0 AND emergency_target_minor <= 2147483647)),
  CONSTRAINT money_budget_plans_coffee_spend_limit_check
    CHECK (coffee_weekly_spend_limit_minor IS NULL OR (coffee_weekly_spend_limit_minor >= 0 AND coffee_weekly_spend_limit_minor <= 2147483647)),
  CONSTRAINT money_budget_plans_coffee_visit_limit_check
    CHECK (coffee_weekly_visit_limit IS NULL OR (coffee_weekly_visit_limit >= 0 AND coffee_weekly_visit_limit <= 2147483647)),
  CONSTRAINT money_budget_plans_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS money_budget_plans_owner_period_unique
  ON public.money_budget_plans USING btree (owner_user_id, period_id);
--> statement-breakpoint
ALTER TABLE public.money_budget_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_budget_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_money_budget_plan_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.money_periods AS period
    WHERE period.id = NEW.period_id
      AND period.owner_user_id = NEW.owner_user_id
  ) THEN
    RAISE EXCEPTION 'A budget plan must reference a period owned by the same owner.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS money_budget_plans_owner_guard ON public.money_budget_plans;
--> statement-breakpoint
CREATE TRIGGER money_budget_plans_owner_guard
  BEFORE INSERT OR UPDATE ON public.money_budget_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_budget_plan_owner();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_money_budget_plan_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.period_id IS DISTINCT FROM OLD.period_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Immutable budget plan fields cannot be changed.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'Budget plan version must increase by exactly one.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS money_budget_plans_update_guard ON public.money_budget_plans;
--> statement-breakpoint
CREATE TRIGGER money_budget_plans_update_guard
  BEFORE UPDATE ON public.money_budget_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_budget_plan_update();
--> statement-breakpoint
DROP POLICY IF EXISTS money_budget_plans_select ON public.money_budget_plans;
--> statement-breakpoint
CREATE POLICY money_budget_plans_select ON public.money_budget_plans
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_budget_plans_insert ON public.money_budget_plans;
--> statement-breakpoint
CREATE POLICY money_budget_plans_insert ON public.money_budget_plans
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_budget_plans_update ON public.money_budget_plans;
--> statement-breakpoint
CREATE POLICY money_budget_plans_update ON public.money_budget_plans
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_budget_plans FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_budget_plans FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.money_budget_plans TO authenticated;
--> statement-breakpoint
GRANT INSERT ON TABLE public.money_budget_plans TO authenticated;
--> statement-breakpoint
GRANT UPDATE (
  allocations,
  savings_target_minor,
  emergency_target_minor,
  coffee_weekly_spend_limit_minor,
  coffee_weekly_visit_limit,
  version,
  updated_at
) ON TABLE public.money_budget_plans TO authenticated;

-- 3. Counted coffee visits and canonical expense links -------------------------
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.money_coffee_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  owner_user_id uuid DEFAULT auth.uid() NOT NULL,
  visit_key varchar(128) NOT NULL,
  visit_fingerprint varchar(64) NOT NULL,
  local_date date NOT NULL,
  timezone varchar(64) NOT NULL,
  note varchar(500),
  version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT money_coffee_visits_key_check CHECK (btrim(visit_key) <> ''),
  CONSTRAINT money_coffee_visits_fingerprint_check
    CHECK (visit_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT money_coffee_visits_note_check
    CHECK (note IS NULL OR btrim(note) <> ''),
  CONSTRAINT money_coffee_visits_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS money_coffee_visits_owner_key_unique
  ON public.money_coffee_visits USING btree (owner_user_id, visit_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS money_coffee_visits_owner_local_date_idx
  ON public.money_coffee_visits USING btree (owner_user_id, local_date DESC, id DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.money_coffee_visit_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  owner_user_id uuid DEFAULT auth.uid() NOT NULL,
  visit_id uuid NOT NULL REFERENCES public.money_coffee_visits(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES public.personal_expenses(id) ON DELETE RESTRICT,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS money_coffee_visit_lines_owner_expense_unique
  ON public.money_coffee_visit_lines USING btree (owner_user_id, expense_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS money_coffee_visit_lines_owner_visit_idx
  ON public.money_coffee_visit_lines USING btree (owner_user_id, visit_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_money_coffee_visit_line_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.personal_expenses AS expense
    WHERE expense.id = NEW.expense_id
      AND expense.owner_user_id = NEW.owner_user_id
      AND expense.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Coffee visit lines must reference a live expense owned by the same owner.'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.money_coffee_visits AS visit
    WHERE visit.id = NEW.visit_id
      AND visit.owner_user_id = NEW.owner_user_id
  ) THEN
    RAISE EXCEPTION 'Coffee visit lines must reference a visit owned by the same owner.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS money_coffee_visit_lines_owner_guard ON public.money_coffee_visit_lines;
--> statement-breakpoint
CREATE TRIGGER money_coffee_visit_lines_owner_guard
  BEFORE INSERT ON public.money_coffee_visit_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_coffee_visit_line_owner();
--> statement-breakpoint
ALTER TABLE public.money_coffee_visits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_coffee_visits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_coffee_visit_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.money_coffee_visit_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_money_coffee_visit_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $guard$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR NEW.visit_key IS DISTINCT FROM OLD.visit_key
     OR NEW.visit_fingerprint IS DISTINCT FROM OLD.visit_fingerprint
     OR NEW.local_date IS DISTINCT FROM OLD.local_date
     OR NEW.timezone IS DISTINCT FROM OLD.timezone
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Immutable coffee visit fields cannot be changed.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'Coffee visit version must increase by exactly one.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$guard$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS money_coffee_visits_update_guard ON public.money_coffee_visits;
--> statement-breakpoint
CREATE TRIGGER money_coffee_visits_update_guard
  BEFORE UPDATE ON public.money_coffee_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_money_coffee_visit_update();
--> statement-breakpoint
DROP POLICY IF EXISTS money_coffee_visits_select ON public.money_coffee_visits;
--> statement-breakpoint
CREATE POLICY money_coffee_visits_select ON public.money_coffee_visits
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_coffee_visits_insert ON public.money_coffee_visits;
--> statement-breakpoint
CREATE POLICY money_coffee_visits_insert ON public.money_coffee_visits
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_coffee_visits_update ON public.money_coffee_visits;
--> statement-breakpoint
CREATE POLICY money_coffee_visits_update ON public.money_coffee_visits
  FOR UPDATE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_coffee_visits_delete ON public.money_coffee_visits;
--> statement-breakpoint
CREATE POLICY money_coffee_visits_delete ON public.money_coffee_visits
  FOR DELETE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_coffee_visit_lines_select ON public.money_coffee_visit_lines;
--> statement-breakpoint
CREATE POLICY money_coffee_visit_lines_select ON public.money_coffee_visit_lines
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_coffee_visit_lines_insert ON public.money_coffee_visit_lines;
--> statement-breakpoint
CREATE POLICY money_coffee_visit_lines_insert ON public.money_coffee_visit_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS money_coffee_visit_lines_delete ON public.money_coffee_visit_lines;
--> statement-breakpoint
CREATE POLICY money_coffee_visit_lines_delete ON public.money_coffee_visit_lines
  FOR DELETE TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_coffee_visits FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_coffee_visits FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.money_coffee_visits TO authenticated;
--> statement-breakpoint
GRANT INSERT ON TABLE public.money_coffee_visits TO authenticated;
--> statement-breakpoint
GRANT UPDATE (note, version, updated_at) ON TABLE public.money_coffee_visits TO authenticated;
--> statement-breakpoint
GRANT DELETE ON TABLE public.money_coffee_visits TO authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_coffee_visit_lines FROM anon;
--> statement-breakpoint
REVOKE ALL ON TABLE public.money_coffee_visit_lines FROM authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.money_coffee_visit_lines TO authenticated;
--> statement-breakpoint
GRANT INSERT ON TABLE public.money_coffee_visit_lines TO authenticated;
--> statement-breakpoint
GRANT DELETE ON TABLE public.money_coffee_visit_lines TO authenticated;
