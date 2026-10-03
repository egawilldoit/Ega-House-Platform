-- Close the table-scope gap for owner-scoped tables created during the MCP
-- hardening wave, and open the permissions_version 2 read boundaries.
--
-- WHY THIS EXISTS. 0056_mcp_remaining_tables_rls_hardening.sql states its
-- intent as "after this, only direct-user sessions can access these tables",
-- and it does that for the ten tables it lists. Seven owner-scoped tables
-- created by the same wave were simply never listed, because they had already
-- been created by 0045-0049 with permissive `*_own` policies and no
-- client_id gate:
--
--   notifications, notification_devices, notification_deliveries,
--   notification_preferences  (0045)
--   user_time_context          (0046)
--   inbox_idempotency_keys     (0047)
--   operator_proposals         (0049)
--
-- Because an MCP OAuth bearer resolves to the same Postgres role as a browser
-- session, a permissions_version 1 read_only grant could SELECT, UPDATE and
-- DELETE on all seven: rewrite the owner's timezone, disable push and email
-- delivery, flip an operator proposal to 'applied', delete inbox idempotency
-- records, and read the FCM provider token. Grant revocation did not close
-- any of it, because none of those policies consulted the active grant.
--
-- WHAT THIS DOES. Restores the 0056 shape - a client_id IS NULL direct-user
-- policy plus, where a v2 capability exists, an explicit has_active_mcp_
-- permission gated mcp_* policy. Nothing is widened: every new mcp_* policy
-- requires a permission that no existing grant can hold, because 0066 restricts
-- a permissions_version 1 row to the exact v1 permission document.
--
-- provider_token (a live push credential), notification_deliveries, and the
-- device-claim RPC stay out of the MCP surface at every permission version:
-- device and delivery internals are infrastructure, not a workspace capability.

--> statement-breakpoint
-- notifications: read for MCP under notifications.read; no MCP write in v2.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_direct_user_select" ON public.notifications FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "notifications_direct_user_update" ON public.notifications FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "notifications_mcp_select_access" ON public.notifications FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL AND private.has_active_mcp_permission('notifications.read'));

--> statement-breakpoint
-- notification_devices: provider_token is a live FCM push credential. No MCP
-- surface at any permission version.
ALTER TABLE public.notification_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_devices_select_own" ON public.notification_devices;
CREATE POLICY "notification_devices_direct_user_select" ON public.notification_devices FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
-- notification_deliveries: provider retry/diagnostic state. Not a capability.
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_deliveries_select_own" ON public.notification_deliveries;
CREATE POLICY "notification_deliveries_direct_user_select" ON public.notification_deliveries FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
-- notification_preferences: read for MCP under notifications.read so the
-- unread/preference summary is honest; no MCP write in v2.
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_preferences_select_own" ON public.notification_preferences;
DROP POLICY IF EXISTS "notification_preferences_insert_own" ON public.notification_preferences;
DROP POLICY IF EXISTS "notification_preferences_update_own" ON public.notification_preferences;
DROP POLICY IF EXISTS "notification_preferences_delete_own" ON public.notification_preferences;
CREATE POLICY "notification_preferences_direct_user_select" ON public.notification_preferences FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "notification_preferences_direct_user_insert" ON public.notification_preferences FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "notification_preferences_direct_user_update" ON public.notification_preferences FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "notification_preferences_direct_user_delete" ON public.notification_preferences FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "notification_preferences_mcp_select_access" ON public.notification_preferences FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL AND private.has_active_mcp_permission('notifications.read'));

