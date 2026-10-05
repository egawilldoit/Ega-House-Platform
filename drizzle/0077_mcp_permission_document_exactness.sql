-- Make (permission_profile, permissions_version) name exactly ONE permission
-- document at the database, not a family of them.
--
-- WHY THIS EXISTS. 0066 correctly made the version the key to an exact document
-- for *authority*, but it expressed the key with two shapes that are not exact:
--
--   1. Element containment, not multiplicity. `<@` and `@>` are set operations
--      over jsonb arrays, so a document with a repeated entry satisfies both
--      directions against the same N-element literal. Observed on this
--      repository's own journal before this migration:
--
--        INSERT ... permission_profile 'read_only', permissions_version 1,
--          permissions '["projects.read","projects.read","goals.read",
--                          "tasks.read","today.read","timer.read"]'
--        -- accepted (no error)
--
--      and resolveMcpPrincipal denies that same row forever with
--      PERMISSION_DENIED, because permissionsMatchProfile requires the stored
--      array to be duplicate-free. So the database accepted a row that no
--      shipped code path can ever authorise, while the row stayed
--      status='active' and revoked_at IS NULL - a connection that is
--      deauthenticated without being revoked, which is the exact failure 0066's
--      own header says it exists to end. Nothing in the application can repair
--      it: the only writer is grant-admin, and only re-consent rewrites a
--      document.
--
--   2. The terminal branch had no permissions_version predicate and used a
--      containment WINDOW rather than a document. Observed before this
--      migration, all of these were accepted:
--
--        (task_manager, 2)  - a pairing apps/web/src/lib/mcp/permissions.ts
--                              declares INVALID (task_manager has no v2
--                              document), so the database could represent a
--                              (profile, version) pair the resolver cannot
--                              resolve at all
--        (read_only, 1) carrying the v2 ten-permission document
--        (read_only, 2) carrying the legacy three-permission document
--        (workspace_manager, 1) carrying the v2 nineteen-permission document
--        (workspace_manager, 1) carrying any of the 14..19 intermediate sets
--        (read_only, 1) carrying any 3-of-5 / 4-of-5 intermediate set
--        (task_manager, 1) carrying any 5-of-7 / 6-of-7 intermediate set
--
--      So the database could not answer "which document does this row mean?",
--      and 0065's stated safety argument - "0066 restricts a
--      permissions_version 1 row to the exact v1 permission document" - was
--      true for issued rows only.
--
--   None of the terminal widening is an escalation: every database capability
--   gate is private.has_active_mcp_permission, which requires
--   status = 'active' AND revoked_at IS NULL, and
--   public.resolve_active_mcp_grant filters on the same pair. It is a
--   representation defect, and it fails in the dangerous direction - the
--   database accepted documents the application will not honour.
--
-- WHAT THIS DOES. Restates the constraint so that every accepted document is
-- pinned by (status class, profile, version) AND its exact length, alongside
-- the existing order-insensitive containment in both directions. Length plus
-- two-way containment is exact set equality with a duplicate-free array, so
-- ordering stays non-semantic (a reordered grant is still valid, which is what
-- 0066 promised) while a repeated entry is refused.
--
-- NEVER NARROWS AN ISSUED DOCUMENT. Every document the active/pending branch
-- accepted before is still accepted, byte for byte:
--   (read_only, 1) 5   (task_manager, 1) 7   (workspace_manager, 1) 14
--   (read_only, 2) 10  (workspace_manager, 2) 19
-- The terminal branch keeps every document any shipped migration ever wrote:
-- the 0039/0050 legacy short read_only (3) and task_manager (5) documents, both
-- at version 1, which is the only version those writes could carry because
-- 0037 gave the column DEFAULT 1 and grant-admin has only ever written
-- CURRENT_MCP_PERMISSION_VERSION; plus each version's own full document, so
-- revoking a v1 or v2 grant still succeeds. The retired delivery_observer
-- profile stays version-agnostic on purpose: 0050 already pins it to one exact
-- document and only for a terminal row, it is not an application profile, and
-- it has no registered tool, so the number on such a row names nothing.
--
-- BEFORE APPLYING, confirm no production row holds a document this constraint
-- would refuse (it should return no rows; every write path to this table has
-- gone through an exact-document enumeration since 0039):
--
--   SELECT permission_profile, permissions_version, status, n, permissions
--   FROM (
--     SELECT permission_profile, permissions_version, status,
--            jsonb_array_length(permissions) AS n, permissions
--     FROM public.mcp_authorization_grants
--   ) AS grants_with_length
--   WHERE NOT (
--     (status IN ('active','pending') AND (
--        (permissions_version = 1 AND permission_profile = 'read_only' AND n = 5)
--     OR (permissions_version = 1 AND permission_profile = 'task_manager' AND n = 7)
--     OR (permissions_version = 1 AND permission_profile = 'workspace_manager' AND n = 14)
--     OR (permissions_version = 2 AND permission_profile = 'read_only' AND n = 10)
--     OR (permissions_version = 2 AND permission_profile = 'workspace_manager' AND n = 19)))
--     OR
--     (status IN ('failed','revoked') AND (
--        (permissions_version = 1 AND permission_profile = 'read_only' AND n IN (3,5))
--     OR (permissions_version = 2 AND permission_profile = 'read_only' AND n = 10)
--     OR (permissions_version = 1 AND permission_profile = 'task_manager' AND n IN (5,7))
--     OR (permissions_version = 1 AND permission_profile = 'workspace_manager' AND n = 14)
--     OR (permissions_version = 2 AND permission_profile = 'workspace_manager' AND n = 19)
--     OR (permission_profile = 'delivery_observer' AND n = 3)))
--   );

