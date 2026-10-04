-- Narrow the MCP audit-tool allowlist to the capabilities that actually exist.
--
-- WHY THIS EXISTS. 0065 introduced private.is_registered_mcp_tool so that
-- record_mcp_audit_event could no longer be used to forge mcp_tool_call rows
-- for tools that do not exist. That was correct in intent, but the allowlist
-- 0065 shipped also listed nine capabilities - the permissions_version 2 reads -
-- that had no schema, no handler and no registration. Because the runtime
-- capability registry and this allowlist are the same authorization statement
-- expressed twice, that made the database admit audit events for tools a client
-- could never invoke, and it would have made the registry-versus-SQL proof fail
-- from the moment it was written.
--
-- A planned tool must not appear in the audit allowlist, in permission
-- discovery, or in getAllToolNames() before it has a real executable
-- implementation. Capabilities are added atomically: registry entry, schema,
-- handler, application delegation, permission requirement, rate class, audit
-- identity and tests, in one wave - and this allowlist widens in that same
-- wave.
--
-- WHEN THE VERSION 2 READS LAND. This function is replaced again in that wave,
-- adding exactly the tools that shipped with them. It must never be widened
-- ahead of the handlers.
--
-- apps/web/src/lib/mcp/capability-registry-migration.test.ts compares this
-- allowlist against the canonical runtime registry in both directions, so a
-- change to one without the other fails the build.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.is_registered_mcp_tool(p_tool_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
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
