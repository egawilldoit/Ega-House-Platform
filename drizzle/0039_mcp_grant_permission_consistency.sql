-- Keep the stored EGA permission document aligned with its named profile.
-- The canonical order also makes consent updates and audit diffs deterministic.

--> statement-breakpoint

ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_permissions_check;

ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_profile_permissions_check
  CHECK (
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
