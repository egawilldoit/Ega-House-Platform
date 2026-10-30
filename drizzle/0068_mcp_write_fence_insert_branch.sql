-- Fix the MCP write fence's INSERT branch for non-tasks tables.
--
-- 0064 attached one shared trigger function to five tables and guarded the
-- INSERT branch with a single condition:
--
--   IF TG_TABLE_NAME = 'tasks' AND (NEW.scheduled_start_at IS NOT NULL OR ...)
--
-- That does not work. plpgsql hands the whole condition to the SQL executor as
-- one expression, and the record field is resolved when the expression is
-- planned - `AND` does not make the field reference conditional. Any MCP insert
-- into task_sessions or task_reminders therefore failed with
-- `record "new" has no field "scheduled_start_at"`.
--
-- scripts/db/mcp-receipt-invariant-verify.mjs caught this: its DOMAIN-FENCE
-- section inserts into all five fenced tables as an MCP principal, which is
-- exactly the path a real ega_start_timer / ega_create_task_reminder call takes.
--
-- The fix is to nest the tests so the field reference is only ever planned for
-- a table that has it. The UPDATE branch is unaffected - it compares
-- to_jsonb(OLD) against to_jsonb(NEW) and reads no named column.

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
  v_old jsonb;
  v_new jsonb;
BEGIN
  v_allowed := private.mcp_writable_columns(TG_TABLE_NAME);
  IF v_allowed IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT coalesce(array_agg(changed_column.name ORDER BY changed_column.name), ARRAY[]::text[])
      INTO v_forbidden
      FROM jsonb_object_keys(v_new) AS changed_column(name)
     WHERE v_new -> changed_column.name IS DISTINCT FROM v_old -> changed_column.name;
    v_forbidden := ARRAY(
      SELECT unnest(v_forbidden)
      EXCEPT
      SELECT unnest(v_allowed)
    );
  ELSE
    -- INSERT. Column defaults are already applied at this point, so a column
    -- can only be *proved* caller-chosen by differing from its default. The
    -- never-writable group below is exactly the set whose defaults are stable.
    v_forbidden := ARRAY[]::text[];

    -- Nested on purpose: see the header comment. A combined
    -- `TG_TABLE_NAME = 'tasks' AND (NEW.scheduled_start_at ...)` condition is
    -- planned with the field reference included for every table.
    IF TG_TABLE_NAME = 'tasks' THEN
      IF NEW.scheduled_start_at IS NOT NULL
        OR NEW.scheduled_end_at IS NOT NULL
        OR NEW.calendar_event_id IS NOT NULL
        OR NEW.calendar_sync_status IS NOT NULL
        OR NEW.calendar_sync_failure_reason IS NOT NULL
        OR NEW.calendar_sync_enabled IS DISTINCT FROM false
        OR NEW.calendar_reminder_minutes IS DISTINCT FROM 10
      THEN
        v_forbidden := ARRAY[
          'scheduled_start_at', 'scheduled_end_at', 'calendar_sync_enabled',
          'calendar_reminder_minutes', 'calendar_event_id', 'calendar_sync_status',
          'calendar_sync_failure_reason'
        ];
      END IF;
    END IF;
  END IF;

  IF array_length(v_forbidden, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      'MCP write fence: an MCP OAuth principal may not modify % on public.%',
      array_to_string(v_forbidden, ', '), TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.enforce_mcp_write_fence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.enforce_mcp_write_fence() TO authenticated;
