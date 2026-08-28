-- Split task_sessions MCP write access into separate INSERT/UPDATE policies (was FOR ALL)
--> statement-breakpoint
DROP POLICY IF EXISTS "task_sessions_mcp_write_access" ON public.task_sessions;

CREATE POLICY "task_sessions_mcp_insert_access"
  ON public.task_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('timer.create')
  );

CREATE POLICY "task_sessions_mcp_update_access"
  ON public.task_sessions
  FOR UPDATE
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('timer.update')
  )
  WITH CHECK (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_active_mcp_permission('timer.update')
  );

-- Keep read policy as is (timer.read) — already separate
