-- Close the INSERT hole in the MCP write fence.
--
-- WHY THIS EXISTS. An independent audit of 0064/0068 found the fence sound on
-- UPDATE and absent on INSERT. private.enforce_mcp_write_fence() computes
-- v_allowed from the active grant and then consumes it ONLY inside the
-- `TG_OP = 'UPDATE'` branch; the INSERT branch was a hardcoded seven-column
-- group for tasks and nothing at all for goals, projects, task_sessions and
-- task_reminders.
--
-- Proven reachable with shipped permission documents:
--   * task_manager (tasks.create + tasks.update, NO today.update) could INSERT
--     planned_for_date - a today.update capability - while the UPDATE branch
--     refused the identical column.
--   * any tasks.create grant could INSERT id, created_at, focus_rank,
--     archived_at, archived_by and completed_at, i.e. create a task already
--     archived, already focus-ranked, with a chosen primary key and a
--     back-dated creation instant.
--   * any tasks.update grant could INSERT a task_reminder already marked
--     'sent' with forged sent_at / processed_at / processing_error /
--     failure_reason / source / source_id, which the delivery worker's
--     pending-only indexes never see - a silent, durable suppression of a
--     user-facing reminder.
--   * any timer.create grant could INSERT a task_sessions row with ended_at and
--     duration_seconds set, i.e. a session recorded as already stopped that
--     never passed through ega_stop_timer.
--
-- WHAT THIS DOES. INSERT now obeys the SAME permission-derived allowlist as
-- UPDATE. Any column the principal's grant does not authorise is reset to its
-- declared default, so the caller's value cannot survive rather than merely
-- being detected. Resetting rather than raising is what makes id workable: its
-- default gen_random_uuid() is volatile, so no comparison against "the value
-- the default would have produced" can distinguish a caller-chosen key from a
-- generated one.
--
-- The forced-default table below is explicit and per table, which means a
-- column added by a future migration would be unclassified. That is closed by
-- the catalog guard at the end of this migration: every write through the fence
-- fails closed if the target table has a column the fence does not know about.
--
-- Also in this migration, from the same audit:
--   * F-6 task_reminders had no MCP UPDATE policy at all, so
--     ega_cancel_task_reminder - an advertised tool - reported success and
--     changed nothing. The policy is added and `status` is authorised.
--   * F-5 task_reminders / task_sessions INSERT lacked the referential
--     ownership EXISTS that 0064 restored for tasks and goals, so an MCP
--     bearer could create a cross-owner write edge into another tenant's task
--     (ON DELETE CASCADE from that task).
--   * F-9 the today.update branch omitted blocked_reason, which
--     ega_update_today_task_status writes. Latent today only because every
--     shipped document holding today.update also holds tasks.update.
--   * F-8 private.is_registered_mcp_tool had no search_path pin unlike its
--     four siblings.

--> statement-breakpoint
-- private.mcp_writable_columns() is the UPDATE allowlist only. Folding the
-- create columns into it was tried and reverted: it made name, slug,
-- description and task_id renameable on an existing row, which no advertised
-- tool does. What a principal may set when creating a row is a different
-- question from what it may change, so the two lists are separate functions:
-- private.mcp_writable_columns for UPDATE and private.mcp_insertable_columns
-- for INSERT.
--
-- The INSERT column sets below are transcribed from the canonical writes, not
-- from the tool schemas:
--   packages/application/src/tasks/service.ts:93-102
--     -> packages/data-access/src/tasks/repository.ts:257-279
--   packages/data-access/src/goals/repository.ts:163-178
--   packages/data-access/src/projects/repository.ts:278-289
--   packages/data-access/src/timer/repository.ts:127-131
--   packages/data-access/src/tasks/repository.ts:394-406
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
      v_allowed := v_allowed || ARRAY[
        'planned_for_date', 'status', 'blocked_reason', 'updated_at'
      ];
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
        'remind_at', 'channel', 'delivery_mode', 'status', 'updated_at',
        'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  END IF;

  RETURN v_allowed;
END $$;

REVOKE ALL ON FUNCTION private.mcp_writable_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mcp_writable_columns(text) TO authenticated;

