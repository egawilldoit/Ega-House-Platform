-- Close the column-granularity gap in the MCP write path.
--
-- WHY THIS EXISTS. The MCP runtime authenticates with the raw OAuth bearer and
-- sends that same bearer to PostgREST as the Authorization header
-- (apps/web/src/lib/mcp/supabase-user-client.ts). The bearer carries
-- role=authenticated, so at the database it resolves to the same Postgres role
-- as a browser session; the only distinguishing claim is client_id. The
-- mcp_*_access policies written by 0051/0053/0055 are ROW predicates, so
-- private.has_active_mcp_permission can prove "this grant holds tasks.update"
-- but cannot prove "this grant changed only the columns ega_update_task
-- advertises". A direct PATCH /rest/v1/tasks under a tasks.update grant could
-- therefore also write focus_rank, planned_for_date, the calendar_* mirror
-- columns, scheduled_start_at/end_at, created_at and the primary key. Nothing
-- above PostgREST (the Zod
-- .strict() input objects, MCP_WRITES_ENABLED, tool discovery) can constrain a
-- replayed bearer, so the fence has to live here.
--
-- WHAT THIS IS. A pure fence, not business logic. It derives the set of columns
-- a principal may modify from the permissions its ACTIVE grant actually holds,
-- and refuses anything else with SQLSTATE 42501. It adds no state transition
-- rules and no domain semantics; those stay in packages/domain and
-- packages/application.
--
-- NEVER WEAKENS. Direct owner sessions (client_id IS NULL) return NULL from the
-- allowlist computation and pass through completely untouched, so ordinary web
-- and mobile writes - including the scheduling and calendar writes the product
-- owns - are unaffected. Columns the advertised contract does expose remain
-- writable; the paired regression proof is
-- scripts/db/mcp-oauth-surface-verify.mjs (COLUMN-FENCE section).

--> statement-breakpoint
-- Variadic sibling of private.has_active_mcp_permission(text) so a policy or
-- fence can test several candidate permissions in one active-grant lookup.
CREATE OR REPLACE FUNCTION private.has_any_active_mcp_permission(requested_permissions text[])
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
        AND EXISTS (
          SELECT 1
          FROM unnest(requested_permissions) AS requested(permission)
          WHERE grant_record.permissions @> jsonb_build_array(requested.permission)
        )
    );
$$;

