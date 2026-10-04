-- Make referential ownership checks independent of the caller's own RLS.
--
-- WHY THIS EXISTS. 0064 restored the referential ownership WITH CHECK that 0007
-- had, in the form:
--
--   AND EXISTS (SELECT 1 FROM public.projects p
--                WHERE p.id = tasks.project_id AND p.owner_user_id = auth.uid())
--
-- A policy expression is evaluated as the invoking user, so that subquery is
-- itself filtered by projects_select_access. An MCP principal therefore sees
-- project rows only if its grant carries projects.read - and a grant that does
-- not, while holding tasks.create, could not create a task in its OWN project:
-- the check silently saw zero rows and the INSERT was refused with 42501.
--
-- That is a permission coupling nobody declared: task creation was implicitly
-- gated on the read permission for projects. The shipped v1/v2 documents all
-- carry projects.read and goals.read, so no released grant is affected, but it
-- is latent - any future document that grants task creation without project
-- reads would break, and it fails closed with a message that points at RLS
-- rather than at the actual cause.
--
-- The check is about ownership, not about read authority, so it must not depend
-- on read authority. These helpers read past RLS deliberately. They are
-- SECURITY DEFINER, owned by the migration role, and take only a row id - they
-- return a boolean and cannot be used to read data. One function per referenced
-- table rather than a dynamic-table-name dispatch, so there is no string
-- interpolation into SQL.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.user_owns_project(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = p_id
        AND project.owner_user_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION private.user_owns_goal(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.goals AS goal
      WHERE goal.id = p_id
        AND goal.owner_user_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION private.user_owns_task(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.tasks AS task
      WHERE task.id = p_id
        AND task.owner_user_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON FUNCTION private.user_owns_project(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.user_owns_goal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.user_owns_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.user_owns_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_owns_goal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_owns_task(uuid) TO authenticated;

--> statement-breakpoint
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
    AND private.user_owns_project(project_id)
    AND (goal_id IS NULL OR private.user_owns_goal(goal_id))
  );

DROP POLICY IF EXISTS "tasks_mcp_insert_access" ON public.tasks;
CREATE POLICY "tasks_mcp_insert_access"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.create')
    AND private.user_owns_project(project_id)
    AND (goal_id IS NULL OR private.user_owns_goal(goal_id))
  );

--> statement-breakpoint
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
    AND private.user_owns_project(project_id)
  );

DROP POLICY IF EXISTS "goals_mcp_insert_access" ON public.goals;
CREATE POLICY "goals_mcp_insert_access"
  ON public.goals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('goals.create')
    AND private.user_owns_project(project_id)
  );

--> statement-breakpoint
DROP POLICY IF EXISTS "task_reminders_mcp_insert_access" ON public.task_reminders;
CREATE POLICY "task_reminders_mcp_insert_access"
  ON public.task_reminders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.update')
    AND private.user_owns_task(task_id)
  );

DROP POLICY IF EXISTS "task_sessions_mcp_insert_access" ON public.task_sessions;
CREATE POLICY "task_sessions_mcp_insert_access"
  ON public.task_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('timer.create')
    AND private.user_owns_task(task_id)
  );
