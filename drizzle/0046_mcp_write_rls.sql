-- MCP write RLS — permission-aware OAuth writes for workspace_manager.
-- Direct user sessions keep owner-scoped ALL access. OAuth clients gain
-- INSERT/UPDATE/DELETE only when the JWT carries an active workspace_manager
-- grant with the matching permission. Anonymous remains denied via RESTRICTIVE policies elsewhere.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.has_active_mcp_permission(requested_permission text)
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

REVOKE ALL ON FUNCTION private.has_active_mcp_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_active_mcp_permission(text) TO authenticated;

--> statement-breakpoint
-- Projects write policies

DROP POLICY IF EXISTS "projects_mcp_insert_access" ON public.projects;
CREATE POLICY "projects_mcp_insert_access"
  ON public.projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('projects.create')
  );

DROP POLICY IF EXISTS "projects_mcp_update_access" ON public.projects;
CREATE POLICY "projects_mcp_update_access"
  ON public.projects
  FOR UPDATE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('projects.update')
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('projects.update')
  );

DROP POLICY IF EXISTS "projects_mcp_delete_access" ON public.projects;
CREATE POLICY "projects_mcp_delete_access"
  ON public.projects
  FOR DELETE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('projects.update')
  );

--> statement-breakpoint
-- Goals write policies

DROP POLICY IF EXISTS "goals_mcp_insert_access" ON public.goals;
CREATE POLICY "goals_mcp_insert_access"
  ON public.goals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('goals.create')
  );

DROP POLICY IF EXISTS "goals_mcp_update_access" ON public.goals;
CREATE POLICY "goals_mcp_update_access"
  ON public.goals
  FOR UPDATE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('goals.update')
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('goals.update')
  );

DROP POLICY IF EXISTS "goals_mcp_delete_access" ON public.goals;
CREATE POLICY "goals_mcp_delete_access"
  ON public.goals
  FOR DELETE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('goals.update')
  );

--> statement-breakpoint
-- Tasks write policies

DROP POLICY IF EXISTS "tasks_mcp_insert_access" ON public.tasks;
CREATE POLICY "tasks_mcp_insert_access"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.create')
  );

DROP POLICY IF EXISTS "tasks_mcp_update_access" ON public.tasks;
CREATE POLICY "tasks_mcp_update_access"
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.update')
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.update')
  );

DROP POLICY IF EXISTS "tasks_mcp_delete_access" ON public.tasks;
CREATE POLICY "tasks_mcp_delete_access"
  ON public.tasks
  FOR DELETE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.update')
  );

--> statement-breakpoint
-- Today is a projection over tasks (planned_for_date, status) — covered by tasks.* policies.
-- No separate table policies required.

--> statement-breakpoint
-- Task sessions (timer) write policies

ALTER TABLE public.task_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_sessions_direct_user_all" ON public.task_sessions;
DROP POLICY IF EXISTS "task_sessions_mcp_write_access" ON public.task_sessions;
DROP POLICY IF EXISTS "task_sessions_mcp_read_access" ON public.task_sessions;

-- Direct user keeps full access when no OAuth client
DROP POLICY IF EXISTS "task_sessions_direct_user_access" ON public.task_sessions;
CREATE POLICY "task_sessions_direct_user_access"
  ON public.task_sessions
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

-- OAuth read for timer
CREATE POLICY "task_sessions_mcp_read_access"
  ON public.task_sessions
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('timer.read')
  );

-- OAuth write for timer
CREATE POLICY "task_sessions_mcp_write_access"
  ON public.task_sessions
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND (
      private.has_active_mcp_permission('timer.create')
      OR private.has_active_mcp_permission('timer.update')
    )
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND (
      private.has_active_mcp_permission('timer.create')
      OR private.has_active_mcp_permission('timer.update')
    )
  );

--> statement-breakpoint
-- Task reminders (via tasks.update)
ALTER TABLE public.task_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_reminders_direct_user_all" ON public.task_reminders;
CREATE POLICY "task_reminders_direct_user_all"
  ON public.task_reminders
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL
  );

DROP POLICY IF EXISTS "task_reminders_mcp_access" ON public.task_reminders;
CREATE POLICY "task_reminders_mcp_access"
  ON public.task_reminders
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.update')
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.update')
  );
