import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Declarative mirror of `public.mcp_authorization_grants`.
 *
 * WHY THIS FILE IS NOT OPTIONAL. `drizzle.config.ts` lists it in `schema`, so it
 * is an INPUT to `db:generate` / `db:push` / `db:generate|push|pull`, not a
 * read-only description of the database. Anything this file omits, `push`
 * DROPS from the live table; anything it declares differently, `generate`
 * emits as the next migration. The MCP permission-version security model lives
 * entirely in hand-written migrations (0057, 0066, 0077), so a stale copy here
 * is a live downgrade, not dead documentation. Proven, not assumed:
 * `scripts/db/mcp-schema-drift.test.mjs` renders this file through drizzle-kit
 * and fails if the emitted DDL stops agreeing with the migration journal, and
 * `scripts/db/mcp-schema-drift-verify.mjs` proves the equivalence against a
 * real PostgreSQL 16 and against an actual `drizzle-kit push`.
 *
 * SOURCE OF TRUTH FOR EACH OBJECT. Every CHECK below is the final definition
 * from the migration that last wrote it, and it is written here so the
 * deparsed form is byte-identical:
 *
 *   mcp_authorization_grants_status_check            0037
 *   mcp_authorization_grants_profile_check          0057
 *   mcp_authorization_grants_resource_uri_check     0037
 *   mcp_authorization_grants_permissions_array_check 0037
 *   mcp_authorization_grants_permissions_version_check 0066
 *   mcp_authorization_grants_profile_permissions_check 0077
 */

/**
 * A jsonb literal for an MCP permission document, written the way the
 * migrations write it: no space after the commas, which is exactly what
 * `JSON.stringify` emits, so
 * `scripts/db/mcp-schema-drift.test.mjs` can compare this text against the
 * migration text without normalising it. PostgreSQL stores the parsed jsonb
 * value rather than the literal, so `pg_get_constraintdef` reprints the canonical
 * form with spaces - `scripts/db/mcp-schema-drift-verify.mjs` asserts THAT byte
 * for byte. Element ORDER is preserved by the deparser, so the arrays below must
 * keep the order the migrations use.
 */
function permissionDocument(permissions: readonly string[]): string {
  return `'${JSON.stringify(permissions)}'::jsonb`;
}

/**
 * The permission documents, as the DATABASE must see them.
 *
 * These literals are pinned against the authoritative application list
 * (`apps/web/src/lib/mcp/permissions.ts`, which is what grant-admin writes and
 * what `resolveMcpPrincipal` resolves against) by
 * `scripts/db/mcp-schema-drift.test.mjs`. That test is what keeps the
 * duplication from becoming a second source of truth: edit one side without the
 * other and CI fails.
 *
 * WHY THE COPY IS NOT AN IMPORT. `src/db/` is the repository's schema
 * authority at the bottom of the dependency graph; `apps/web/` is a transport
 * that consumes it. Importing a Next app's internals into the schema authority
 * would invert that direction, and `drizzle.config.ts` is evaluated by
 * drizzle-kit outside any app build, so the schema would inherit that app's
 * module graph. `scripts/architecture/check-boundaries.mjs` has no rule for
 * `from: ["src/"]`, so an import would pass mechanically while violating
 * `docs/architecture/platform-monorepo.md`; the equality test is the cheaper
 * and stronger guarantee.
 */
const V1_READ_ONLY = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "today.read",
  "timer.read",
] as const;

const V1_TASK_MANAGER = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "today.read",
  "timer.read",
] as const;

const V1_WORKSPACE_MANAGER = [
  "projects.read",
  "projects.create",
  "projects.update",
  "goals.read",
  "goals.create",
  "goals.update",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "today.read",
  "today.update",
  "timer.read",
  "timer.create",
  "timer.update",
] as const;

/** The read-only additions every permissions_version 2 document carries. */
const V2_ADDITIVE_PERMISSIONS = [
  "friction.read",
  "inbox.read",
  "notifications.read",
  "operator.read",
  "workload.read",
] as const;

const V2_READ_ONLY = [...V1_READ_ONLY, ...V2_ADDITIVE_PERMISSIONS] as const;
const V2_WORKSPACE_MANAGER = [
  ...V1_WORKSPACE_MANAGER,
  ...V2_ADDITIVE_PERMISSIONS,
] as const;

