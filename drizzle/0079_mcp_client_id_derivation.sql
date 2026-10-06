-- Stop the MCP write fence from accepting a caller-chosen operation identity.
--
-- WHY THIS EXISTS. 0071 put `mcp_client_id` in both
-- private.mcp_writable_columns() and private.mcp_insertable_columns() beside
-- `mcp_operation_id`, on the reasoning that the application writes both on every
-- operationId-carrying mutation (0059) and that forging them is self-limiting
-- because the unique fence is keyed on (owner_user_id, mcp_client_id,
-- mcp_operation_id) and a collision can only fail the principal's own row.
--
-- That reasoning conflated two different things. `mcp_operation_id` IS a
-- caller-chosen idempotency key, and choosing one is the point. `mcp_client_id`
-- is not a key at all - it is the caller's verified OAuth client identity - and
-- every read-back and replay lookup in the application filters on the pair:
--
--   .eq("mcp_client_id", identity.mcpClientId).eq("mcp_operation_id", ...)
--
-- An owner legitimately holds SEVERAL grants (v1-workspace-client and
-- v2-workspace-client in the shipped fixtures). So with the v1 bearer:
--
--   INSERT INTO public.projects (owner_user_id, name, slug,
--                                 mcp_client_id, mcp_operation_id)
--   VALUES (..., 'v2-workspace-client', 'aaaa...');
--
-- MEASURED on this journal before the fix, as a real MCP principal:
--
--   -- persisted: { mcp_client_id: 'v2-workspace-client', … }
--   -- then, in a session carrying client_id = 'v2-workspace-client':
--   SELECT id FROM public.projects
--    WHERE mcp_client_id = 'v2-workspace-client' AND mcp_operation_id = 'aaaa...';
--   -- 1 row, belonging to the other client
--
-- The v2 integration's replay/read-back then returns the attacker's row as its
-- own operation result. That is a hole in exactly the key 0074 exists to fence:
-- the identity was accepted from the caller rather than derived from the
-- verified JWT, so the fence was keyed on a value the writer chose.
--
-- WHAT THIS CHANGES, and why only these two things.
--
-- 1. On INSERT the fence DERIVES mcp_client_id from auth.jwt()->>'client_id'.
--    The column stays authorisable, because the application genuinely sends it
--    and 0074's both-or-neither pairing needs the caller to be able to supply
--    the pair at all; the value is simply no longer the caller's to choose. Only
--    a SUPPLIED value is overwritten: a NULL stays NULL, so
--    <table>_mcp_operation_identity_pair still refuses an operation-id-only
--    INSERT with 23514 exactly as it does today, and a caller that sends neither
--    half still stores neither.
--
-- 2. mcp_client_id leaves private.mcp_writable_columns(), so an UPDATE cannot
--    change it on an existing row. No advertised tool does: every mcpClientId
--    write in the application is on a create path
--    (apps/web/src/lib/mcp/write/tasks.ts createTask + createTaskReminder,
--    write/projects.ts createProject, write/goals.ts createGoal, write/timer.ts
--    startTimer), and every repository consumer builds the pair through
--    mcpOperationIdentity() inside an INSERT
--    (packages/data-access/src/{tasks,projects,goals,timer}/repository.ts).
--    Grepped at this revision; there is no UPDATE payload carrying either
--    identity column.
--
-- `mcp_operation_id` deliberately STAYS authorisable on UPDATE. With
-- mcp_client_id now frozen to the verified client at INSERT, the only value a
-- writer can put there is their own operation key on their own row, which is the
-- application-written behaviour 0059 established. Removing it would be a second,
-- separate claim change with no defect behind it.
--
-- THE PAIRING CONSTRAINT FROM 0074 IS UNAFFECTED. Both branches still require
-- both-or-neither, and the derivation never manufactures the second half: it
-- replaces a supplied client id with the caller's own, so a partial identity is
-- still partial. An UPDATE setting only mcp_operation_id on a NULL/NULL row
-- remains refused with 23514.
--
-- Compatibility. Every shipped application write already sends the caller's own
-- oauthClientId (principal.oauthClientId from the verified token), so the
-- derivation is a no-op on every legitimate path; a direct-user session is not
-- affected at all, because both allowlists return NULL without a client_id claim
-- and the fence returns NEW untouched.
--
-- Up-only and idempotent: both statements are CREATE OR REPLACE, so re-applying
-- this file is a no-op in effect.

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
        'archived_at', 'archived_by', 'updated_at', 'mcp_operation_id'
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
        'status', 'next_step', 'health', 'updated_at', 'mcp_operation_id'
      ];
    END IF;
  ELSIF p_table = 'projects' THEN
    IF private.has_active_mcp_permission('projects.update') THEN
      v_allowed := v_allowed || ARRAY[
        'status', 'updated_at', 'mcp_operation_id'
      ];
    END IF;
  ELSIF p_table = 'task_sessions' THEN
    IF private.has_active_mcp_permission('timer.create') THEN
      v_allowed := v_allowed || ARRAY[
        'started_at', 'updated_at', 'mcp_operation_id'
      ];
    END IF;
    IF private.has_active_mcp_permission('timer.update') THEN
      v_allowed := v_allowed || ARRAY[
        'ended_at', 'duration_seconds', 'updated_at', 'mcp_operation_id'
      ];
    END IF;
  ELSIF p_table = 'task_reminders' THEN
    IF private.has_active_mcp_permission('tasks.update') THEN
      v_allowed := v_allowed || ARRAY[
        'remind_at', 'channel', 'delivery_mode', 'status', 'updated_at',
        'mcp_operation_id'
      ];
    END IF;
  END IF;

  RETURN v_allowed;
END $$;

--> statement-breakpoint
-- The fence body below is 0078's, byte for byte, with one derivation inserted in
-- the INSERT branch. The UPDATE branch is unchanged: mcp_client_id is no longer
-- in the allowlist the branch consults, which is what closes the re-stamp
-- direction, so no edit there is needed and none is made.
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

    IF TG_TABLE_NAME = 'tasks' THEN
      IF NOT ('id' = ANY (v_allowed)) THEN NEW.id := gen_random_uuid(); END IF;
      IF NOT ('created_at' = ANY (v_allowed)) THEN NEW.created_at := now(); END IF;
      IF NOT ('updated_at' = ANY (v_allowed)) THEN NEW.updated_at := now(); END IF;
      IF NOT ('archived_at' = ANY (v_allowed)) THEN NEW.archived_at := NULL; END IF;
      IF NOT ('archived_by' = ANY (v_allowed)) THEN NEW.archived_by := NULL; END IF;
      IF NOT ('focus_rank' = ANY (v_allowed)) THEN NEW.focus_rank := NULL; END IF;
      IF NOT ('completed_at' = ANY (v_allowed)) THEN NEW.completed_at := NULL; END IF;
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
