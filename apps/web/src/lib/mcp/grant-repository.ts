import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import type { McpGrantRecord } from "@/lib/mcp/principal";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || Array.isArray(value)) return false;
  return Boolean(value);
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
    || !isNonEmptyString(row.resource_uri)
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
    resourceUri: row.resource_uri,
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
  resourceUri: string,
): Promise<McpGrantRecord | null> {
  const { data, error } = await client.rpc("resolve_active_mcp_grant");

  if (error) {
    throw new Error("Failed to load EGA MCP authorization grant.");
  }

  if (!Array.isArray(data)) {
    throw new Error("Invalid EGA MCP authorization grant response.");
  }

  if (data.length === 0) {
    return null;
  }

  if (data.length !== 1) {
    throw new Error("Invalid EGA MCP authorization grant response.");
  }

  const grant = mapGrantRow(data[0] as unknown);
  if (
    grant.ownerUserId !== ownerUserId
    || grant.oauthClientId !== oauthClientId
    || grant.resourceUri !== resourceUri
  ) {
    throw new Error("MCP authorization grant does not match request context.");
  }

  return grant;
}
