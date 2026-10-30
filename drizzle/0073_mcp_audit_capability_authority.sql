-- Stop the MCP audit ledger from being forgeable by the actor it audits.
--
-- WHY THIS EXISTS. An independent audit found that
-- public.record_mcp_audit_event proved two things about the caller and not a
-- third. It proved the tool name is REGISTERED (private.is_registered_mcp_tool,
-- added in 0065) and it proved the caller holds an active grant for the JWT's
-- (owner, client_id, aud). It never proved the grant actually HOLDS the
-- capability permission the named tool requires.
--
-- Measured against the real journal: a permissions_version 1 read_only grant
-- (projects.read, goals.read, tasks.read, today.read, timer.read) called
--
--   SELECT record_mcp_audit_event('r', 'ega_create_project', 'success', 1, ...)
--
-- and received an event id. The same principal also wrote 'success' rows
-- naming ega_archive_task, ega_start_timer and ega_clear_completed_today. A
-- task_manager grant (tasks.create, tasks.update, no projects.*) likewise wrote
-- a 'success' row naming ega_create_project.
--
-- That grants no capability by itself - RLS still refuses the underlying
-- write - but it destroys the security meaning of the ledger. The ledger
-- exists so an owner can answer "what did this integration actually do to my
-- workspace". A row asserting a successful capability exercise the principal
-- never held makes every other row in the ledger unfalsifiable, and the actor
-- who benefits from that is precisely the actor being audited. The blast radius
-- of this failure is detection, not access.
--
-- WHY THE DATABASE IS THE PLACE TO FIX IT. An MCP bearer is handed to PostgREST
-- as the raw Authorization header (apps/web/src/lib/mcp/supabase-user-client.ts)
-- and resolves to the same `authenticated` role as a browser session. An attacker
-- who skips /api/mcp entirely and calls the RPC directly is not running any
-- TypeScript, so a check in audit-repository.ts, writeMcpAuditEvent, or the
-- audited handlers would not run. Only SQL can hold this line.
--
-- WHAT THIS ADDS. private.mcp_tool_audit_permissions is the database's copy of
-- the authorization statement the runtime registry already makes: which
-- permission a capability requires, or the empty set for the one `always`
-- capability. This is the same duplication shape the repository already accepts
-- deliberately in 0066 (the permission documents) and 0065 (the audit-tool
-- allowlist): a reviewed SQL statement pinned to apps/web/src/lib/mcp/
-- capability-registry.ts by a test. private.is_registered_mcp_tool becomes a
-- thin delegator to it, so there is exactly ONE place in the database that
-- knows what a tool requires - adding a capability cannot widen the registry
-- while leaving the database behind, which is the drift 0067 was written for.
--
-- ORDERING IS LOAD-BEARING. private.is_registered_mcp_tool is defined BEFORE
-- the table of tool names below, and it is plpgsql precisely so it may
-- forward-reference. apps/web/src/lib/mcp/capability-registry-migration.test.ts
-- walks the journal to the last migration that defines
-- private.is_registered_mcp_tool and reads the quoted tool identities from
-- everything AFTER that definition in the same file. Defining the delegator
-- last, or inlining the names in it, silently empties that set and makes the
-- registry-versus-SQL proof vacuous.
--
-- WHY ONLY 'success' IS GATED. The handlers record outcome 'denied' with
-- errorCode PERMISSION_DENIED (audited-write-handlers.ts getOutcome) for
-- exactly the calls a principal was NOT authorized to make, and RATE_LIMITED
-- for calls it was. Requiring the capability permission for every outcome
-- would make the legitimate denial record unwritable and break the product's
-- own audit path. Only 'success' asserts that a capability was exercised, so
-- only 'success' is gated. 'error' and 'denied' assert nothing was completed.
--
-- A capability the registry states as `anyOf` would be under-authorized by this
-- allOf encoding, so apps/web/src/lib/mcp/audit-repository.test.ts asserts that
-- every shipped requirement is `always` or a single-permission `allOf`. No
-- capability is anyOf today; the assertion fails loudly the day one appears,
-- rather than silently letting a wider permission satisfy a narrower tool.

