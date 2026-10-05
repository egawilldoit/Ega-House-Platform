-- Let an MCP principal observe the rows it is authorised to change.
--
-- WHY THIS EXISTS. Postgres applies SELECT policies to `UPDATE ... RETURNING`.
-- The MCP UPDATE policy on task_reminders is gated on tasks.update (0069) but
-- the MCP SELECT policy was gated on tasks.read alone (0051), so the two did not
-- agree.
--
-- packages/data-access/src/tasks/repository.ts now selects the updated row and
-- fails when none matched, which is what fixed ega_cancel_task_reminder
-- reporting success over zero rows. That check is only sound while the caller
-- can see the row it just changed. permissions.ts explicitly plans later
-- additive permission versions, so the first document that grants tasks.update
-- without tasks.read would have made ega_cancel_task_reminder report
-- "Unable to cancel reminder right now." for a cancellation that HAD happened -
-- the inverse of the bug it was written to fix, and a state change a client
-- would retry.
--
-- Write authority implies read-back authority for the same row. This is not a
-- widening of what MCP can change: the column fence still governs which columns
-- may change, and every shipped v1/v2 document already holds tasks.read, so
-- nothing observable changes today.

--> statement-breakpoint
DROP POLICY IF EXISTS "task_reminders_mcp_select_access" ON public.task_reminders;
CREATE POLICY "task_reminders_mcp_select_access"
  ON public.task_reminders
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND (
      private.has_active_mcp_permission('tasks.read')
      OR private.has_active_mcp_permission('tasks.update')
    )
  );
