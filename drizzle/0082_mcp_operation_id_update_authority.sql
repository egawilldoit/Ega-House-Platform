-- Take `mcp_operation_id` off the MCP write fence's UPDATE allowlist, so the
-- operation half of the replay key is as unreachable on an existing row as the
-- client half already is.
--
-- WHY THIS EXISTS. 0079 removed `mcp_client_id` from
-- private.mcp_writable_columns() and left `mcp_operation_id` in it, on this
-- reasoning:
--
--   "mcp_operation_id deliberately STAYS authorisable on UPDATE. With
--    mcp_client_id now frozen to the verified client at INSERT, the only value
--    a writer can put there is their own operation key on their own row."
--
-- That is true only for rows the writer CREATED. An owner legitimately holds
-- SEVERAL grants (v1-workspace-client and v2-workspace-client in the shipped
-- fixtures), and the replay/read-back lookup keys on the PAIR:
--
--   .eq("mcp_client_id", identity.mcpClientId).eq("mcp_operation_id", ...)
--
-- so freezing only the client half leaves the pair re-keyable by anyone who can
-- reach the row at all.
--
-- MEASURED on this journal before the fix, as a real MCP principal. The v2
-- client creates a project carrying its own identity, then the v1 bearer - a
-- DIFFERENT grant of the SAME owner - re-keys the operation half:
--
--   -- v2 session:
--   INSERT INTO public.projects (name, slug, mcp_client_id, mcp_operation_id)
--   VALUES ('v2 row', 'v2-row', 'v2-workspace-client', '3333...');
--
--   -- v1 session (same owner, different grant):
--   UPDATE public.projects SET mcp_operation_id = '4444...' WHERE slug = 'v2-row'
--    RETURNING id, mcp_client_id, mcp_operation_id;
--   -> {"id":"...","mcp_client_id":"v2-workspace-client","mcp_operation_id":"4444..."}
--
--   -- superuser read-back: the re-key is DURABLE.
--   -- v2 session, the lookup the application itself performs:
--   SELECT id FROM public.projects
--    WHERE mcp_client_id = 'v2-workspace-client' AND mcp_operation_id = '4444...';
--   -- 1 row: the v2 client's own row, under an operation id the v1 bearer chose
--
-- The v2 integration's replay then returns a row it never created as the result
-- of an operation it never performed. 0079 closed the INSERT direction of
-- exactly this; the UPDATE direction of the operation half was still open.
-- Re-keying the CLIENT half is correctly refused 42501 - only the operation
-- half was authorisable - which is what makes this a partial fix rather than a
-- no-op.
--
-- WHAT THIS CHANGES. One column, on all five fenced tables: `mcp_operation_id`
-- leaves private.mcp_writable_columns(), so an UPDATE that changes it is
-- refused with 42501. Nothing else in the fence moves.
--
-- NO ADVERTISED TOOL RE-KEYS IT ON UPDATE. Grepped at this revision: every
-- `mcpOperationId` write in the application is inside an `.insert(...)` payload
-- on a create path (apps/web/src/lib/mcp/write/tasks.ts createTask +
-- createTaskReminder, write/projects.ts createProject, write/goals.ts
-- createGoal, write/timer.ts startTimer -> startTaskSession), reaching
-- packages/data-access/src/{tasks,projects,goals,timer}/repository.ts, and
-- every repository consumer builds the pair through mcpOperationIdentity()
-- inside an INSERT. Every other read of the column in those files is an
-- `.eq("mcp_operation_id", ...)` replay/lookup filter. There is no UPDATE
-- payload in the repository carrying either identity column, so removing it
-- from the UPDATE allowlist removes no capability the MCP contract advertises.
--
-- THE INSERT PATH IS UNAFFECTED. private.mcp_insertable_columns() is a separate
-- function and this migration does not touch it: the caller still chooses the
-- operation key it creates the row under, which is the whole point of an
-- idempotency key, and 0074's both-or-neither pairing constraint is unaffected
-- because the operation half is still authorisable at INSERT.
--
-- AN IDENTITY-BEARING ROW IS NOT FROZEN. Only the two identity COLUMNS are
-- closed on UPDATE; every advertised column of the same row - the surface the
-- ega_* tools actually update - remains writable, asserted with its permitted
-- twin in scripts/db/mcp-oauth-surface-verify.mjs per fenced table so a fence
-- that refused every write to such a row fails there rather than passing.
--
-- Up-only and idempotent: the single statement is a CREATE OR REPLACE, so
-- re-applying this file is a no-op in effect.

--> statement-breakpoint
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
        'estimate_minutes', 'project_id', 'goal_id', 'focus_rank',
        'archived_at', 'archived_by', 'updated_at'
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
        'status', 'next_step', 'health', 'updated_at'
      ];
    END IF;
  ELSIF p_table = 'projects' THEN
    IF private.has_active_mcp_permission('projects.update') THEN
      v_allowed := v_allowed || ARRAY[
        'status', 'updated_at'
      ];
    END IF;
  ELSIF p_table = 'task_sessions' THEN
    IF private.has_active_mcp_permission('timer.create') THEN
      v_allowed := v_allowed || ARRAY[
        'started_at', 'updated_at'
      ];
    END IF;
    IF private.has_active_mcp_permission('timer.update') THEN
      v_allowed := v_allowed || ARRAY[
        'ended_at', 'duration_seconds', 'updated_at'
      ];
    END IF;
  ELSIF p_table = 'task_reminders' THEN
    IF private.has_active_mcp_permission('tasks.update') THEN
      v_allowed := v_allowed || ARRAY[
        'remind_at', 'channel', 'delivery_mode', 'status', 'updated_at'
      ];
    END IF;
  END IF;

  RETURN v_allowed;
END $$;