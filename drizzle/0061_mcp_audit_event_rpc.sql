-- Persist MCP audit events through a claim-bound RPC. Direct OAuth INSERT on
-- agent_integration_events remains blocked by the RLS policy from 0056.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.record_mcp_audit_event(
  p_request_id text,
  p_tool_name text,
  p_outcome text,
  p_duration_ms integer,
  p_error_code text DEFAULT NULL,
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_mcp_audit_event(text, text, text, integer, text, jsonb) TO authenticated;
