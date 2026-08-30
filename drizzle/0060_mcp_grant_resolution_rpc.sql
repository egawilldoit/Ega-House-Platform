-- Resolve exactly one active MCP grant from the verified OAuth JWT context.
-- Direct OAuth SELECT on mcp_authorization_grants remains blocked by RLS.

--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.resolve_active_mcp_grant()
RETURNS TABLE (
  id uuid,
  owner_user_id uuid,
  oauth_client_id text,
  resource_uri text,
  status text,
  permission_profile text,
  permissions jsonb,
  permissions_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    grant_record.id,
    grant_record.owner_user_id,
    grant_record.oauth_client_id,
    grant_record.resource_uri,
    grant_record.status,
    grant_record.permission_profile,
    grant_record.permissions,
    grant_record.permissions_version
  FROM public.mcp_authorization_grants AS grant_record
  WHERE auth.uid() IS NOT NULL
    AND NULLIF(auth.jwt() ->> 'client_id', '') IS NOT NULL
    AND NULLIF(auth.jwt() ->> 'aud', '') IS NOT NULL
    AND grant_record.owner_user_id = auth.uid()
    AND grant_record.oauth_client_id = auth.jwt() ->> 'client_id'
    AND grant_record.resource_uri = auth.jwt() ->> 'aud'
    AND grant_record.status = 'active'
    AND grant_record.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.resolve_active_mcp_grant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_active_mcp_grant() FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_active_mcp_grant() TO authenticated;
