-- MCP write fence: classify projects.area_id as a known column.
--
-- main added projects.area_id (0077_areas). The fence's catalog guard
-- (private.enforce_mcp_write_fence) fails closed when a table has columns not
-- present in private.mcp_known_fenced_columns(), so area_id must be classified
-- even if not MCP-writable. This is classification only - no permission
-- expansion; area_id remains non-writable by MCP principals.
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
      'focus_rank', 'estimate_minutes', 'planned_for_date', 'scheduled_start_at',
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
      'id', 'owner_user_id', 'name', 'slug', 'description', 'status', 'area_id',
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
