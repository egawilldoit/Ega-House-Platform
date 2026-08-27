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
    check(
      "mcp_authorization_grants_profile_check",
      sql`${table.permissionProfile} in ('read_only', 'task_manager', 'delivery_observer', 'workspace_manager')`,
    ),
    check(
      "mcp_authorization_grants_resource_uri_check",
      sql`${table.resourceUri} ~ '^https://[^?#]+$' or ${table.resourceUri} ~ '^http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:[0-9]+)?/[^?#]*$'`,
    ),
    check(
      "mcp_authorization_grants_permissions_array_check",
      sql`jsonb_typeof(${table.permissions}) = 'array'`,
    ),
    check(
      "mcp_authorization_grants_permissions_version_check",
      sql`${table.permissionsVersion} > 0`,
    ),
  ],
);

export type McpAuthorizationGrant =
  typeof mcpAuthorizationGrants.$inferSelect;
export type NewMcpAuthorizationGrant =
  typeof mcpAuthorizationGrants.$inferInsert;
