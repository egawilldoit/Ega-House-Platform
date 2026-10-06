-- Stop the MCP write fence from erasing the completion instant its own normalizer
-- stamped, and refuse a caller-supplied completed_at at INSERT instead of
-- silently discarding it.
--
-- WHY THIS EXISTS. An advertised MCP capability was broken in a way no error
-- reported. `ega_create_task` with `status: "done"` inserted a row whose
-- completed_at was NULL, and it stayed NULL forever:
--
--   INSERT INTO public.tasks (project_id, title, status)
--   VALUES (..., 'done')   -- as a workspace_manager MCP principal
--   -> {"status":"done","completed_at":null}
--
-- while the identical INSERT from an ordinary owner session returned a real
-- timestamp. Migration 0063 owns the canonical invariant - completed_at is
-- non-null if and only if the status is a done spelling - so the MCP path
-- violated a documented product invariant and left the row permanently
-- "completed but never completed". Everything that reads completion evidence
-- inherits it: the Friction Radar, the workload snapshot, the weekly review.
--
-- ROOT CAUSE IS TRIGGER ORDER AGAIN, in the same place 0078 corrected for
-- UPDATE. On INSERT both BEFORE triggers on public.tasks still fire in
-- alphabetical order:
--
--   1. normalize_task_completed_at  (0063) - for a done status sets
--      NEW.completed_at := COALESCE(NEW.completed_at, now())
--   2. tasks_mcp_write_fence         (0064/0069/0071/0078) - and then, because
--      completed_at is not in the INSERT allowlist, reset it:
--
--        IF NOT ('completed_at' = ANY (v_allowed)) THEN NEW.completed_at := NULL;
--
-- The fence was comparing a trigger-written value against a caller-written
-- allowlist. The normalizer's own stamp was the thing being erased.
--
-- WHY A RESET IS ALSO WRONG HERE, AND WHY 42501 IS THE RIGHT ANSWER. 0078's
-- UPDATE path proves that COALESCE(caller_value, now()) IS the caller value, so
-- completed_at can never be allowed outright: a bearer could plant a
-- back-dated completion that the append-only task_status_events ledger records
-- as fact. On INSERT there is a second reason to refuse rather than reset: the
-- silent reset returns success-shaped data for a write the caller did not get.
-- `ega_create_task {status:"done"}` would then report a created task whose
-- completion instant the caller asked to choose and did not get. Raising keeps
-- the rule honest - the column is not the caller's to write, at either verb.
--
-- WHAT THIS ADDS.
--
--   * private.capture_tasks_mcp_caller_completed_at becomes BEFORE INSERT OR
--     UPDATE. It records, per row, whether the caller supplied completed_at at
--     all, before normalize_task_completed_at has touched it. On INSERT "the
--     caller supplied a value" is exactly "the value is not the column default",
--     and completed_at has no DEFAULT, so NULL means "not supplied".
--
--     The capture trigger stays NAMED to sort before normalize_task_completed_at.
--     That ordering is the mechanism being relied on; renaming it without
--     re-proving the order would silently restore the breakage.
--
--   * private.enforce_mcp_write_fence no longer resets completed_at on INSERT,
--     and raises 42501 when the capture record says the caller supplied it.
--     With no caller value the normalizer's stamp survives, which restores the
--     0063 invariant on the MCP path.
--
-- Fail closed: an absent capture record is read as "the caller supplied it", so
-- dropping or renaming the capture trigger degrades to refusing rather than to
-- permitting.
--
-- The fence body below is 0079's, byte for byte, with the INSERT completed_at
-- reset replaced by the refusal above. Carrying 0079's body whole is the point:
-- that migration also derives mcp_client_id inside this same function, and a
-- copy taken from any earlier revision would silently revert it.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.capture_tasks_mcp_caller_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- "Did the caller change completed_at?" is the question the fence cannot ask
  -- itself, because by the time it runs the normalizer has already overwritten
  -- the value it would need to compare against.
  --
  -- OLD does not exist on INSERT, so the two verbs are branched rather than
  -- combined: a single expression referencing OLD here raises "record old is
  -- not assigned yet" instead of evaluating. On INSERT "supplied" is exactly
  -- "not the column default", and completed_at has no DEFAULT, so a NULL
  -- NEW.completed_at means the caller named no value.
  IF TG_OP = 'INSERT' THEN
    PERFORM set_config(
      'ega.mcp_caller_set_completed_at',
      (NEW.completed_at IS NOT NULL)::text,
      true
    );
  ELSE
    PERFORM set_config(
      'ega.mcp_caller_set_completed_at',
      (NEW.completed_at IS DISTINCT FROM OLD.completed_at)::text,
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION private.capture_tasks_mcp_caller_completed_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.capture_tasks_mcp_caller_completed_at() FROM anon;

--> statement-breakpoint
DROP TRIGGER IF EXISTS capture_tasks_mcp_caller_completed_at ON public.tasks;
-- MUST sort before normalize_task_completed_at ('c' < 'n'): PostgreSQL fires
-- same-timing triggers in alphabetical order, and the fence must observe the
-- caller's value rather than the trigger's.
CREATE TRIGGER capture_tasks_mcp_caller_completed_at
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION private.capture_tasks_mcp_caller_completed_at();

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
