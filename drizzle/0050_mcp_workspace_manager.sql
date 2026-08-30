-- MCP V2 permission transition — add workspace_manager without expanding
-- historical consent. Legacy active/pending grants are terminalized before
-- the current profile/document checks are installed.
--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_permissions_check;

--> statement-breakpoint
UPDATE public.mcp_authorization_grants
SET status = CASE
      WHEN status = 'active' THEN 'revoked'
      WHEN status = 'pending' THEN 'failed'
      ELSE status
    END,
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE status IN ('active', 'pending')
  AND (
    (
      permission_profile = 'read_only'
      AND permissions = '["projects.read", "goals.read", "tasks.read"]'::jsonb
    )
    OR (
      permission_profile = 'task_manager'
      AND permissions = '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update"]'::jsonb
    )
    OR (
      permission_profile = 'delivery_observer'
      AND permissions = '["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"]'::jsonb
    )
  );

--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_check;

--> statement-breakpoint
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
  ADD CONSTRAINT mcp_authorization_grants_profile_permissions_check
  CHECK (
    (
      status IN ('active', 'pending')
      AND (
        (
          permission_profile = 'read_only'
          AND permissions = '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"]'::jsonb
        )
        OR (
          permission_profile = 'task_manager'
          AND permissions = '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update", "today.read", "timer.read"]'::jsonb
        )
        OR (
          permission_profile = 'workspace_manager'
          AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb
        )
      )
    )
    OR (
      status IN ('failed', 'revoked')
      AND (
        (
          permission_profile = 'read_only'
          AND permissions IN (
            '["projects.read", "goals.read", "tasks.read"]'::jsonb,
            '["projects.read", "goals.read", "tasks.read", "today.read", "timer.read"]'::jsonb
          )
        )
        OR (
          permission_profile = 'task_manager'
          AND permissions IN (
            '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update"]'::jsonb,
            '["projects.read", "goals.read", "tasks.read", "tasks.create", "tasks.update", "today.read", "timer.read"]'::jsonb
          )
        )
        OR (
          permission_profile = 'delivery_observer'
          AND permissions = '["delivery_runs.read", "delivery_events.read", "delivery_artifacts.read"]'::jsonb
        )
        OR (
          permission_profile = 'workspace_manager'
          AND permissions = '["projects.read", "projects.create", "projects.update", "goals.read", "goals.create", "goals.update", "tasks.read", "tasks.create", "tasks.update", "today.read", "today.update", "timer.read", "timer.create", "timer.update"]'::jsonb
        )
      )
    )
  );
