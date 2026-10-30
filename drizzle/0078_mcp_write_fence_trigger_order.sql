-- Stop the MCP write fence from refusing the transition its own trigger made.
--
-- WHY THIS EXISTS. An advertised MCP capability was completely broken:
-- ega_update_task with status "done" - completing a task, and equally reopening
-- one - failed for EVERY MCP principal on a database migrated through the
-- journal, with no pre-existing data and nothing upgrade-specific:
--
--   ERROR:  MCP write fence: an MCP OAuth principal may not modify
--           completed_at on public.tasks
--
-- A plain title change on the same row succeeded, so the capability worked for
-- every field except the one that completes the task.
--
-- ROOT CAUSE IS TRIGGER ORDER, not the allowlist. Two BEFORE UPDATE triggers on
-- public.tasks fire in alphabetical order by name:
--
--   1. normalize_task_completed_at  (0063) - on a done transition sets
--      NEW.completed_at := COALESCE(NEW.completed_at, now())
--   2. tasks_mcp_write_fence         (0064/0071) - compares OLD against NEW and
--      refuses any column outside the permission-derived allowlist
--
-- 0071 deliberately removed completed_at from that allowlist because a trigger
-- owns the column and an explicit data-access test asserts no repository payload
-- ever sets it. Correct in isolation. But the fence runs second, so it observes a
-- completed_at the trigger has just written and reports it as caller-supplied. The
-- trigger's own write is refused.
--
-- WHY THE OBVIOUS FIX IS WRONG. Allowing completed_at on UPDATE would reopen the
-- hole 0071 closed: COALESCE(NEW.completed_at, now()) preserves a caller-supplied
-- value, so a bearer could plant a back-dated completion that the append-only
-- task_status_events ledger then records as fact. Recomputing the trigger's
-- expected value inside the fence does not help either, because
-- COALESCE(caller_value, now()) IS the caller value. The only thing that
-- separates an honest transition from a forged timestamp is what the caller
-- actually sent, and that is gone by the time the fence runs.
--
-- WHAT THIS ADDS. private.capture_tasks_mcp_caller_completed_at records, per row
-- and per statement, whether the caller changed completed_at AT ALL - before
-- normalize_task_completed_at has touched it. The fence then exempts a change to
-- completed_at only when that record says the caller supplied nothing.
--
-- The capture trigger is NAMED to sort before normalize_task_completed_at,
-- because PostgreSQL orders same-timing triggers alphabetically and that ordering
-- is the mechanism being corrected. Renaming it without re-proving the order would
-- silently restore the breakage.
--
-- No other fenced table is affected: normalize_task_completed_at is the only
-- trigger outside private.enforce_mcp_write_fence on projects, goals, tasks,
-- task_sessions and task_reminders, and the only one that mutates a row.
--
-- The fence body below is 0071's, byte for byte, with one exemption inserted.

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
  PERFORM set_config(
    'ega.mcp_caller_set_completed_at',
    (NEW.completed_at IS DISTINCT FROM OLD.completed_at)::text,
    true
  );
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
  BEFORE UPDATE ON public.tasks
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
