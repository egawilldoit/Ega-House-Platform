-- EGA House MCP read-only RLS policies.
--
-- Direct Supabase user sessions retain owner-scoped CRUD access. OAuth clients
-- receive SELECT access only when an active EGA grant contains the matching
-- resource URI and read permission. The application layer rechecks permission.

--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.has_active_mcp_permission(
  requested_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND COALESCE(auth.jwt() ->> 'client_id', '') <> ''
    AND COALESCE(auth.jwt() ->> 'aud', '') <> ''
    AND EXISTS (
      SELECT 1
      FROM public.mcp_authorization_grants AS grant_record
      WHERE grant_record.owner_user_id = auth.uid()
        AND grant_record.oauth_client_id = (auth.jwt() ->> 'client_id')
        AND grant_record.resource_uri = (auth.jwt() ->> 'aud')
        AND grant_record.status = 'active'
        AND grant_record.revoked_at IS NULL
        AND grant_record.permissions @> jsonb_build_array(requested_permission)
    );
$$;

REVOKE ALL ON FUNCTION public.has_active_mcp_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_mcp_permission(text) TO authenticated;

--> statement-breakpoint

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_authenticated_full_access" ON public.projects;
DROP POLICY IF EXISTS "projects_direct_user_access" ON public.projects;
DROP POLICY IF EXISTS "projects_mcp_read_access" ON public.projects;

CREATE POLICY "projects_direct_user_access"
  ON public.projects
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NULL
  );

CREATE POLICY "projects_mcp_read_access"
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NOT NULL
    AND public.has_active_mcp_permission('projects.read')
  );

--> statement-breakpoint

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goals_authenticated_full_access" ON public.goals;
DROP POLICY IF EXISTS "goals_direct_user_access" ON public.goals;
DROP POLICY IF EXISTS "goals_mcp_read_access" ON public.goals;

CREATE POLICY "goals_direct_user_access"
  ON public.goals
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NULL
  );

CREATE POLICY "goals_mcp_read_access"
  ON public.goals
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NOT NULL
    AND public.has_active_mcp_permission('goals.read')
  );

--> statement-breakpoint

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_authenticated_full_access" ON public.tasks;
DROP POLICY IF EXISTS "tasks_direct_user_access" ON public.tasks;
DROP POLICY IF EXISTS "tasks_mcp_read_access" ON public.tasks;

CREATE POLICY "tasks_direct_user_access"
  ON public.tasks
  FOR ALL
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NULL
  )
  WITH CHECK (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NULL
  );

CREATE POLICY "tasks_mcp_read_access"
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    AND (auth.jwt() ->> 'client_id') IS NOT NULL
    AND public.has_active_mcp_permission('tasks.read')
  );
