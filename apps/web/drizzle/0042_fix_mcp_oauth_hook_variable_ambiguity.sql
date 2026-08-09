-- Fix PL/pgSQL identifier ambiguity in the Supabase Custom Access Token Hook.
--
-- The original function used a local variable named `oauth_client_id`, which
-- conflicts with the identically named grant-table column during OAuth token
-- exchange. Prefixing local variables makes the binding explicit and keeps the
-- hook compatible with PostgreSQL 17.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb;
  v_user_id uuid;
  v_oauth_client_id text;
  v_granted_resource_uri text;
BEGIN
  v_claims := event -> 'claims';
  v_oauth_client_id := NULLIF(v_claims ->> 'client_id', '');

  IF NULLIF(event ->> 'user_id', '') IS NULL OR v_oauth_client_id IS NULL THEN
    RETURN event;
  END IF;

  v_user_id := (event ->> 'user_id')::uuid;

  SELECT grant_record.resource_uri
    INTO v_granted_resource_uri
  FROM public.mcp_authorization_grants AS grant_record
  WHERE grant_record.owner_user_id = v_user_id
    AND grant_record.oauth_client_id = v_oauth_client_id
    AND grant_record.status = 'active'
    AND grant_record.revoked_at IS NULL
  LIMIT 1;

  IF v_granted_resource_uri IS NULL THEN
    RETURN event;
  END IF;

  v_claims := jsonb_set(
    v_claims,
    '{aud}',
    to_jsonb(v_granted_resource_uri),
    true
  );

  RETURN jsonb_set(event, '{claims}', v_claims, true);
END;
$$;

GRANT EXECUTE
  ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;
REVOKE EXECUTE
  ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM authenticated, anon, public;