--> statement-breakpoint
-- What a principal may set AT INSERT is genuinely different from what it may
-- change on an existing row, so INSERT gets its own allowlist rather than
-- reusing the UPDATE one.
--
-- The load-bearing difference is task_reminders.status. ega_create_task_reminder
-- is gated on tasks.update and the canonical create writes status 'pending',
-- but the column is not authorisable at INSERT: allowing it would let a bearer
-- create a reminder already marked 'sent', and both delivery indexes filter on
-- status = 'pending', so it would never be delivered or retried. It IS
-- authorisable on UPDATE, which is where ega_cancel_task_reminder needs it.
--
-- planned_for_date is likewise excluded from the tasks INSERT set: the
-- canonical create already clears it, so resetting it is the same outcome, and
-- excluding it keeps "may this principal plan work for today" a today.update
-- question even at creation time.
CREATE OR REPLACE FUNCTION private.mcp_insertable_columns(p_table text)
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
    IF private.has_active_mcp_permission('tasks.create') THEN
      v_allowed := v_allowed || ARRAY[
        'title', 'description', 'blocked_reason', 'status', 'priority', 'due_date',
        'estimate_minutes', 'project_id', 'goal_id', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'goals' THEN
  ELSIF p_table = 'projects' THEN
  ELSIF p_table = 'task_sessions' THEN
    IF private.has_active_mcp_permission('timer.create') THEN
      v_allowed := v_allowed || ARRAY[
        'task_id', 'started_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'task_reminders' THEN
    IF private.has_active_mcp_permission('tasks.update') THEN
      v_allowed := v_allowed || ARRAY[
        'task_id', 'remind_at', 'channel', 'delivery_mode', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  END IF;

  RETURN v_allowed;
END $$;

REVOKE ALL ON FUNCTION private.mcp_insertable_columns(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mcp_insertable_columns(text) TO authenticated;

--> statement-breakpoint
-- Every column of every fenced table as of this migration. Combined with the
-- forced-default table above, this is the complete classification the fence
-- understands: a column is either authorisable through a permission, or
-- resettable to a default. A column in neither is a gap, and the catalog guard
-- refuses writes rather than letting it through.
CREATE OR REPLACE FUNCTION private.mcp_known_fenced_columns(p_table text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_table
    WHEN 'tasks' THEN ARRAY[
      'id', 'owner_user_id', 'project_id', 'goal_id', 'title', 'description',
      'blocked_reason', 'status', 'priority', 'created_at', 'updated_at', 'due_date',
      'focus_rank', 'estimate_minutes', 'planned_for_date', 'scheduled_start_at',
      'scheduled_end_at', 'calendar_sync_enabled', 'calendar_reminder_minutes',
      'calendar_event_id', 'calendar_sync_status', 'calendar_sync_failure_reason',
      'completed_at', 'archived_at', 'archived_by', 'mcp_operation_id', 'mcp_client_id'
    ]
    WHEN 'goals' THEN ARRAY[
      'id', 'owner_user_id', 'project_id', 'title', 'slug', 'description', 'status',
      'created_at', 'updated_at', 'next_step', 'health', 'mcp_operation_id', 'mcp_client_id'
    ]
    WHEN 'projects' THEN ARRAY[
      'id', 'owner_user_id', 'name', 'slug', 'description', 'status',
      'created_at', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
    ]
    WHEN 'task_sessions' THEN ARRAY[
      'id', 'owner_user_id', 'task_id', 'started_at', 'ended_at', 'duration_seconds',
      'created_at', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
    ]
    WHEN 'task_reminders' THEN ARRAY[
      'id', 'owner_user_id', 'task_id', 'remind_at', 'channel', 'status', 'sent_at',
      'failure_reason', 'created_at', 'updated_at', 'delivery_mode', 'processed_at',
      'processing_error', 'source', 'source_id', 'mcp_operation_id', 'mcp_client_id'
    ]
    ELSE ARRAY[]::text[]
  END;
END $$;

REVOKE ALL ON FUNCTION private.mcp_known_fenced_columns(text) FROM PUBLIC, anon;

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
  v_known text[];
  v_old jsonb;
  v_new jsonb;
  v_column text;
  v_actual text[];
BEGIN
  v_allowed := private.mcp_writable_columns(TG_TABLE_NAME);
  IF v_allowed IS NULL THEN
    RETURN NEW;
  END IF;

  -- Catalog guard. Cheap pg_attribute read rather than information_schema. A
  -- column this migration does not know about is unclassified, so the fence
  -- refuses the write instead of silently permitting an unvetted column.
  SELECT coalesce(array_agg(att.attname), ARRAY[]::text[])
    INTO v_actual
    FROM pg_attribute AS att
   WHERE att.attrelid = to_regclass('public.' || TG_TABLE_NAME)
     AND att.attnum > 0
     AND NOT att.attisdropped;

  v_known := private.mcp_known_fenced_columns(TG_TABLE_NAME);
  IF v_known <> ARRAY[]::text[]
    AND EXISTS (SELECT 1 FROM unnest(v_actual) AS col(name) WHERE NOT (name = ANY (v_known)))
  THEN
    RAISE EXCEPTION
      'MCP write fence: public.% has a column this fence does not classify; extend it before writing',
      TG_TABLE_NAME
      USING ERRCODE = '42501';
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

    IF array_length(v_forbidden, 1) IS NOT NULL THEN
      RAISE EXCEPTION
        'MCP write fence: an MCP OAuth principal may not modify % on public.%',
        array_to_string(v_forbidden, ', '), TG_TABLE_NAME
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- INSERT. Every column the principal's grant does not authorise is reset to
    -- its declared default, by explicit assignment rather than by a
    -- jsonb_populate_record round trip: assignment is type-correct by
    -- construction, and a volatile default such as id's gen_random_uuid() could
    -- never be detected by comparison in the first place.
    --
    -- owner_user_id is deliberately NOT in this list. Ownership is the RLS
    -- WITH CHECK's job; resetting it here would rewrite a caller-supplied
    -- foreign owner to the caller's own id before the policy ran, converting
    -- "cross-owner insert refused" into "cross-owner insert silently became
    -- mine" and hiding the attempt. Leaving it to the column default and the
    -- policy keeps the refusal observable.
    --
    -- Resetting rather than raising is deliberate. A caller-chosen primary key
    -- is silently replaced instead of erroring, so the caller cannot use the
    -- error as an oracle and no legitimate create path is broken.
    --
    -- Nesting is required, not stylistic: plpgsql hands a combined
    -- `TG_TABLE_NAME = 'x' AND NEW.col ...` condition to the executor as one
    -- expression and resolves the record field for every table.
    --
    -- INSERT uses its own allowlist, not the UPDATE one: what a principal may
    -- set when creating a row is a different question from what it may change.
    v_allowed := private.mcp_insertable_columns(TG_TABLE_NAME);

    IF TG_TABLE_NAME = 'tasks' THEN
      IF NOT ('id' = ANY (v_allowed)) THEN NEW.id := gen_random_uuid(); END IF;
      IF NOT ('created_at' = ANY (v_allowed)) THEN NEW.created_at := now(); END IF;
      IF NOT ('updated_at' = ANY (v_allowed)) THEN NEW.updated_at := now(); END IF;
      IF NOT ('archived_at' = ANY (v_allowed)) THEN NEW.archived_at := NULL; END IF;
      IF NOT ('archived_by' = ANY (v_allowed)) THEN NEW.archived_by := NULL; END IF;
      IF NOT ('focus_rank' = ANY (v_allowed)) THEN NEW.focus_rank := NULL; END IF;
      IF NOT ('completed_at' = ANY (v_allowed)) THEN NEW.completed_at := NULL; END IF;
      -- planned_for_date is a today.update capability (ega_plan_task_for_today)
      -- even at creation time: the canonical create already clears it, so
      -- resetting it is the same outcome and keeps the authority honest.
      IF NOT ('planned_for_date' = ANY (v_allowed)) THEN NEW.planned_for_date := NULL; END IF;
      IF NOT ('scheduled_start_at' = ANY (v_allowed)) THEN NEW.scheduled_start_at := NULL; END IF;
      IF NOT ('scheduled_end_at' = ANY (v_allowed)) THEN NEW.scheduled_end_at := NULL; END IF;
      IF NOT ('calendar_sync_enabled' = ANY (v_allowed)) THEN NEW.calendar_sync_enabled := false; END IF;
      IF NOT ('calendar_reminder_minutes' = ANY (v_allowed)) THEN NEW.calendar_reminder_minutes := 10; END IF;
      IF NOT ('calendar_event_id' = ANY (v_allowed)) THEN NEW.calendar_event_id := NULL; END IF;
      IF NOT ('calendar_sync_status' = ANY (v_allowed)) THEN NEW.calendar_sync_status := NULL; END IF;
      IF NOT ('calendar_sync_failure_reason' = ANY (v_allowed)) THEN NEW.calendar_sync_failure_reason := NULL; END IF;
    ELSIF TG_TABLE_NAME = 'goals' THEN
      IF NOT ('id' = ANY (v_allowed)) THEN NEW.id := gen_random_uuid(); END IF;
      IF NOT ('created_at' = ANY (v_allowed)) THEN NEW.created_at := now(); END IF;
      IF NOT ('updated_at' = ANY (v_allowed)) THEN NEW.updated_at := now(); END IF;
    ELSIF TG_TABLE_NAME = 'projects' THEN
      IF NOT ('id' = ANY (v_allowed)) THEN NEW.id := gen_random_uuid(); END IF;
      IF NOT ('created_at' = ANY (v_allowed)) THEN NEW.created_at := now(); END IF;
      IF NOT ('updated_at' = ANY (v_allowed)) THEN NEW.updated_at := now(); END IF;
      -- status is a projects.update capability (ega_update_project_status). The
      -- canonical create does not set it, so a new project starts 'planned'.
      IF NOT ('status' = ANY (v_allowed)) THEN NEW.status := 'planned'; END IF;
    ELSIF TG_TABLE_NAME = 'task_sessions' THEN
      IF NOT ('id' = ANY (v_allowed)) THEN NEW.id := gen_random_uuid(); END IF;
      IF NOT ('created_at' = ANY (v_allowed)) THEN NEW.created_at := now(); END IF;
      IF NOT ('updated_at' = ANY (v_allowed)) THEN NEW.updated_at := now(); END IF;
      IF NOT ('ended_at' = ANY (v_allowed)) THEN NEW.ended_at := NULL; END IF;
      IF NOT ('duration_seconds' = ANY (v_allowed)) THEN NEW.duration_seconds := NULL; END IF;
    ELSIF TG_TABLE_NAME = 'task_reminders' THEN
      IF NOT ('id' = ANY (v_allowed)) THEN NEW.id := gen_random_uuid(); END IF;
      IF NOT ('created_at' = ANY (v_allowed)) THEN NEW.created_at := now(); END IF;
      IF NOT ('updated_at' = ANY (v_allowed)) THEN NEW.updated_at := now(); END IF;
      -- status is authorisable on UPDATE for ega_cancel_task_reminder but never
      -- at INSERT: a reminder created as 'sent' is invisible to both delivery
      -- indexes, which filter on status = 'pending', so it would never be
      -- delivered or retried.
      IF NOT ('status' = ANY (v_allowed)) THEN NEW.status := 'pending'; END IF;
      IF NOT ('sent_at' = ANY (v_allowed)) THEN NEW.sent_at := NULL; END IF;
      IF NOT ('failure_reason' = ANY (v_allowed)) THEN NEW.failure_reason := NULL; END IF;
      IF NOT ('processed_at' = ANY (v_allowed)) THEN NEW.processed_at := NULL; END IF;
      IF NOT ('processing_error' = ANY (v_allowed)) THEN NEW.processing_error := NULL; END IF;
      IF NOT ('source' = ANY (v_allowed)) THEN NEW.source := NULL; END IF;
      IF NOT ('source_id' = ANY (v_allowed)) THEN NEW.source_id := NULL; END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.enforce_mcp_write_fence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_mcp_write_fence() TO authenticated;

--> statement-breakpoint
-- F-6: ega_cancel_task_reminder issues an UPDATE that affected zero rows under
-- RLS and reported success, because task_reminders had no MCP UPDATE policy.
-- The policy is owner-scoped, client-gated and permission-gated; the fence
-- then restricts it to the columns cancelReminder actually writes.
DROP POLICY IF EXISTS "task_reminders_mcp_update_access" ON public.task_reminders;
CREATE POLICY "task_reminders_mcp_update_access"
  ON public.task_reminders
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

--> statement-breakpoint
-- F-5: referential ownership for the two remaining MCP-writable child tables.
-- Without this an MCP bearer could create a reminder on, or time work against,
-- another owner's task: no foreign row is ever readable, but a cross-owner
-- write edge into that tenant's task lifecycle is created, and the reminder is
-- ON DELETE CASCADE from it.
DROP POLICY IF EXISTS "task_reminders_mcp_insert_access" ON public.task_reminders;
CREATE POLICY "task_reminders_mcp_insert_access"
  ON public.task_reminders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.update')
    AND EXISTS (
      SELECT 1 FROM public.tasks AS task
      WHERE task.id = task_reminders.task_id
        AND task.owner_user_id = (SELECT auth.uid())
    )
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
    AND EXISTS (
      SELECT 1 FROM public.tasks AS task
      WHERE task.id = task_sessions.task_id
        AND task.owner_user_id = (SELECT auth.uid())
    )
  );

--> statement-breakpoint
-- F-8: pin search_path like every sibling private helper.
CREATE OR REPLACE FUNCTION private.is_registered_mcp_tool(p_tool_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_tool_name = ANY (ARRAY[
    'ega_get_capabilities',
    'ega_list_projects',
    'ega_get_task',
    'ega_list_goals',
    'ega_list_tasks',
    'ega_get_today_plan',
    'ega_list_timer_sessions',
    'ega_create_project',
    'ega_update_project_status',
    'ega_archive_project',
    'ega_unarchive_project',
    'ega_create_goal',
    'ega_update_goal_status',
    'ega_update_goal_health',
    'ega_update_goal_next_step',
    'ega_archive_goal',
    'ega_unarchive_goal',
    'ega_create_task',
    'ega_update_task',
    'ega_archive_task',
    'ega_unarchive_task',
    'ega_set_task_focus_rank',
    'ega_create_task_reminder',
    'ega_cancel_task_reminder',
    'ega_plan_task_for_today',
    'ega_remove_task_from_today',
    'ega_update_today_task_status',
    'ega_clear_completed_today',
    'ega_start_timer',
    'ega_stop_timer'
  ]::text[]);
$$;

REVOKE ALL ON FUNCTION private.is_registered_mcp_tool(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_registered_mcp_tool(text) TO authenticated;
