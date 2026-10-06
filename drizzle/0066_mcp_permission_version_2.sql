-- Version the MCP permission documents so capability growth stops being a
-- deauthentication event.
--
-- WHY THIS EXISTS. permissions_version was written as the literal 1 by
-- apps/web/src/lib/oauth/grant-admin.ts and validated only as an integer > 0
-- - there was no registry, no current-version constant, and no equality check
-- anywhere. resolveMcpPrincipal recomputed the expected permission set from the
-- CURRENT contents of the profile in permissions.ts and then required the
-- stored grant row to equal it exactly. Adding a single permission to
-- workspace_manager therefore failed every existing connection closed (403)
-- while leaving the row status='active', so the row could never authenticate
-- again and had no in-app recovery. At the same time the profile_permissions
-- CHECK pinned the exact JSON array, so the re-consent that would have fixed it
-- was rejected by Postgres with 23514 and surfaced as a generic activation
-- failure. One deploy of one permission would have disconnected every
-- workspace_manager integration with no way back.
--
-- WHAT THIS DOES. Makes (permission_profile, permissions_version) the key to an
-- exact permission document. permissions_version 1 rows keep exactly the 14
-- permissions they were approved for, unchanged. permissions_version 2 is the
-- same document plus the additive read capabilities. Because the CHECK is now
-- keyed on the version, a v1 row stays valid forever and a v2 row is a
-- distinct, separately consented document - no revocation, no mass 403, and no
-- silent authority gain.
--
-- The CHECK compares elements rather than whole-array jsonb equality so that
-- reordering the declaration in permissions.ts can never invalidate a live
-- grant.
--
-- NEVER WEAKENS. v1 is a strict superset of the previous active-row constraint:
-- the same three profiles with the same documents are still accepted, and the
-- previously terminal delivery_observer handling is preserved verbatim.

--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_permissions_check;

ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_permissions_version_check;

ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_permissions_version_check
  CHECK ("permissions_version" IN (1, 2));

--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  ADD CONSTRAINT mcp_authorization_grants_profile_permissions_check
  CHECK (
    (
      status IN ('active', 'pending')
      AND (
        (
          permissions_version = 1
          AND permission_profile = 'read_only'
          AND permissions <@ '["projects.read","goals.read","tasks.read","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","today.read","timer.read"]'::jsonb
        )
        OR (
          permissions_version = 1
          AND permission_profile = 'task_manager'
          AND permissions <@ '["projects.read","goals.read","tasks.read","tasks.create","tasks.update","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","tasks.create","tasks.update","today.read","timer.read"]'::jsonb
        )
        OR (
          permissions_version = 1
          AND permission_profile = 'workspace_manager'
          AND permissions <@ '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update"]'::jsonb
          AND permissions @> '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update"]'::jsonb
        )
        OR (
          permissions_version = 2
          AND permission_profile = 'read_only'
          AND permissions <@ '["projects.read","goals.read","tasks.read","today.read","timer.read","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","today.read","timer.read","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
        )
        OR (
          permissions_version = 2
          AND permission_profile = 'workspace_manager'
          AND permissions <@ '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
          AND permissions @> '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
        )
      )
    )
    OR (
      status IN ('failed', 'revoked')
      AND (
        (
          permission_profile = 'read_only'
          AND permissions <@ '["projects.read","goals.read","tasks.read","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read"]'::jsonb
        )
        OR (
          permission_profile = 'task_manager'
          AND permissions <@ '["projects.read","goals.read","tasks.read","tasks.create","tasks.update","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","tasks.create","tasks.update"]'::jsonb
        )
        OR (
          permission_profile = 'delivery_observer'
          AND permissions = '["delivery_runs.read","delivery_events.read","delivery_artifacts.read"]'::jsonb
        )
        OR (
          permission_profile = 'read_only'
          AND permissions = '["projects.read","goals.read","tasks.read","today.read","timer.read","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
        )
        OR (
          permission_profile = 'workspace_manager'
          AND permissions <@ '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
          AND permissions @> '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update"]'::jsonb
        )
      )
    )
  );
