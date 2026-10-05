-- Make the MCP rate limit non-bypassable, close the surviving reminder DELETE,
-- and finish classifying the INSERT surface.
--
-- WHY THE RATE LIMIT CHANGED SHAPE. An independent security review found that
-- `p_window_seconds` was a caller-supplied argument and that the counter's
-- conflict handler treated a window mismatch as a fresh bucket:
--
--   ON CONFLICT (owner_user_id, oauth_client_id, tool_name)
--   DO UPDATE SET request_count = CASE
--     WHEN rate_window.window_started_at = EXCLUDED.window_started_at
--       THEN rate_window.request_count + 1
--     ELSE 1                       -- caller-chosen alignment zeroes the counter
--
-- An MCP bearer holds the same credential the limiter is protecting, so one
-- extra RPC call with a different window length reset the counter and restored
-- the full allowance - measured on the live database as call #121 refused,
-- then a single attacker call, then call #122 allowed against a 120/min limit.
-- `p_limit` was caller-controlled for the same reason and was the larger
-- problem: passing 10000 disabled the limit outright.
--
-- The limiter's parameters are policy, so they are no longer arguments. The
-- signature takes a window NAME only; the allowance is derived server-side from
-- that name. The per-tool limit is unchanged at 120/60s, and the aggregate
-- buckets now carry real server-side thresholds instead of being opt-in
-- configuration that a typo silently disabled.
--
-- These thresholds are a starting position, not a ratified quota, and are
-- recorded in ARCHITECTURE.md as such.
--
-- WHY THE REMINDER DELETE IS DROPPED. 0051 created
-- task_reminders_mcp_delete_access and this wave never removed it. It is the
-- only surviving MCP write outside the five fenced tables, and DELETE bypasses
-- the column fence entirely because the fence is BEFORE INSERT OR UPDATE. So an
-- MCP bearer could destroy a pending reminder outright - a more complete
-- suppression of a user-facing notification than anything 0069 closed - using
-- an operation with no schema, no handler and no audit identity.
-- ega_cancel_task_reminder already performs the legitimate cancellation as an
-- UPDATE, so nothing depends on the DELETE.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.consume_mcp_rate_limit(
  p_window_name text
)
RETURNS TABLE (
  allowed boolean,
  retry_after_seconds integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_client_id text;
  v_resource_uri text;
  v_now timestamptz;
  v_window timestamptz;
  v_count integer;
  v_limit integer;
  v_window_seconds constant integer := 60;
  v_grant_exists boolean;
BEGIN
  v_user_id := auth.uid();
  v_client_id := NULLIF(auth.jwt() ->> 'client_id', '');
  v_resource_uri := NULLIF(auth.jwt() ->> 'aud', '');

  IF v_user_id IS NULL
    OR v_client_id IS NULL
    OR v_resource_uri IS NULL THEN
    RAISE EXCEPTION 'MCP authentication context is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_window_name IS NULL OR p_window_name !~ '^[a-z0-9_]{1,128}$' THEN
    RAISE EXCEPTION 'Invalid MCP rate-limit window name.' USING ERRCODE = '22023';
  END IF;

  -- Allowance is derived here, never supplied. The aggregate prefixes are
  -- reserved and asserted collision-free against the capability registry by
  -- apps/web/src/lib/mcp/capability-registry-migration.test.ts.
  v_limit := CASE
    WHEN p_window_name = 'ega_aggregate_read' THEN 600
    WHEN p_window_name = 'ega_aggregate_write' THEN 300
    WHEN p_window_name = 'ega_aggregate_sensitive_write' THEN 60
    ELSE 120
  END;

  SELECT EXISTS (
    SELECT 1
    FROM public.mcp_authorization_grants AS grant_record
    WHERE grant_record.owner_user_id = v_user_id
      AND grant_record.oauth_client_id = v_client_id
      AND grant_record.resource_uri = v_resource_uri
      AND grant_record.status = 'active'
      AND grant_record.revoked_at IS NULL
  ) INTO v_grant_exists;

  IF NOT v_grant_exists THEN
    RAISE EXCEPTION 'No active EGA MCP authorization grant.'
      USING ERRCODE = '42501';
  END IF;

  v_now := clock_timestamp();
  v_window := to_timestamp(
    floor(extract(epoch FROM v_now) / v_window_seconds)
    * v_window_seconds
  );

  INSERT INTO public.mcp_rate_limit_windows AS rate_window (
    owner_user_id,
    oauth_client_id,
    tool_name,
    window_started_at,
    request_count,
    updated_at
  ) VALUES (
    v_user_id,
    v_client_id,
    p_window_name,
    v_window,
    1,
    v_now
  )
  ON CONFLICT (owner_user_id, oauth_client_id, tool_name)
  DO UPDATE SET
    window_started_at = EXCLUDED.window_started_at,
    request_count = CASE
      WHEN rate_window.window_started_at = EXCLUDED.window_started_at
        THEN rate_window.request_count + 1
      ELSE 1
    END,
    updated_at = v_now
  RETURNING request_count INTO v_count;

  allowed := v_count <= v_limit;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE GREATEST(
      1,
      CEIL(
        EXTRACT(EPOCH FROM (v_window + make_interval(secs => v_window_seconds) - v_now))
      )::integer
    )
  END;

  RETURN NEXT;
END;
$$;

--> statement-breakpoint
-- Drop the superseded signature explicitly. CREATE OR REPLACE with a different
-- argument list would have left BOTH overloads callable, so the
-- caller-controlled p_limit / p_window_seconds path would have survived the
-- migration as a live overload. A migration proof asserts this overload is gone
-- and that the surviving function takes one argument.
DROP FUNCTION IF EXISTS public.consume_mcp_rate_limit(text, integer, integer);

--> statement-breakpoint
DROP POLICY IF EXISTS "task_reminders_mcp_delete_access" ON public.task_reminders;

--> statement-breakpoint
-- completed_at is owned by the normalize_task_completed_at trigger (0063) and is
-- deliberately absent from every repository update payload - there is an
-- explicit data-access test asserting the shared write seam never sets it.
-- Leaving it authorisable let an MCP bearer plant a back-dated completion that
-- the append-only task_status_events ledger then recorded as fact, which is the
-- heatmap's completion source of truth.
--
-- ended_at / duration_seconds / archived_by remain authorisable: the
-- application writes them from the actor and the clock, not from caller input
-- (timer/service.ts, tasks/repository.ts archiveTask). They are application-
-- written columns in the same sense as mcp_operation_id.
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
        'archived_at', 'archived_by', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
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
        'status', 'next_step', 'health', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'projects' THEN
    IF private.has_active_mcp_permission('projects.update') THEN
      v_allowed := v_allowed || ARRAY[
        'status', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'task_sessions' THEN
    IF private.has_active_mcp_permission('timer.create') THEN
      v_allowed := v_allowed || ARRAY[
        'started_at', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
    IF private.has_active_mcp_permission('timer.update') THEN
      v_allowed := v_allowed || ARRAY[
        'ended_at', 'duration_seconds', 'updated_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'task_reminders' THEN
    IF private.has_active_mcp_permission('tasks.update') THEN
      v_allowed := v_allowed || ARRAY[
        'remind_at', 'channel', 'delivery_mode', 'status', 'updated_at',
        'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  END IF;

  RETURN v_allowed;
END $$;

--> statement-breakpoint
-- The goals and projects branches were declared but left empty, so the function
-- claimed to be the authority for what may be set at INSERT while the operative
-- control was the forced-default block alone. For goals that meant status,
-- health and next_step - all goals.update columns - survived an INSERT from a
-- goals.create-only grant. Populated now so the declared authority and the
-- enforced behaviour agree.
CREATE OR REPLACE FUNCTION private.mcp_insertable_columns(p_table text)
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
    IF private.has_active_mcp_permission('tasks.create') THEN
      v_allowed := v_allowed || ARRAY[
        'title', 'description', 'blocked_reason', 'status', 'priority', 'due_date',
        'estimate_minutes', 'project_id', 'goal_id', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'goals' THEN
    IF private.has_active_mcp_permission('goals.create') THEN
      v_allowed := v_allowed || ARRAY[
        'title', 'project_id', 'description', 'slug',
        'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'projects' THEN
    IF private.has_active_mcp_permission('projects.create') THEN
      v_allowed := v_allowed || ARRAY[
        'name', 'slug', 'description', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'task_sessions' THEN
    IF private.has_active_mcp_permission('timer.create') THEN
      v_allowed := v_allowed || ARRAY[
        'task_id', 'started_at', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  ELSIF p_table = 'task_reminders' THEN
    IF private.has_active_mcp_permission('tasks.update') THEN
      v_allowed := v_allowed || ARRAY[
        'task_id', 'remind_at', 'channel', 'delivery_mode', 'mcp_operation_id', 'mcp_client_id'
      ];
    END IF;
  END IF;

  RETURN v_allowed;
END $$;

--> statement-breakpoint
-- Resets for the columns the insert allowlists above deliberately omit, now that
-- goals and projects are classified. goals status/health/next_step are
-- goals.update authority and must not be settable at creation; projects status
-- is projects.update authority.
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
