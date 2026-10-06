-- Make the UPDATE verb honour 0080's rule for tasks.completed_at: the column is
-- not the caller's to write, at either verb.
--
-- WHY THIS EXISTS. 0080 established the rule on the INSERT branch:
--
--   "Raising keeps the rule honest - the column is not the caller's to write,
--    at either verb."
--
-- The UPDATE verb did not implement it. 0080's INSERT refusal consults the
-- capture GUC POSITIVELY - `ega.mcp_caller_set_completed_at` = 'true' means the
-- caller supplied a value, so RAISE - while the UPDATE branch only consults it
-- NEGATIVELY, as the condition for a narrow exemption:
--
--   IF TG_TABLE_NAME = 'tasks'
--     AND 'completed_at' = ANY (v_forbidden)
--     AND coalesce(current_setting('ega.mcp_caller_set_completed_at', true), 'true') = 'false'
--   THEN
--     v_forbidden := array_remove(v_forbidden, 'completed_at');
--   END IF;
--
-- That asymmetry is the defect. The exemption is a no-op whenever the caller's
-- value is GONE by the time the fence runs, because v_forbidden is built only
-- from columns whose value actually CHANGED:
--
--   SELECT ... FROM jsonb_object_keys(v_new) AS c(name)
--    WHERE v_new -> c.name IS DISTINCT FROM v_old -> c.name;
--
-- and normalize_task_completed_at (0063) assigns NEW.completed_at
-- unconditionally on UPDATE - COALESCE(NEW.completed_at, now()) when entering
-- done, OLD.completed_at when already done, NULL for any non-done status. So
-- when the caller supplies completed_at alone, the normalizer has already
-- replaced it and completed_at never enters v_forbidden at all. The exemption
-- had nothing to exempt, and nothing refused.
--
-- MEASURED on 0081 with executed SQL, as a workspace_manager MCP principal.
-- Both statements returned rows=1 and reported success:
--
--   -- (a) status already 'done':
--   UPDATE public.tasks SET completed_at = '1999-01-01T00:00:00Z'::timestamptz
--    WHERE id = <the probe> RETURNING id, status, completed_at;
--   -> {"id":"...","status":"done","completed_at":"2026-10-06T02:39:36.293Z"}
--   -- superuser read-back: the stored value is the trigger's stamp, unchanged.
--
--   -- (b) status 'todo':
--   UPDATE public.tasks SET completed_at = '1999-01-01T00:00:00Z'::timestamptz
--    WHERE id = <the probe> RETURNING id, status, completed_at;
--   -> {"id":"...","status":"todo","completed_at":null}
--
-- That is the shape AGENTS.md forbids and 0080's own header names: "the silent
-- reset returns success-shaped data for a write the caller did not get". The
-- UPDATE verb did exactly what the INSERT verb was changed to stop doing, and a
-- caller that set the completion instant got a success it did not earn. The same
-- statement naming BOTH status and completed_at was already refused 42501,
-- because there the normalizer's COALESCE preserves the caller's value long
-- enough for v_forbidden to see it - which is why one caller-visible behaviour
-- and its sibling could not both be right.
--
-- WHAT THIS ADDS. The UPDATE branch consults the capture record POSITIVELY, the
-- same way the INSERT branch already does: if the capture record says the caller
-- supplied completed_at, refuse, regardless of whether the normalizer has
-- already replaced the value. The existing `= 'false'` exemption path is left
-- byte for byte as it was - it is the honest transition's only route through,
-- and `ega_update_task {status:"done"}` and `{status:"todo"}` both depend on it.
--
-- WHY THE EXEMPTION IS STILL NEEDED AND NOT REDUNDANT. Nothing here allows
-- completed_at. The capture trigger records
-- `(NEW.completed_at IS DISTINCT FROM OLD.completed_at)` BEFORE the normalizer
-- runs, so an honest transition records 'false': the caller named no value, and
-- the only completed_at the fence will ever see on such a statement is the
-- normalizer's own stamp. That is the difference 0078 established and this
-- migration does not touch.
--
-- FAIL CLOSED, and the degradation it buys. The absent-record default stays
-- 'true' (the caller supplied it), so a positive check refuses. That is the same
-- direction 0080 and 0078 both document: removing or renaming the capture
-- trigger degrades to refusing rather than to permitting. Before this migration
-- the degradation was only visible on a transition that moved completed_at; it
-- is now visible on every UPDATE of public.tasks by an MCP principal, because
-- with no capture record the fence can no longer tell an honest stamp from a
-- caller value at all. That is the intended reading of the documented rule, and
-- journal-order-verify.mjs's 0077 boundary asserts the capture trigger exists.
--
-- NO ADVERTISED TOOL SENDS THE COLUMN ON UPDATE. Grepped at this revision:
-- packages/data-access/src/tasks/repository.ts reads completed_at in TASK_SELECT
-- and maps it to completedAt on the way out; no write payload in
-- apps/web/src/lib/mcp/write/ or in the repository sets it, and 0019's column has
-- no default and no application UPDATE carries it. ega_update_task's advertised
-- columns are unaffected, and the paired permitted twin in
-- scripts/db/mcp-oauth-surface-verify.mjs asserts the title-only UPDATE on the
-- SAME already-done row still succeeds, so a fence that refused every UPDATE on
-- a done task fails there rather than passing.
--
-- The fence body below is 0081's, byte for byte, with this one check inserted
-- ahead of the completed_at exemption. Carrying 0081's body whole is the point:
-- that migration carries 0080's reserved INSERT completed_at AND 0079's
-- mcp_client_id derivation, and a copy taken from any earlier revision would
-- silently revert both - the hazard 0080 and 0081 each document and which has
-- already bitten this branch once.

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
  v_actual text[];
  v_verified_client_id text;