--> statement-breakpoint
ALTER TABLE public.mcp_authorization_grants
  DROP CONSTRAINT IF EXISTS mcp_authorization_grants_profile_permissions_check;

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
          AND jsonb_array_length(permissions) = 5
          AND permissions <@ '["projects.read","goals.read","tasks.read","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","today.read","timer.read"]'::jsonb
        )
        OR (
          permissions_version = 1
          AND permission_profile = 'task_manager'
          AND jsonb_array_length(permissions) = 7
          AND permissions <@ '["projects.read","goals.read","tasks.read","tasks.create","tasks.update","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","tasks.create","tasks.update","today.read","timer.read"]'::jsonb
        )
        OR (
          permissions_version = 1
          AND permission_profile = 'workspace_manager'
          AND jsonb_array_length(permissions) = 14
          AND permissions <@ '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update"]'::jsonb
          AND permissions @> '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update"]'::jsonb
        )
        OR (
          permissions_version = 2
          AND permission_profile = 'read_only'
          AND jsonb_array_length(permissions) = 10
          AND permissions <@ '["projects.read","goals.read","tasks.read","today.read","timer.read","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","today.read","timer.read","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
        )
        OR (
          permissions_version = 2
          AND permission_profile = 'workspace_manager'
          AND jsonb_array_length(permissions) = 19
          AND permissions <@ '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
          AND permissions @> '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
        )
      )
    )
    OR (
      status IN ('failed', 'revoked')
      AND (
        (
          permissions_version = 1
          AND permission_profile = 'read_only'
          AND jsonb_array_length(permissions) = 3
          AND permissions <@ '["projects.read","goals.read","tasks.read","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read"]'::jsonb
        )
        OR (
          permissions_version = 1
          AND permission_profile = 'read_only'
          AND jsonb_array_length(permissions) = 5
          AND permissions <@ '["projects.read","goals.read","tasks.read","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","today.read","timer.read"]'::jsonb
        )
        OR (
          permissions_version = 2
          AND permission_profile = 'read_only'
          AND jsonb_array_length(permissions) = 10
          AND permissions <@ '["projects.read","goals.read","tasks.read","today.read","timer.read","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","today.read","timer.read","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
        )
        OR (
          permissions_version = 1
          AND permission_profile = 'task_manager'
          AND jsonb_array_length(permissions) = 5
          AND permissions <@ '["projects.read","goals.read","tasks.read","tasks.create","tasks.update","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","tasks.create","tasks.update"]'::jsonb
        )
        OR (
          permissions_version = 1
          AND permission_profile = 'task_manager'
          AND jsonb_array_length(permissions) = 7
          AND permissions <@ '["projects.read","goals.read","tasks.read","tasks.create","tasks.update","today.read","timer.read"]'::jsonb
          AND permissions @> '["projects.read","goals.read","tasks.read","tasks.create","tasks.update","today.read","timer.read"]'::jsonb
        )
        OR (
          permissions_version = 1
          AND permission_profile = 'workspace_manager'
          AND jsonb_array_length(permissions) = 14
          AND permissions <@ '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update"]'::jsonb
          AND permissions @> '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update"]'::jsonb
        )
        OR (
          permissions_version = 2
          AND permission_profile = 'workspace_manager'
          AND jsonb_array_length(permissions) = 19
          AND permissions <@ '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
          AND permissions @> '["projects.read","projects.create","projects.update","goals.read","goals.create","goals.update","tasks.read","tasks.create","tasks.update","today.read","today.update","timer.read","timer.create","timer.update","friction.read","inbox.read","notifications.read","operator.read","workload.read"]'::jsonb
        )
        OR (
          permission_profile = 'delivery_observer'
          AND permissions = '["delivery_runs.read","delivery_events.read","delivery_artifacts.read"]'::jsonb
        )
      )
    )
  );
