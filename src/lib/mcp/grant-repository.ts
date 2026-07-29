import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpGrantRecord } from "@/lib/mcp/principal";

const GRANT_COLUMNS = [
  "id",
  "owner_user_id",
  "oauth_client_id",
  "status",
  "permission_profile",
  "permissions",
  "permissions_version",
].join(",");

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapGrantRow(value: unknown): McpGrantRecord {
  if (!isRecord(value)) {
    throw new Error("Invalid EGA MCP authorization grant record.");
  }

  const row = value;
  if (
    !isNonEmptyString(row.id)
    || !isNonEmptyString(row.owner_user_id)
    || !isNonEmptyString(row.oauth_client_id)
    || row.status !== "active"
    || !isNonEmptyString(row.permission_profile)
    || !Array.isArray(row.permissions)
    || !row.permissions.every((permission) => typeof permission === "string")
    || !Number.isInteger(row.permissions_version)
    || (row.permissions_version as number) < 1
  ) {
    throw new Error("Invalid EGA MCP authorization grant record.");
  }

  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    oauthClientId: row.oauth_client_id,
    status: "active",
    permissionProfile: row.permission_profile,
    permissions: row.permissions,
    permissionsVersion: row.permissions_version as number,
  };
}

export async function loadActiveMcpGrant(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  oauthClientId: string,
): Promise<McpGrantRecord | null> {
  const { data, error } = await client
    .from("mcp_authorization_grants")
    .select(GRANT_COLUMNS)
    .eq("owner_user_id", ownerUserId)
    .eq("oauth_client_id", oauthClientId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load EGA MCP authorization grant.");
  }

  if (!data) {
    return null;
  }

  return mapGrantRow(data as unknown);
}
