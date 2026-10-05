-- Require the MCP operation identity to be complete, so the 0059 unique
-- fences actually fence.
--
-- WHY THIS EXISTS. 0059's fence is a partial unique index over three
-- nullable columns:
--
--   CREATE UNIQUE INDEX <table>_mcp_operation_unique
--     ON <table> (owner_user_id, mcp_client_id, mcp_operation_id)
--     WHERE mcp_operation_id IS NOT NULL;
--
-- Its stated contract is "second insert with the same (owner, client,
-- operation) hits 23505". That contract only holds when every key column is
-- non-NULL, because a btree unique index treats NULLs as distinct. Nothing in
-- the schema made that true. mcp_client_id was added as a bare nullable
-- `text` column with no NOT NULL, no default and no pairing constraint, so a
-- row could carry mcp_operation_id while mcp_client_id stayed NULL, and then
-- the index entry had a NULL key and matched nothing.
--
-- PROVEN on the migration journal at 0072:
--
--   INSERT INTO public.projects (id, name, slug, owner_user_id,
--                                 mcp_operation_id)
--   VALUES (..., '22222222-...-222222222222', 'bbbbbbbb-...-000000000001');
--   -- same statement again with a different id and slug: also succeeds
--   SELECT count(*) FROM public.projects
--    WHERE mcp_operation_id = 'bbbbbbbb-...-000000000001';
--   -- 2
--
-- Two durable rows, one operation id, no violation. The 0059 fence was inert
-- for that row, and so was the application replay mapping that depends on it:
-- every replay lookup filters on mcp_client_id = <client>, which can never
-- match a NULL client, so the duplicate is not resolved as a replay either -
-- it is reported as a fresh create.
--
-- This is reachable with shipped credentials, not only by hand-written SQL.
-- 0069 puts both columns in private.mcp_insertable_columns() for every fenced
-- table, so any MCP bearer holding the matching create permission can write
-- them directly and independently through the same INSERT the fence governs.
--
-- WHAT THIS DOES. One CHECK per fenced table requiring the identity to be
-- both-present or both-absent. Every non-NULL mcp_operation_id now implies a
-- non-NULL mcp_client_id, so the index key is never partially NULL and the
-- 0059 fence holds for every row it indexes. Partial-identity INSERTs and
-- UPDATEs fail closed with SQLSTATE 23514.
--
-- The constraint is added NOT VALID deliberately. Every write is checked from
-- the moment this migration applies, and NOT VALID avoids refusing to apply
-- against rows that predate the proof above. Rows that already violate the
-- pairing are left alone rather than rewritten, because this migration must not
-- modify or delete domain data. Operator pre-flight before relying on it to
-- describe historical rows:
--
--   SELECT 'projects' AS table_name, id FROM public.projects
--    WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)
--   UNION ALL
--   SELECT 'goals', id FROM public.goals
--    WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)
--   UNION ALL
--   SELECT 'tasks', id FROM public.tasks
--    WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)
--   UNION ALL
--   SELECT 'task_reminders', id FROM public.task_reminders
--    WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL)
--   UNION ALL
--   SELECT 'task_sessions', id FROM public.task_sessions
--    WHERE (mcp_operation_id IS NULL) <> (mcp_client_id IS NULL);
--
-- Up-only, additive, and idempotent: each statement drops the constraint by
-- name before re-adding it, so re-applying this file is a no-op in effect.
--
-- Compatibility. Every application writer already emits both columns or
-- neither - private.mcpOperationIdentity() in
-- packages/data-access/src/supabase/errors.ts returns null unless BOTH are
-- present, and the application services gate on the same pair - so no
-- shipped write path changes behaviour.

--> statement-breakpoint
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_mcp_operation_identity_pair;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_mcp_operation_identity_pair
  CHECK ((mcp_operation_id IS NULL) = (mcp_client_id IS NULL)) NOT VALID;

--> statement-breakpoint
ALTER TABLE public.goals
  DROP CONSTRAINT IF EXISTS goals_mcp_operation_identity_pair;
ALTER TABLE public.goals
  ADD CONSTRAINT goals_mcp_operation_identity_pair
  CHECK ((mcp_operation_id IS NULL) = (mcp_client_id IS NULL)) NOT VALID;

--> statement-breakpoint
ALTER TABLE public.tasks
  DROP CONSTRAINT IF EXISTS tasks_mcp_operation_identity_pair;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_mcp_operation_identity_pair
  CHECK ((mcp_operation_id IS NULL) = (mcp_client_id IS NULL)) NOT VALID;

--> statement-breakpoint
ALTER TABLE public.task_reminders
  DROP CONSTRAINT IF EXISTS task_reminders_mcp_operation_identity_pair;
ALTER TABLE public.task_reminders
  ADD CONSTRAINT task_reminders_mcp_operation_identity_pair
  CHECK ((mcp_operation_id IS NULL) = (mcp_client_id IS NULL)) NOT VALID;

--> statement-breakpoint
ALTER TABLE public.task_sessions
  DROP CONSTRAINT IF EXISTS task_sessions_mcp_operation_identity_pair;
ALTER TABLE public.task_sessions
  ADD CONSTRAINT task_sessions_mcp_operation_identity_pair
  CHECK ((mcp_operation_id IS NULL) = (mcp_client_id IS NULL)) NOT VALID;