--> statement-breakpoint
-- user_time_context: read-only for MCP, and only for the read capabilities that
-- genuinely need the owner's timezone. today.read keeps ega_get_today_plan and
-- ega_get_operator_preview working exactly as before; friction.read and
-- workload.read are the new derived-analytics capabilities. Writing a timezone
-- stays a direct-user action - it is a device setting, not a workspace mutation.
ALTER TABLE public.user_time_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_time_context FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_time_context_select_own" ON public.user_time_context;
DROP POLICY IF EXISTS "user_time_context_insert_own" ON public.user_time_context;
DROP POLICY IF EXISTS "user_time_context_update_own" ON public.user_time_context;
DROP POLICY IF EXISTS "user_time_context_delete_own" ON public.user_time_context;
CREATE POLICY "user_time_context_direct_user_select" ON public.user_time_context FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "user_time_context_direct_user_insert" ON public.user_time_context FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "user_time_context_direct_user_update" ON public.user_time_context FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "user_time_context_direct_user_delete" ON public.user_time_context FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "user_time_context_mcp_select_access" ON public.user_time_context FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL AND private.has_any_active_mcp_permission(ARRAY['today.read', 'friction.read', 'workload.read']::text[]));

--> statement-breakpoint
-- operator_proposals: stored proposals are readable under operator.read. The
-- lifecycle write path is intentionally NOT opened here; operator.create /
-- operator.update are not granted at v2, so the 'applied' transition a v1
-- read_only bearer could previously force directly is closed.
ALTER TABLE public.operator_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "operator_proposals_select_own" ON public.operator_proposals;
DROP POLICY IF EXISTS "operator_proposals_insert_own" ON public.operator_proposals;
DROP POLICY IF EXISTS "operator_proposals_update_own" ON public.operator_proposals;
DROP POLICY IF EXISTS "operator_proposals_delete_own" ON public.operator_proposals;
CREATE POLICY "operator_proposals_direct_user_select" ON public.operator_proposals FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "operator_proposals_direct_user_insert" ON public.operator_proposals FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "operator_proposals_direct_user_update" ON public.operator_proposals FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL) WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "operator_proposals_direct_user_delete" ON public.operator_proposals FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "operator_proposals_mcp_select_access" ON public.operator_proposals FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL AND private.has_active_mcp_permission('operator.read'));

--> statement-breakpoint
-- inbox_idempotency_keys: internal dedup ledger. MCP gains no write path at v2,
-- so an MCP bearer can no longer forge or delete a capture key and defeat inbox
-- conversion idempotency.
ALTER TABLE public.inbox_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_idempotency_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inbox_idempotency_keys_select_own" ON public.inbox_idempotency_keys;
DROP POLICY IF EXISTS "inbox_idempotency_keys_insert_own" ON public.inbox_idempotency_keys;
DROP POLICY IF EXISTS "inbox_idempotency_keys_delete_own" ON public.inbox_idempotency_keys;
CREATE POLICY "inbox_idempotency_keys_direct_user_select" ON public.inbox_idempotency_keys FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "inbox_idempotency_keys_direct_user_insert" ON public.inbox_idempotency_keys FOR INSERT TO authenticated WITH CHECK (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);
CREATE POLICY "inbox_idempotency_keys_direct_user_delete" ON public.inbox_idempotency_keys FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NULL);

--> statement-breakpoint
-- idea_notes (the inbox items themselves) and task_recurrences become readable
-- to a v2 principal. Both were closed by 0056 to every MCP bearer.
CREATE POLICY "idea_notes_mcp_select_access" ON public.idea_notes FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL AND private.has_active_mcp_permission('inbox.read'));

CREATE POLICY "task_recurrences_mcp_select_access" ON public.task_recurrences FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()) AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL AND private.has_active_mcp_permission('tasks.read'));

--> statement-breakpoint
-- Friction Radar and the workload snapshot both derive from task_sessions
-- execution evidence. timer.read remains the timer authority; the derived
-- analytics capabilities get their own branch rather than borrowing it, so the
-- authority boundary stays legible instead of being conflated.
DROP POLICY IF EXISTS "task_sessions_mcp_read_access" ON public.task_sessions;
CREATE POLICY "task_sessions_mcp_read_access"
  ON public.task_sessions
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = (SELECT auth.uid())
    AND ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL
    AND private.has_any_active_mcp_permission(ARRAY['timer.read', 'workload.read', 'friction.read']::text[])
  );