/**
 * The superseded pre-0050 documents. 0050 terminalised every row carrying one
 * of these, but they stay representable on a terminal row so that revoking or
 * failing such a grant still succeeds.
 */
const LEGACY_READ_ONLY = ["projects.read", "goals.read", "tasks.read"] as const;

const LEGACY_TASK_MANAGER = [
  "projects.read",
  "goals.read",
  "tasks.read",
  "tasks.create",
  "tasks.update",
] as const;

/** 0050 already pins the retired profile to this one exact document. */
const RETIRED_DELIVERY_OBSERVER_DOCUMENT = [
  "delivery_runs.read",
  "delivery_events.read",
  "delivery_artifacts.read",
] as const;

const RETIRED_DELIVERY_OBSERVER_PROFILE = "delivery_observer";

/**
 * `mcp_authorization_grants_profile_permissions_check`, verbatim from
 * drizzle/0077_mcp_permission_document_exactness.sql.
 *
 * It is what makes (permission_profile, permissions_version) name exactly ONE
 * permission document: `jsonb_array_length` pins the multiplicity that
 * `<@` / `@>` cannot see, and two-way containment pins the elements without
 * making order semantic. Without it the database accepts documents that
 * `resolveMcpPrincipal` will never honour - a connection that is
 * deauthenticated without being revoked.
 */
const PROFILE_PERMISSIONS_CHECK_SQL = `
  (
    status IN ('active', 'pending')
    AND (
      (
        permissions_version = 1
        AND permission_profile = 'read_only'
        AND jsonb_array_length(permissions) = 5
        AND permissions <@ ${permissionDocument(V1_READ_ONLY)}
        AND permissions @> ${permissionDocument(V1_READ_ONLY)}
      )
      OR (
        permissions_version = 1
        AND permission_profile = 'task_manager'
        AND jsonb_array_length(permissions) = 7
        AND permissions <@ ${permissionDocument(V1_TASK_MANAGER)}
        AND permissions @> ${permissionDocument(V1_TASK_MANAGER)}
      )
      OR (
        permissions_version = 1
        AND permission_profile = 'workspace_manager'
        AND jsonb_array_length(permissions) = 14
        AND permissions <@ ${permissionDocument(V1_WORKSPACE_MANAGER)}
        AND permissions @> ${permissionDocument(V1_WORKSPACE_MANAGER)}
      )
      OR (
        permissions_version = 2
        AND permission_profile = 'read_only'
        AND jsonb_array_length(permissions) = 10
        AND permissions <@ ${permissionDocument(V2_READ_ONLY)}
        AND permissions @> ${permissionDocument(V2_READ_ONLY)}
      )
      OR (
        permissions_version = 2
        AND permission_profile = 'workspace_manager'
        AND jsonb_array_length(permissions) = 19
        AND permissions <@ ${permissionDocument(V2_WORKSPACE_MANAGER)}
        AND permissions @> ${permissionDocument(V2_WORKSPACE_MANAGER)}
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
        AND permissions <@ ${permissionDocument(V1_READ_ONLY)}
        AND permissions @> ${permissionDocument(LEGACY_READ_ONLY)}
      )
      OR (
        permissions_version = 1
        AND permission_profile = 'read_only'
        AND jsonb_array_length(permissions) = 5
        AND permissions <@ ${permissionDocument(V1_READ_ONLY)}
        AND permissions @> ${permissionDocument(V1_READ_ONLY)}
      )
      OR (
        permissions_version = 2
        AND permission_profile = 'read_only'
        AND jsonb_array_length(permissions) = 10
        AND permissions <@ ${permissionDocument(V2_READ_ONLY)}
        AND permissions @> ${permissionDocument(V2_READ_ONLY)}
      )
      OR (
        permissions_version = 1
        AND permission_profile = 'task_manager'
        AND jsonb_array_length(permissions) = 5
        AND permissions <@ ${permissionDocument(V1_TASK_MANAGER)}
        AND permissions @> ${permissionDocument(LEGACY_TASK_MANAGER)}
      )
      OR (
        permissions_version = 1
        AND permission_profile = 'task_manager'
        AND jsonb_array_length(permissions) = 7
        AND permissions <@ ${permissionDocument(V1_TASK_MANAGER)}
        AND permissions @> ${permissionDocument(V1_TASK_MANAGER)}
      )
      OR (
        permissions_version = 1
        AND permission_profile = 'workspace_manager'
        AND jsonb_array_length(permissions) = 14
        AND permissions <@ ${permissionDocument(V1_WORKSPACE_MANAGER)}
        AND permissions @> ${permissionDocument(V1_WORKSPACE_MANAGER)}
      )
      OR (
        permissions_version = 2
        AND permission_profile = 'workspace_manager'
        AND jsonb_array_length(permissions) = 19
        AND permissions <@ ${permissionDocument(V2_WORKSPACE_MANAGER)}
        AND permissions @> ${permissionDocument(V2_WORKSPACE_MANAGER)}
      )
      OR (
        permission_profile = '${RETIRED_DELIVERY_OBSERVER_PROFILE}'
        AND permissions = ${permissionDocument(RETIRED_DELIVERY_OBSERVER_DOCUMENT)}
      )
    )
  )
`;

