-- Classify columns introduced on main without granting MCP write authority.
-- Keep the catalog guard fail-closed for future unknown columns.
-- board_rank is server-derived: run its existing normalizer after the fence,
-- and reject caller-supplied ranks before either trigger can obscure them.
--> statement-breakpoint
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
      'focus_rank', 'board_rank', 'start_date', 'estimate_minutes', 'planned_for_date', 'scheduled_start_at',
      'scheduled_end_at', 'calendar_sync_enabled', 'calendar_reminder_minutes',
      'calendar_event_id', 'calendar_sync_status', 'calendar_sync_failure_reason',
      'completed_at', 'archived_at', 'archived_by', 'mcp_operation_id', 'mcp_client_id'
    ]
    WHEN 'goals' THEN ARRAY[
      'id', 'owner_user_id', 'project_id', 'title', 'slug', 'description', 'status',
      'created_at', 'updated_at', 'next_step', 'health', 'archived_at', 'archived_by',
      'mcp_operation_id', 'mcp_client_id'
    ]
    WHEN 'projects' THEN ARRAY[
      'id', 'owner_user_id', 'name', 'slug', 'description', 'status', 'area_id', 'template_operation_id',
      'created_at', 'updated_at', 'archived_at', 'archived_by',
      'mcp_operation_id', 'mcp_client_id'
    ]
    WHEN 'task_sessions' THEN ARRAY[
      'id', 'owner_user_id', 'task_id', 'started_at', 'ended_at', 'duration_seconds',
      'created_at', 'updated_at', 'actor_kind', 'actor_user_id', 'actor_agent_id',
      'actor_label', 'mcp_operation_id', 'mcp_client_id'
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
CREATE OR REPLACE FUNCTION private.guard_mcp_main_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce((SELECT auth.jwt()) ->> 'client_id', '') = '' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'tasks' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.board_rank IS NOT NULL OR NEW.start_date IS NOT NULL THEN
        RAISE EXCEPTION 'MCP write fence: caller may not supply board_rank or start_date'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.area_id IS NOT NULL OR NEW.template_operation_id IS NOT NULL THEN
        RAISE EXCEPTION 'MCP write fence: caller may not supply area_id or template_operation_id'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.area_id IS DISTINCT FROM OLD.area_id
       OR NEW.template_operation_id IS DISTINCT FROM OLD.template_operation_id THEN
      RAISE EXCEPTION 'MCP write fence: caller may not change area_id or template_operation_id'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.guard_mcp_main_columns() FROM PUBLIC, anon;

--> statement-breakpoint
CREATE TRIGGER a_guard_mcp_main_columns
  BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.guard_mcp_main_columns();
CREATE TRIGGER a_guard_mcp_main_columns
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION private.guard_mcp_main_columns();

--> statement-breakpoint
ALTER TRIGGER assign_task_board_rank ON public.tasks RENAME TO z_assign_task_board_rank;
