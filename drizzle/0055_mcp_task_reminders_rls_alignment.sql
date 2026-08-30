-- Align task_reminders MCP RLS with application permission checks.
--
-- The application handler for createTaskReminder / cancelTaskReminder
-- requires tasks.update (see apps/web/src/lib/mcp/write/tasks.ts). The
-- previous RLS for task_reminders_mcp_insert_access checked tasks.create,
-- which is more permissive than the handler for a profile that might hold
-- tasks.create without tasks.update (no current profile does, but the
-- layering should be consistent).Align RLS to tasks.update.

--> statement-breakpoint
DROP POLICY IF EXISTS "task_reminders_mcp_insert_access" ON public.task_reminders;

--> statement-breakpoint
CREATE POLICY "task_reminders_mcp_insert_access"
  ON public.task_reminders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('tasks.update')
  );
