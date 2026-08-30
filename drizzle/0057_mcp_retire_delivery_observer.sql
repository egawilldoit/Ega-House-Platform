-- Retire delivery_observer — converge DB to runtime truth while preserving
-- terminal historical grant records for auditability.

--> statement-breakpoint
UPDATE public.mcp_authorization_grants
SET status = 'revoked',
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE permission_profile = 'delivery_observer'
  AND status = 'active';

--> statement-breakpoint
UPDATE public.mcp_authorization_grants
SET status = 'failed',
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE permission_profile = 'delivery_observer'
  AND status = 'pending';

--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_check;

ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_profile_check
  CHECK (
    permission_profile IN ('read_only', 'task_manager', 'workspace_manager')
    OR (
      permission_profile = 'delivery_observer'
      AND status IN ('failed', 'revoked')
      AND permissions = '["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"]'::jsonb
    )
  );

--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_permissions_check;

ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_profile_permissions_check
  CHECK (
    (
      status IN ('active', 'pending')
      AND (
        (permission_profile = 'read_only' AND permissions = '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"]'::jsonb)
        OR (permission_profile = 'task_manager' AND permissions = '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update", "today.read", "timer.read"]'::jsonb)
        OR (permission_profile = 'workspace_manager' AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb)
      )
    )
    OR (
      status IN ('failed', 'revoked')
      AND (
        (permission_profile = 'read_only' AND permissions IN (
          '["projects.read", "goals.read", "tasks.read"]'::jsonb,
          '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"]'::jsonb
        ))
        OR (permission_profile = 'task_manager' AND permissions IN (
          '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update"]'::jsonb,
          '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update", "today.read", "timer.read"]'::jsonb
        ))
        OR (permission_profile = 'delivery_observer' AND permissions = '["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"]'::jsonb)
        OR (permission_profile = 'workspace_manager' AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb)
      )
    )
  );
