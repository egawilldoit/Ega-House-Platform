-- MCP workspace_manager profile — adds explicit write permission set.
--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_check;

ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_profile_check
  CHECK (
    permission_profile in ('read_only', 'task_manager', 'delivery_observer', 'workspace_manager')
  );

--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_permissions_check;

ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_profile_permissions_check
  CHECK (
    (
      permission_profile = 'read_only'
      AND permissions = '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"]'::jsonb
    )
    OR (
      permission_profile = 'task_manager'
      AND permissions = '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update", "today.read", "timer.read"]'::jsonb
    )
    OR (
      permission_profile = 'delivery_observer'
      AND permissions = '["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"]'::jsonb
    )
    OR (
      permission_profile = 'workspace_manager'
      AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb
    )
  );
