-- Put the state predicates in the MCP write fence, next to the columns they
-- govern, so a replayed bearer cannot falsify execution evidence.
--
-- WHY THIS EXISTS. 0064 declares the threat model this wave is built on: the MCP
-- bearer goes straight to PostgREST, so the database fence is the last
-- boundary. The fence authorised COLUMNS. It never asked whether a write was a
-- legal TRANSITION, so three writes that no advertised tool performs were
-- accepted at the database for a `workspace_manager` MCP principal, with no MCP
-- tool involved:
--
--   UPDATE public.task_sessions
--      SET ended_at = now() - interval '9 hours', duration_seconds = 99999
--    WHERE id = <an ALREADY-CLOSED session>;
--   -- accepted. Friction Radar, workload and weekly review then read 27.7
--   -- tracked hours that were never worked.
--
--   UPDATE public.task_reminders
--      SET status = 'pending', remind_at = now() - interval '1 day'
--    WHERE id = <a CANCELLED reminder>;
--   -- accepted. This re-arms a cancelled reminder straight back into both
--   -- delivery indexes, which filter on status = 'pending'.
--
--   UPDATE public.tasks
--      SET archived_by = <another user's uuid>
--    WHERE id = <the caller's OWN task>;
--   -- accepted. The application always stamps archived_by from
--      actor.userId, so any other value is forged attribution.
--
-- The MCP tool paths were already guarded in TypeScript
-- (`finalizeOpenSession` filters `.is("ended_at", null)`; `cancelReminder` is a
-- status -> cancelled write; `setTaskArchived` derives archived_by from the
-- actor). That is exactly what the fence exists to cover: nothing above
-- PostgREST - not the tool schemas, not MCP_WRITES_ENABLED, not the Zod
-- `.strict()` objects - constrains a direct PATCH.
--
-- WHY THE PREDICATES BELOW ARE THE NARROWEST CORRECT ONES.
--
--   * task_sessions: the product invariant is that a session closes exactly
--     once. `finalizeOpenSession` already filters on ended_at IS NULL, so
--     refusing ended_at/duration_seconds once OLD.ended_at IS NOT NULL removes
--     no capability the advertised tool has. It is still true that a bearer
--     controls the CLOSING values themselves - that is inherent to a client that
--     starts its own timer and has no server clock to check against - but it can
--     no longer rewrite history after the fact.
--
--   * task_reminders: pending -> cancelled is the advertised transition, and
--     both delivery workers move pending -> processing -> sent/failed. No
--     legitimate writer moves a row back to pending, so refusing status/remind_at
--     once OLD.status is no longer pending closes the re-arm without touching
--     the cancel path or the delivery worker.
--
--   * tasks.archived_by: forced, not refused-and-reset. `setTaskArchived` writes
--      `archived_by = actor.userId`, and under 0072 a successful MCP write
--     already requires auth.uid() = owner_user_id, so the application's own
--     value always equals auth.uid() and the advertised archive keeps working.
--     Any other non-null value is by definition not the caller's, so it is
--     refused rather than silently rewritten: a silent rewrite would report
--     success for a write the caller did not get. NULL is left alone because
--     unarchive legitimately clears it.
--
-- Every predicate is paired with a permitted twin in
-- scripts/db/mcp-oauth-surface-verify.mjs, so a widened fence is visible as a
-- lost capability rather than only as a passing refusal.
--
-- The fence body below is 0080's, byte for byte, with these three predicates
-- added to the UPDATE branch.

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
    -- the caller. That trigger is also BEFORE UPDATE and sorts BEFORE this one
    -- alphabetically, so by the time the fence runs, completed_at has already been
    -- written by the trigger and looks like a caller modification. Without this
    -- exemption, completing or reopening a task through ega_update_task fails for
    -- every MCP principal with "may not modify completed_at".
    --
    -- The exemption is NOT "allow completed_at". normalize_task_completed_at uses
    -- COALESCE(NEW.completed_at, now()), so a caller-supplied value SURVIVES that
    -- trigger; allowing the column outright would reopen the back-dated completion
    -- hole that removing it from the allowlist closed. The capture trigger
    -- (private.capture_tasks_mcp_caller_completed_at) records per row whether the
    -- caller changed completed_at BEFORE the normalizer ran, and only a change the
    -- caller did not make is exempt.
    --
    -- Fail closed: an absent record is read as "the caller set it", so removing or
    -- renaming the capture trigger degrades to refusing rather than to permitting.
    IF TG_TABLE_NAME = 'tasks'
      AND 'completed_at' = ANY (v_forbidden)
      AND coalesce(current_setting('ega.mcp_caller_set_completed_at', true), 'true') = 'false'
    THEN
      v_forbidden := array_remove(v_forbidden, 'completed_at');
    END IF;

    -- Column authority answers "which columns", not "which transitions". Three
    -- refusals close the state edges an authorised column would otherwise let a
    -- replayed bearer rewrite; see the migration header for each.
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