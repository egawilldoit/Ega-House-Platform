-- MONEY-01: issue the existing finance/routine profiles and permit Money
-- reads/writes only through an explicit active OAuth grant.
--
-- Baseline: 0092 is the journal tail. This adds no new table and does not
-- rewrite any applied migration.
--
-- What changes:
--   1. `personal_operations`, `personal_operations_writer` and the combined
--      `workspace_money_reader`/`workspace_money_writer` profiles become
--      storable with their exact advertised permission union. Historical
--      read_only/task_manager/workspace_manager/delivery_observer rows are
--      preserved, including the older failed/revoked permission subsets.
--   2. `public.mcp_finance_grant_allows(permission)` resolves the current
--      OAuth client/resource grant. It mirrors `resolve_active_mcp_grant`:
--      owner = auth.uid(), client = client_id claim, resource = aud claim,
--      status active and not revoked.
--   3. `personal_expenses` SELECT/INSERT/UPDATE policies keep the direct-user
--      (no client_id) path and add the matching active grant. A money reader
--      cannot insert/update; a money writer can. Missing, revoked, wrong
--      client/resource and cross-owner requests remain denied. The table still
--      has no DELETE grant or policy.
--
-- The existing immutable-column/version trigger is untouched, so MCP writes
-- inherit the same soft-delete and optimistic-concurrency invariants.

-- 1. Grant profile constraints -------------------------------------------------
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_check;
--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_profile_check
  CHECK (
    permission_profile IN (
      'read_only',
      'task_manager',
      'workspace_manager',
      'personal_operations',
      'personal_operations_writer',
      'workspace_money_reader',
      'workspace_money_writer'
    )
    OR (
      permission_profile = 'delivery_observer'
      AND status IN ('failed', 'revoked')
      AND permissions = '["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"]'::jsonb
    )
  );
--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_permissions_check;
--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_profile_permissions_check
  CHECK (
    (
      status IN ('active', 'pending')
      AND (
        (permission_profile = 'read_only' AND permissions = '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"]'::jsonb)
        OR (permission_profile = 'task_manager' AND permissions = '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update", "today.read", "timer.read"]'::jsonb)
        OR (permission_profile = 'workspace_manager' AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb)
        OR (permission_profile = 'personal_operations' AND permissions = '["today.read", "timer.read", "personal_ops.read"]'::jsonb)
        OR (permission_profile = 'personal_operations_writer' AND permissions = '["today.read", "timer.read", "personal_ops.read", "personal_ops.write"]'::jsonb)
        OR (permission_profile = 'workspace_money_reader' AND permissions = '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read", "personal_ops.read"]'::jsonb)
        OR (permission_profile = 'workspace_money_writer' AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update", "personal_ops.read", "personal_ops.write"]'::jsonb)
      )
    )
    OR (
      status IN ('failed', 'revoked')
      AND (
        (permission_profile = 'read_only' AND permissions IN (
          '["projects.read", "goals.read", "tasks.read"]'::jsonb,
          '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"]'::jsonb
        ))
        OR (permission_profile = 'task_manager' AND permissions IN (
          '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update"]'::jsonb,
          '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update", "today.read", "timer.read"]'::jsonb
        ))
        OR (permission_profile = 'delivery_observer' AND permissions = '["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"]'::jsonb)
        OR (permission_profile = 'workspace_manager' AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb)
        OR (permission_profile = 'personal_operations' AND permissions = '["today.read", "timer.read", "personal_ops.read"]'::jsonb)
        OR (permission_profile = 'personal_operations_writer' AND permissions = '["today.read", "timer.read", "personal_ops.read", "personal_ops.write"]'::jsonb)
        OR (permission_profile = 'workspace_money_reader' AND permissions = '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read", "personal_ops.read"]'::jsonb)
        OR (permission_profile = 'workspace_money_writer' AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update", "personal_ops.read", "personal_ops.write"]'::jsonb)
      )
    )
  );

-- 2. Grant-aware finance capability -------------------------------------------
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mcp_finance_grant_allows(required_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.mcp_authorization_grants AS grant_record
    WHERE auth.uid() IS NOT NULL
      AND NULLIF(auth.jwt() ->> 'client_id', '') IS NOT NULL
      AND NULLIF(auth.jwt() ->> 'aud', '') IS NOT NULL
      AND grant_record.owner_user_id = auth.uid()
      AND grant_record.oauth_client_id = auth.jwt() ->> 'client_id'
      AND grant_record.resource_uri = auth.jwt() ->> 'aud'
      AND grant_record.status = 'active'
      AND grant_record.revoked_at IS NULL
      AND grant_record.permissions ? required_permission
  );
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mcp_finance_grant_allows(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mcp_finance_grant_allows(text) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mcp_finance_grant_allows(text) TO authenticated;

-- 3. Money read/write RLS ------------------------------------------------------
--> statement-breakpoint
DROP POLICY IF EXISTS "personal_expenses_direct_user_select" ON "public"."personal_expenses";
--> statement-breakpoint
CREATE POLICY "personal_expenses_direct_user_select" ON "public"."personal_expenses"
  FOR SELECT TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.read')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "personal_expenses_direct_user_insert" ON "public"."personal_expenses";
--> statement-breakpoint
CREATE POLICY "personal_expenses_direct_user_insert" ON "public"."personal_expenses"
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR public.mcp_finance_grant_allows('personal_ops.write')
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS "personal_expenses_direct_user_update" ON "public"."personal_expenses";
--> statement-breakpoint
CREATE POLICY "personal_expenses_direct_user_update" ON "public"."personal_expenses"
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