--> statement-breakpoint
-- claim_notification_device is SECURITY DEFINER and executable by `authenticated`.
-- Without a client_id guard an MCP bearer could rewrite its own device rows and
-- deactivate any other installation sharing the same provider token. Same
-- direct-user-only guard the project purge RPC uses (0062).
CREATE OR REPLACE FUNCTION public.claim_notification_device(
  p_installation_id text,
  p_platform text,
  p_provider text,
  p_provider_token text
)
RETURNS public.notification_devices
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
  v_device public.notification_devices%ROWTYPE;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF ((SELECT auth.jwt()) ->> 'client_id') IS NOT NULL THEN
    RAISE EXCEPTION 'Direct user session required.' USING ERRCODE = '42501';
  END IF;

  IF p_platform NOT IN ('android') THEN
    RAISE EXCEPTION 'Unsupported platform: %', p_platform;
  END IF;

  IF p_provider NOT IN ('fcm') THEN
    RAISE EXCEPTION 'Unsupported provider: %', p_provider;
  END IF;

  IF p_installation_id IS NULL OR length(trim(p_installation_id)) = 0 THEN
    RAISE EXCEPTION 'installation_id is required';
  END IF;

  IF p_provider_token IS NULL OR length(trim(p_provider_token)) = 0 THEN
    RAISE EXCEPTION 'provider_token is required';
  END IF;

  -- One active endpoint per provider token (global, any owner, any installation)
  UPDATE public.notification_devices
  SET is_active = false,
      invalidated_at = now(),
      updated_at = now()
  WHERE provider_token = p_provider_token
    AND is_active = true
    AND (owner_user_id <> v_actor OR installation_id <> p_installation_id);

  INSERT INTO public.notification_devices (
    owner_user_id, installation_id, platform, provider, provider_token, is_active, last_seen_at
  ) VALUES (
    v_actor, p_installation_id, p_platform, p_provider, p_provider_token, true, now()
  )
  ON CONFLICT (installation_id) DO UPDATE
    SET owner_user_id = EXCLUDED.owner_user_id,
        platform = EXCLUDED.platform,
        provider = EXCLUDED.provider,
        provider_token = EXCLUDED.provider_token,
        is_active = true,
        last_seen_at = now(),
        invalidated_at = NULL,
        updated_at = now()
  RETURNING * INTO v_device;

  RETURN v_device;
END;
$$;

