-- MCP security and performance hardening discovered during real Supabase
-- PostgreSQL 17 staging validation.

--> statement-breakpoint

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.has_active_mcp_permission(
  requested_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND COALESCE((SELECT auth.jwt()) ->> 'client_id', '') <> ''
    AND COALESCE((SELECT auth.jwt()) ->> 'aud', '') <> ''
    AND EXISTS (
      SELECT 1
      FROM public.mcp_authorization_grants AS grant_record
      WHERE grant_record.owner_user_id = (SELECT auth.uid())
        AND grant_record.oauth_client_id = ((SELECT auth.jwt()) ->> 'client_id')
        AND grant_record.resource_uri = ((SELECT auth.jwt()) ->> 'aud')
        AND grant_record.status = 'active'
        AND grant_record.revoked_at IS NULL
        AND grant_record.permissions @> jsonb_build_array(requested_permission)
    );
$$;

REVOKE ALL ON FUNCTION private.has_active_mcp_permission(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_active_mcp_permission(text)
  TO authenticated;

--> statement-breakpoint

DROP POLICY IF EXISTS "projects_direct_user_access" ON public.projects;
DROP POLICY IF EXISTS "projects_mcp_read_access" ON public.projects;
DROP POLICY IF EXISTS "projects_select_access" ON public.projects;
DROP POLICY IF EXISTS "projects_direct_user_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_direct_user_update" ON public.projects;
DROP POLICY IF EXISTS "projects_direct_user_delete" ON public.projects;

CREATE POLICY "projects_select_access"
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR private.has_active_mcp_permission('projects.read')
    )
  );

CREATE POLICY "projects_direct_user_insert"
  ON public.projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

CREATE POLICY "projects_direct_user_update"
  ON public.projects
  FOR UPDATE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

CREATE POLICY "projects_direct_user_delete"
  ON public.projects
  FOR DELETE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

--> statement-breakpoint

DROP POLICY IF EXISTS "goals_direct_user_access" ON public.goals;
DROP POLICY IF EXISTS "goals_mcp_read_access" ON public.goals;
DROP POLICY IF EXISTS "goals_select_access" ON public.goals;
DROP POLICY IF EXISTS "goals_direct_user_insert" ON public.goals;
DROP POLICY IF EXISTS "goals_direct_user_update" ON public.goals;
DROP POLICY IF EXISTS "goals_direct_user_delete" ON public.goals;

CREATE POLICY "goals_select_access"
  ON public.goals
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR private.has_active_mcp_permission('goals.read')
    )
  );

CREATE POLICY "goals_direct_user_insert"
  ON public.goals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

CREATE POLICY "goals_direct_user_update"
  ON public.goals
  FOR UPDATE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

CREATE POLICY "goals_direct_user_delete"
  ON public.goals
  FOR DELETE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

--> statement-breakpoint

DROP POLICY IF EXISTS "tasks_direct_user_access" ON public.tasks;
DROP POLICY IF EXISTS "tasks_mcp_read_access" ON public.tasks;
DROP POLICY IF EXISTS "tasks_select_access" ON public.tasks;
DROP POLICY IF EXISTS "tasks_direct_user_insert" ON public.tasks;
DROP POLICY IF EXISTS "tasks_direct_user_update" ON public.tasks;
DROP POLICY IF EXISTS "tasks_direct_user_delete" ON public.tasks;

CREATE POLICY "tasks_select_access"
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      ((SELECT auth.jwt()) ->> 'client_id') IS NULL
      OR private.has_active_mcp_permission('tasks.read')
    )
  );

CREATE POLICY "tasks_direct_user_insert"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

CREATE POLICY "tasks_direct_user_update"
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

CREATE POLICY "tasks_direct_user_delete"
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

DROP FUNCTION IF EXISTS public.has_active_mcp_permission(text);

--> statement-breakpoint

DROP POLICY IF EXISTS "mcp_grants_select_own"
  ON public.mcp_authorization_grants;
CREATE POLICY "mcp_grants_select_own"
  ON public.mcp_authorization_grants
  FOR SELECT
  TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "agent_events_select_own"
  ON public.agent_integration_events;
CREATE POLICY "agent_events_select_own"
  ON public.agent_integration_events
  FOR SELECT
  TO authenticated
  USING (owner_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "agent_events_insert_own"
  ON public.agent_integration_events;
CREATE POLICY "agent_events_insert_own"
  ON public.agent_integration_events
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = (SELECT auth.uid()));

--> statement-breakpoint

DROP INDEX IF EXISTS public.agent_integration_events_owner_idx;
CREATE INDEX IF NOT EXISTS agent_integration_events_grant_id_idx
  ON public.agent_integration_events (grant_id)
  WHERE grant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_integration_events_token_id_idx
  ON public.agent_integration_events (token_id)
  WHERE token_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_project_id_idx
  ON public.tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_goal_id_idx
  ON public.tasks (goal_id)
  WHERE goal_id IS NOT NULL;

--> statement-breakpoint

ALTER TABLE public.agent_integration_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_tokens_deny_client_access"
  ON public.agent_integration_tokens;
CREATE POLICY "agent_tokens_deny_client_access"
  ON public.agent_integration_tokens
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
REVOKE ALL ON TABLE public.agent_integration_tokens
  FROM anon, authenticated;

DROP POLICY IF EXISTS "mcp_rate_limits_deny_client_table_access"
  ON public.mcp_rate_limit_windows;
CREATE POLICY "mcp_rate_limits_deny_client_table_access"
  ON public.mcp_rate_limit_windows
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

--> statement-breakpoint

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;