BEGIN
  v_allowed := private.mcp_writable_columns(TG_TABLE_NAME);
  IF v_allowed IS NULL THEN
    RETURN NEW;
  END IF;

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

    -- completed_at on public.tasks is owned by normalize_task_completed_at, not by
    -- the caller - 0080's rule, and the INSERT branch above enforces it here.
    -- This UPDATE branch enforces the same rule, and it has to ask the capture
    -- record POSITIVELY to do it. Asking negatively (as this branch did through
    -- 0081: exempt the column only when the record says the caller supplied
    -- nothing) cannot work, because v_forbidden is built from columns whose
    -- value CHANGED and the normalizer has already erased the caller's value by
    -- the time this trigger runs: on an already-done row it assigns
    -- NEW.completed_at := OLD.completed_at, and on a non-done row NULL. So a
    -- statement setting completed_at alone changed nothing by the fence's own
    -- measure, completed_at never entered v_forbidden, the exemption had nothing
    -- to exempt, and the statement returned success-shaped data for a write the
    -- caller did not get - measured on 0081 for both an already-done and a 'todo'
    -- row, while naming status in the same statement was refused 42501.
    --
    -- The capture record is the only witness: the capture trigger
    -- (private.capture_tasks_mcp_caller_completed_at) runs BEFORE
    -- normalize_task_completed_at and records
    -- (NEW.completed_at IS DISTINCT FROM OLD.completed_at), so 'true' is exactly
    -- "the caller supplied completed_at" as the caller's statement was written,
    -- and nothing downstream can take that away.
    --
    -- Fail closed: an absent record is read as "the caller supplied it", so
    -- removing or renaming the capture trigger degrades to refusing rather than
    -- to permitting.
    IF TG_TABLE_NAME = 'tasks'
      AND coalesce(current_setting('ega.mcp_caller_set_completed_at', true), 'true') = 'true'
    THEN
      RAISE EXCEPTION
        'MCP write fence: an MCP OAuth principal may not supply completed_at on public.tasks'
        USING ERRCODE = '42501';
    END IF;

    -- The exemption below is unchanged and is still load-bearing: it is the only
    -- route an honest transition takes through this column, and both advertised
    -- status transitions depend on it. completed_at is NOT allowed - a
    -- caller-supplied value SURVIVES normalize_task_completed_at's
    -- COALESCE(caller_value, now()), which is why the back-dated completion
    -- 0071 closed must stay closed.
    IF TG_TABLE_NAME = 'tasks'
      AND 'completed_at' = ANY (v_forbidden)
      AND coalesce(current_setting('ega.mcp_caller_set_completed_at', true), 'true') = 'false'
    THEN
      v_forbidden := array_remove(v_forbidden, 'completed_at');
    END IF;

    -- Column authority answers "which columns", not "which transitions". Three
    -- refusals close the state edges an authorised column would otherwise let a
    -- replayed bearer rewrite; see the migration header for each.
    --
    -- The prior row is read through v_old (to_jsonb(OLD)) rather than OLD.<field>.
    -- This one function is attached to five tables, and PL/pgSQL prepares a
    -- statement against the relation the trigger fired on: naming a column that
    -- does not exist on that relation raises 42703 while preparing, before the
    -- TG_TABLE_NAME guard can short-circuit. The jsonb projection of OLD is
    -- relation-independent, and (->> text) yields SQL NULL for a JSON null, so
    -- "ended_at IS NOT NULL" reads exactly as it would on the record.
    IF TG_TABLE_NAME = 'task_sessions'
      AND (v_old ->> 'ended_at') IS NOT NULL
      AND ('ended_at' = ANY (v_forbidden) OR 'duration_seconds' = ANY (v_forbidden))
    THEN
      RAISE EXCEPTION
        'MCP write fence: an MCP OAuth principal may not rewrite the recorded end of a closed task_sessions row on public.task_sessions'
        USING ERRCODE = '42501';
    END IF;

    IF TG_TABLE_NAME = 'task_reminders'
      AND (v_old ->> 'status') IS DISTINCT FROM 'pending'
      AND ('status' = ANY (v_forbidden) OR 'remind_at' = ANY (v_forbidden))
    THEN
      RAISE EXCEPTION
        'MCP write fence: an MCP OAuth principal may not re-arm a task_reminders row that is no longer pending on public.task_reminders'
        USING ERRCODE = '42501';
    END IF;

    -- A NULL archived_by is legitimate and is what unarchive writes, so only a
    -- non-NULL attribution is judged: when one is supplied it must be the
    -- authenticated caller. (->> yields SQL NULL for a JSON null, which is what
    -- makes that distinction expressible here.)
    IF TG_TABLE_NAME = 'tasks'
      AND 'archived_by' = ANY (v_forbidden)
      AND (v_new ->> 'archived_by') IS NOT NULL
      AND (v_new ->> 'archived_by') IS DISTINCT FROM auth.uid()::text
    THEN
      RAISE EXCEPTION
        'MCP write fence: an MCP OAuth principal may not attribute an archive on public.tasks to another user'
        USING ERRCODE = '42501';
    END IF;

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
    v_new := to_jsonb(NEW);
    v_allowed := private.mcp_insertable_columns(TG_TABLE_NAME);

    -- mcp_client_id is the caller's verified OAuth client identity, not a key the
    -- caller chooses, and every application read-back / replay lookup keys on
    -- (mcp_client_id, mcp_operation_id). An owner holding two grants could
    -- otherwise stamp a row as the other client and have that client's replay
    -- return it as its own operation result, which is the key 0074 exists to
    -- fence. Derive it from the verified token instead of trusting the payload.
    --
    -- Only a SUPPLIED value is corrected. A NULL stays NULL, so 0074's
    -- both-or-neither pairing constraint still refuses an operation-id-only
    -- INSERT with 23514, and a caller that sends neither half stores neither.
    -- Fail closed: an absent or empty client_id claim cannot happen on this branch
    -- (mcp_insertable_columns already returned NULL without one, and the enclosing
    -- branch is only reached when v_allowed is not NULL), and if it somehow did,
    -- NULLIF leaves the column NULL rather than writing a forged value.
    IF 'mcp_client_id' = ANY (v_allowed) THEN
      v_verified_client_id := NULLIF(coalesce((SELECT auth.jwt()) ->> 'client_id', ''), '');
      IF v_verified_client_id IS NOT NULL
        AND NEW.mcp_client_id IS NOT NULL
        AND NEW.mcp_client_id IS DISTINCT FROM v_verified_client_id
      THEN
        NEW.mcp_client_id := v_verified_client_id;
      END IF;
    END IF;

    -- completed_at is the one INSERT column that is RESERVED rather than
    -- resettable. Resetting it is what silently produced a completed task with
    -- no completion instant; allowing it would let a bearer back-date the
    -- completion the ledger then records as fact. Refusing keeps both true: the
    -- caller learns the column is not theirs, and normalize_task_completed_at's
    -- stamp for a done status survives untouched.
    IF TG_TABLE_NAME = 'tasks'
      AND coalesce(current_setting('ega.mcp_caller_set_completed_at', true), 'true') = 'true'
    THEN
      RAISE EXCEPTION
        'MCP write fence: an MCP OAuth principal may not supply completed_at on public.tasks'
        USING ERRCODE = '42501';
    END IF;

    IF TG_TABLE_NAME = 'tasks' THEN
      IF NOT ('id' = ANY (v_allowed)) THEN NEW.id := gen_random_uuid(); END IF;
      IF NOT ('created_at' = ANY (v_allowed)) THEN NEW.created_at := now(); END IF;
      IF NOT ('updated_at' = ANY (v_allowed)) THEN NEW.updated_at := now(); END IF;
      IF NOT ('archived_at' = ANY (v_allowed)) THEN NEW.archived_at := NULL; END IF;
      IF NOT ('archived_by' = ANY (v_allowed)) THEN NEW.archived_by := NULL; END IF;
      IF NOT ('focus_rank' = ANY (v_allowed)) THEN NEW.focus_rank := NULL; END IF;
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
      IF NOT ('status' = ANY (v_allowed)) THEN NEW.status := 'draft'; END IF;
      IF NOT ('health' = ANY (v_allowed)) THEN NEW.health := NULL; END IF;
      IF NOT ('next_step' = ANY (v_allowed)) THEN NEW.next_step := NULL; END IF;
    ELSIF TG_TABLE_NAME = 'projects' THEN
      IF NOT ('id' = ANY (v_allowed)) THEN NEW.id := gen_random_uuid(); END IF;
      IF NOT ('created_at' = ANY (v_allowed)) THEN NEW.created_at := now(); END IF;
      IF NOT ('updated_at' = ANY (v_allowed)) THEN NEW.updated_at := now(); END IF;
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