REVOKE ALL ON FUNCTION private.has_any_active_mcp_permission(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_any_active_mcp_permission(text[]) TO authenticated;

--> statement-breakpoint
-- The database-side mirror of the advertised MCP tool contract: for an MCP
-- OAuth principal, which columns of each MCP-writable table a given permission
-- authorises. Returns NULL for a direct owner session, meaning "no fence".
--
-- Derived from apps/web/src/lib/mcp/tool-discovery.ts and the write-tool input
-- schemas in apps/web/src/lib/mcp/server.ts:
--   tasks.update          ega_update_task, ega_archive/unarchive_task,
--                         ega_set_task_focus_rank
--   today.update          ega_plan/remove_task_for_today,
--                         ega_update_today_task_status, ega_clear_completed_today
--   goals.update          ega_update_goal_status/health/next_step, archive/unarchive
--   projects.update       ega_update_project_status, archive/unarchive
--   timer.create/update   ega_start_timer, ega_stop_timer
--   tasks.update          ega_create/cancel_task_reminder
--
-- Columns absent from this list are not reachable by any advertised tool and
-- are therefore refused for MCP principals: id, owner_user_id, created_at,
-- scheduled_start_at, scheduled_end_at, calendar_sync_enabled,
-- calendar_reminder_minutes, calendar_event_id, calendar_sync_status,
-- calendar_sync_failure_reason.
--
-- mcp_operation_id and mcp_client_id ARE writable: 0059's domain fencing writes
-- them on every operationId-carrying mutation, so they are application-written
-- columns rather than an advertised-tool gap, and forging them is self-limiting
-- because the unique index is (owner_user_id, mcp_client_id, mcp_operation_id)
-- and a collision can only fail the principal's own row.
CREATE OR REPLACE FUNCTION private.mcp_writable_columns(p_table text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed text[] := ARRAY[]::text[];
BEGIN
  IF COALESCE((SELECT auth.jwt()) ->> 'client_id', '') = '' THEN
    RETURN NULL;
  END IF;

  IF p_table = 'tasks' THEN
    IF private.has_active_mcp_permission('tasks.update') THEN
      v_allowed := v_allowed || ARRAY[
        'title', 'description', 'blocked_reason', 'status', 'priority', 'due_date',
        'estimate_minutes', 'project_id', 'goal_id', 'focus_rank', 'completed_at',
        'archived_at', 'archived_by', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
    IF private.has_active_mcp_permission('today.update') THEN
      v_allowed := v_allowed || ARRAY['planned_for_date', 'status', 'updated_at'];
    END IF;
  ELSIF p_table = 'goals' THEN
    IF private.has_active_mcp_permission('goals.update') THEN
      v_allowed := v_allowed || ARRAY[
        'status', 'next_step', 'health', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'projects' THEN
    IF private.has_active_mcp_permission('projects.update') THEN
      v_allowed := v_allowed || ARRAY[
        'status', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'task_sessions' THEN
    IF private.has_active_mcp_permission('timer.create') THEN
      v_allowed := v_allowed || ARRAY[
        'started_at', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
    IF private.has_active_mcp_permission('timer.update') THEN
      v_allowed := v_allowed || ARRAY[
        'ended_at', 'duration_seconds', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'task_reminders' THEN
    IF private.has_active_mcp_permission('tasks.update') THEN
      v_allowed := v_allowed || ARRAY[
        'remind_at', 'channel', 'delivery_mode', 'updated_at',
        'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  END IF;

  RETURN v_allowed;
END $$;

REVOKE ALL ON FUNCTION private.mcp_writable_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mcp_writable_columns(text) TO authenticated;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.enforce_mcp_write_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allowed text[];
  v_forbidden text[];
  v_old jsonb;
  v_new jsonb;
BEGIN
  v_allowed := private.mcp_writable_columns(TG_TABLE_NAME);
  IF v_allowed IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT coalesce(array_agg(changed_column.name ORDER BY changed_column.name), ARRAY[]::text[])
      INTO v_forbidden
      FROM jsonb_object_keys(v_new) AS changed_column(name)
     WHERE v_new -> changed_column.name IS DISTINCT FROM v_old -> changed_column.name;
    v_forbidden := ARRAY(
      SELECT unnest(v_forbidden)
      EXCEPT
      SELECT unnest(v_allowed)
    );
  ELSE
    -- INSERT. Column defaults are already applied at this point, so a column
    -- can only be *proved* caller-chosen by differing from its default. The
    -- never-writable group below is exactly the set whose defaults are stable.
    v_forbidden := ARRAY[]::text[];
    IF TG_TABLE_NAME = 'tasks' AND (
      NEW.scheduled_start_at IS NOT NULL
      OR NEW.scheduled_end_at IS NOT NULL
      OR NEW.calendar_event_id IS NOT NULL
      OR NEW.calendar_sync_status IS NOT NULL
      OR NEW.calendar_sync_failure_reason IS NOT NULL
      OR NEW.calendar_sync_enabled IS DISTINCT FROM false
      OR NEW.calendar_reminder_minutes IS DISTINCT FROM 10
    ) THEN
      v_forbidden := ARRAY[
        'scheduled_start_at', 'scheduled_end_at', 'calendar_sync_enabled',
        'calendar_reminder_minutes', 'calendar_event_id', 'calendar_sync_status',
        'calendar_sync_failure_reason'
      ];
    END IF;
  END IF;

  IF array_length(v_forbidden, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'MCP write fence: an MCP OAuth principal may not modify % on public.%',
      array_to_string(v_forbidden, ', '), TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.enforce_mcp_write_fence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_mcp_write_fence() TO authenticated;

--> statement-breakpoint
CREATE TRIGGER projects_mcp_write_fence
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_write_fence();

CREATE TRIGGER goals_mcp_write_fence
  BEFORE INSERT OR UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_write_fence();

CREATE TRIGGER tasks_mcp_write_fence
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_write_fence();

CREATE TRIGGER task_sessions_mcp_write_fence
  BEFORE INSERT OR UPDATE ON public.task_sessions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_write_fence();

CREATE TRIGGER task_reminders_mcp_write_fence
  BEFORE INSERT OR UPDATE ON public.task_reminders
  FOR EACH ROW EXECUTE FUNCTION private.enforce_mcp_write_fence();

--> statement-breakpoint
-- Restore the referential ownership checks that 0007 enforced and 0041/0051
-- dropped when they replaced the WITH CHECK with the client_id gate. Without
-- them an MCP principal holding tasks.update could point a task at another
-- owner's project or goal while the row itself stayed owner-scoped, so no
-- cross-owner row was ever visible - only a cross-owner reference.
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
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = tasks.project_id
        AND project.owner_user_id = (SELECT auth.uid())
    )
    AND (
      tasks.goal_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.goals AS goal
        WHERE goal.id = tasks.goal_id
          AND goal.owner_user_id = (SELECT auth.uid())
      )
    )
  );

--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_mcp_insert_access" ON public.tasks;
CREATE POLICY "tasks_mcp_insert_access"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.create')
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = tasks.project_id
        AND project.owner_user_id = (SELECT auth.uid())
    )
    AND (
      tasks.goal_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.goals AS goal
        WHERE goal.id = tasks.goal_id
          AND goal.owner_user_id = (SELECT auth.uid())
      )
    )
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
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = goals.project_id
        AND project.owner_user_id = (SELECT auth.uid())
    )
  );

--> statement-breakpoint
DROP POLICY IF EXISTS "goals_mcp_insert_access" ON public.goals;
CREATE POLICY "goals_mcp_insert_access"
  ON public.goals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('goals.create')
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = goals.project_id
        AND project.owner_user_id = (SELECT auth.uid())
    )
  );