--> statement-breakpoint
-- Registration is now derived from the authorization statement rather than
-- restated. Kept as a distinct function because it is the registration
-- predicate the RPC and the RLS-adjacent tooling already call by name, and
-- because apps/web/src/lib/mcp/capability-registry-migration.test.ts locates
-- the canonical tool list by this function's definition.
CREATE OR REPLACE FUNCTION private.is_registered_mcp_tool(p_tool_name text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN private.mcp_tool_audit_permissions(p_tool_name) IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.is_registered_mcp_tool(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_registered_mcp_tool(text) TO authenticated;

--> statement-breakpoint
-- The authorization statement: capability -> the permission that authorizes it.
--
-- NULL means "not a registered MCP tool", which the RPC refuses with the
-- pre-existing 'Unregistered MCP tool name.' error. The empty array means
-- "registered and authorized for every authenticated principal", which today
-- is ega_get_capabilities alone (its registry requirement is `always`).
--
-- Transcribed from apps/web/src/lib/mcp/capability-registry.ts in MCP_CAPABILITIES
-- order. Every entry is `allOf` over one permission, matching the registry's
-- one() helper; ega_create_task_reminder is tasks.UPDATE, not tasks.create, and
-- that is the kind of detail a name-derived rule gets wrong, which is why this
-- is stated rather than derived.
CREATE OR REPLACE FUNCTION private.mcp_tool_audit_permissions(p_tool_name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_tool_name
    WHEN 'ega_get_capabilities' THEN ARRAY[]::text[]
    WHEN 'ega_list_projects' THEN ARRAY['projects.read']::text[]
    WHEN 'ega_get_task' THEN ARRAY['tasks.read']::text[]
    WHEN 'ega_list_goals' THEN ARRAY['goals.read']::text[]
    WHEN 'ega_list_tasks' THEN ARRAY['tasks.read']::text[]
    WHEN 'ega_get_today_plan' THEN ARRAY['today.read']::text[]
    WHEN 'ega_list_timer_sessions' THEN ARRAY['timer.read']::text[]
    WHEN 'ega_create_project' THEN ARRAY['projects.create']::text[]
    WHEN 'ega_update_project_status' THEN ARRAY['projects.update']::text[]
    WHEN 'ega_archive_project' THEN ARRAY['projects.update']::text[]
    WHEN 'ega_unarchive_project' THEN ARRAY['projects.update']::text[]
    WHEN 'ega_create_goal' THEN ARRAY['goals.create']::text[]
    WHEN 'ega_update_goal_status' THEN ARRAY['goals.update']::text[]
    WHEN 'ega_update_goal_health' THEN ARRAY['goals.update']::text[]
    WHEN 'ega_update_goal_next_step' THEN ARRAY['goals.update']::text[]
    WHEN 'ega_archive_goal' THEN ARRAY['goals.update']::text[]
    WHEN 'ega_unarchive_goal' THEN ARRAY['goals.update']::text[]
    WHEN 'ega_create_task' THEN ARRAY['tasks.create']::text[]
    WHEN 'ega_update_task' THEN ARRAY['tasks.update']::text[]
    WHEN 'ega_archive_task' THEN ARRAY['tasks.update']::text[]
    WHEN 'ega_unarchive_task' THEN ARRAY['tasks.update']::text[]
    WHEN 'ega_set_task_focus_rank' THEN ARRAY['tasks.update']::text[]
    WHEN 'ega_create_task_reminder' THEN ARRAY['tasks.update']::text[]
    WHEN 'ega_cancel_task_reminder' THEN ARRAY['tasks.update']::text[]
    WHEN 'ega_plan_task_for_today' THEN ARRAY['today.update']::text[]
    WHEN 'ega_remove_task_from_today' THEN ARRAY['today.update']::text[]
    WHEN 'ega_update_today_task_status' THEN ARRAY['today.update']::text[]
    WHEN 'ega_clear_completed_today' THEN ARRAY['today.update']::text[]
    WHEN 'ega_start_timer' THEN ARRAY['timer.create']::text[]
    WHEN 'ega_stop_timer' THEN ARRAY['timer.update']::text[]
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION private.mcp_tool_audit_permissions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mcp_tool_audit_permissions(text) TO authenticated;

--> statement-breakpoint
-- The audit RPC, now proving the capability as well as the identity.
--
-- Two changes and nothing else: the registration check reads the new
-- authorization statement (same NULL means unregistered, same SQLSTATE and
-- message), and a 'success' outcome additionally requires the resolved active
-- grant to hold the capability's permission. Identity derivation, input
-- validation, the grant resolution predicate and the INSERT are untouched, so
-- the direct-user path and the shape of the stored row are unchanged.
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
  v_grant_permissions jsonb;
  v_required_permissions text[];
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

  v_required_permissions := private.mcp_tool_audit_permissions(p_tool_name);

  IF v_required_permissions IS NULL THEN
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

  SELECT grant_record.id, grant_record.permissions
    INTO v_grant_id, v_grant_permissions
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

  -- A success row asserts the capability was exercised, so the grant that is
  -- being audited must actually hold it. Contained rather than compared, so a
  -- grant holding several permissions satisfies a single-permission tool, and
  -- the empty requirement of the one `always` capability is contained by any
  -- grant. Only 'success' is checked: a 'denied' row is how the product records
  -- a call the principal was NOT authorized to make.
  IF p_outcome = 'success'
    AND NOT (v_grant_permissions @> to_jsonb(v_required_permissions)) THEN
    RAISE EXCEPTION 'MCP audit tool is not authorized by the active EGA MCP authorization grant.'
      USING ERRCODE = '42501';
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
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) TO authenticated;