--> statement-breakpoint
-- The audit RPC validated the shape of a tool name but never whether the tool
-- exists, so an MCP bearer could write arbitrary mcp_tool_call rows attributed
-- to its own grant - the ledger was forgeable by the actor it audits. Restrict
-- it to the registered catalog. This list is the database-side mirror of
-- apps/web/src/lib/mcp/tool-discovery.ts and is pinned to it by
-- apps/web/src/lib/mcp/capability-registry-migration.test.ts.
CREATE OR REPLACE FUNCTION private.is_registered_mcp_tool(p_tool_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_tool_name = ANY (ARRAY[
    'ega_get_capabilities',
    'ega_list_projects',
    'ega_get_task',
    'ega_list_goals',
    'ega_list_tasks',
    'ega_get_today_plan',
    'ega_list_timer_sessions',
    'ega_create_project',
    'ega_update_project_status',
    'ega_archive_project',
    'ega_unarchive_project',
    'ega_create_goal',
    'ega_update_goal_status',
    'ega_update_goal_health',
    'ega_update_goal_next_step',
    'ega_archive_goal',
    'ega_unarchive_goal',
    'ega_create_task',
    'ega_update_task',
    'ega_archive_task',
    'ega_unarchive_task',
    'ega_set_task_focus_rank',
    'ega_create_task_reminder',
    'ega_cancel_task_reminder',
    'ega_plan_task_for_today',
    'ega_remove_task_from_today',
    'ega_update_today_task_status',
    'ega_clear_completed_today',
    'ega_start_timer',
    'ega_stop_timer',
    'ega_get_friction_radar',
    'ega_get_workload_snapshot',
    'ega_get_operator_preview',
    'ega_list_inbox_items',
    'ega_get_inbox_item',
    'ega_list_notifications',
    'ega_get_unread_notification_count',
    'ega_get_operator_proposal',
    'ega_list_operator_proposals'
  ]::text[]);
$$;

REVOKE ALL ON FUNCTION private.is_registered_mcp_tool(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_registered_mcp_tool(text) TO authenticated;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_mcp_audit_event(
  p_request_id text,
  p_tool_name text,
  p_outcome text,
  p_duration_ms integer,
  p_error_code text DEFAULT NULL::text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_user_id uuid;
  v_oauth_client_id text;
  v_resource_uri text;
  v_grant_id uuid;
  v_event_id uuid;
BEGIN
  v_owner_user_id := (SELECT auth.uid());
  v_oauth_client_id := NULLIF((SELECT auth.jwt()) ->> 'client_id', '');
  v_resource_uri := NULLIF((SELECT auth.jwt()) ->> 'aud', '');

  IF v_owner_user_id IS NULL
    OR v_oauth_client_id IS NULL
    OR v_resource_uri IS NULL THEN
    RAISE EXCEPTION 'MCP authentication context is required.' USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL
    OR btrim(p_request_id) = ''
    OR char_length(p_request_id) > 64 THEN
    RAISE EXCEPTION 'Invalid MCP audit request ID.' USING ERRCODE = '22023';
  END IF;

  IF p_tool_name IS NULL
    OR p_tool_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' THEN
    RAISE EXCEPTION 'Invalid MCP audit tool name.' USING ERRCODE = '22023';
  END IF;

  IF NOT private.is_registered_mcp_tool(p_tool_name) THEN
    RAISE EXCEPTION 'Unregistered MCP tool name.' USING ERRCODE = '42501';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('success', 'error', 'denied') THEN
    RAISE EXCEPTION 'Invalid MCP audit outcome.' USING ERRCODE = '22023';
  END IF;

  IF p_duration_ms IS NULL OR p_duration_ms < 0 OR p_duration_ms > 86400000 THEN
    RAISE EXCEPTION 'Invalid MCP audit duration.' USING ERRCODE = '22023';
  END IF;

  IF p_error_code IS NOT NULL
    AND (btrim(p_error_code) = '' OR char_length(p_error_code) > 64) THEN
    RAISE EXCEPTION 'Invalid MCP audit error code.' USING ERRCODE = '22023';
  END IF;

  IF p_metadata IS NULL
    OR jsonb_typeof(p_metadata) <> 'object'
    OR octet_length(p_metadata::text) > 16384 THEN
    RAISE EXCEPTION 'Invalid MCP audit metadata.' USING ERRCODE = '22023';
  END IF;

  SELECT grant_record.id
    INTO v_grant_id
  FROM public.mcp_authorization_grants AS grant_record
  WHERE grant_record.owner_user_id = v_owner_user_id
    AND grant_record.oauth_client_id = v_oauth_client_id
    AND grant_record.resource_uri = v_resource_uri
    AND grant_record.status = 'active'
    AND grant_record.revoked_at IS NULL
  ORDER BY grant_record.created_at DESC, grant_record.id DESC
  LIMIT 1;

  IF v_grant_id IS NULL THEN
    RAISE EXCEPTION 'No active EGA MCP authorization grant.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agent_integration_events (
    owner_user_id,
    token_id,
    oauth_client_id,
    grant_id,
    action,
    resource_type,
    resource_id,
    outcome,
    ip_address,
    request_id,
    tool_name,
    metadata,
    duration_ms,
    error_code
  )
  VALUES (
    v_owner_user_id,
    NULL,
    v_oauth_client_id,
    v_grant_id,
    'mcp_tool_call',
    'mcp_tool',
    NULL,
    p_outcome,
    NULL,
    p_request_id,
    p_tool_name,
    p_metadata,
    p_duration_ms,
    p_error_code
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$