/**
 * `mcp_authorization_grants_profile_check`, verbatim from
 * drizzle/0057_mcp_retire_delivery_observer.sql.
 *
 * `delivery_observer` is no longer an issuable profile but stays representable
 * on a terminal row, which is what lets a revoked legacy grant still be revoked
 * or fail closed.
 */
const PROFILE_CHECK_SQL = `
    permission_profile IN ('read_only', 'task_manager', 'workspace_manager')
    OR (
      permission_profile = '${RETIRED_DELIVERY_OBSERVER_PROFILE}'
      AND status IN ('failed', 'revoked')
      AND permissions = ${permissionDocument(RETIRED_DELIVERY_OBSERVER_DOCUMENT)}
    )
`;

export const mcpAuthorizationGrants = pgTable(
  "mcp_authorization_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id").notNull(),
    oauthClientId: text("oauth_client_id").notNull(),
    resourceUri: text("resource_uri").notNull(),
    clientName: text("client_name"),
    status: text("status").notNull().default("pending"),
    permissionProfile: text("permission_profile").notNull(),
    permissions: jsonb("permissions").notNull().default(sql`'[]'::jsonb`),
    permissionsVersion: integer("permissions_version").notNull().default(1),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("mcp_authorization_grants_owner_client_unique").on(
      table.ownerUserId,
      table.oauthClientId,
    ),
    index("mcp_authorization_grants_owner_status_idx").on(
      table.ownerUserId,
      table.status,
    ),
    index("mcp_authorization_grants_client_status_idx").on(
      table.oauthClientId,
      table.status,
    ),
    check(
      "mcp_authorization_grants_status_check",
      sql`${table.status} in ('pending', 'active', 'failed', 'revoked')`,
    ),
    /**
     * 0057: `delivery_observer` is no longer an issuable profile but stays
     * representable on a terminal row, which is what lets a revoked legacy
     * grant still be revoked or fail closed.
     */
    check("mcp_authorization_grants_profile_check", sql.raw(PROFILE_CHECK_SQL)),
    check(
      "mcp_authorization_grants_resource_uri_check",
      sql`${table.resourceUri} ~ '^https://[^?#]+$' or ${table.resourceUri} ~ '^http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?/[^?#]*$'`,
    ),
    check(
      "mcp_authorization_grants_permissions_array_check",
      sql`jsonb_typeof(${table.permissions}) = 'array'`,
    ),
    /**
     * 0066: `IN (1, 2)`, not `> 0`. The version is the second half of the key
     * that names one exact permission document, so an unrecognised version has
     * to be unrepresentable at the database rather than merely unknown to the
     * resolver.
     */
    check(
      "mcp_authorization_grants_permissions_version_check",
      sql.raw(`"permissions_version" IN (1, 2)`),
    ),
    check(
      "mcp_authorization_grants_profile_permissions_check",
      sql.raw(PROFILE_PERMISSIONS_CHECK_SQL),
    ),
  ],
);

export type McpAuthorizationGrant =
  typeof mcpAuthorizationGrants.$inferSelect;
export type NewMcpAuthorizationGrant =
  typeof mcpAuthorizationGrants.$inferInsert;
