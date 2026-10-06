import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { parsePermissionProfile, parsePermissionVersion } from "@/lib/mcp/permissions";
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

  // Narrowed here, not only inside the principal resolver. Validating
  // permissions_version as "integer >= 1" accepted a row claiming a future or
  // foreign version and then propagated that unvalidated number into
  // McpGrantRecord and the MRTR confirmation binding. The database CHECK caps
  // the column today, so this is defence in depth rather than a live
  // escalation - but the invariant belongs at the boundary that reads the row,
  // not at one layer further in.
  let permissionProfile;
  let permissionsVersion;
  try {
    permissionProfile = parsePermissionProfile(row.permission_profile);
    permissionsVersion = parsePermissionVersion(row.permissions_version);
  } catch {
    throw new Error("Invalid EGA MCP authorization grant record.");
  }

  if (
    !isNonEmptyString(row.id)
    || !isNonEmptyString(row.owner_user_id)
    || !isNonEmptyString(row.oauth_client_id)
    || !isNonEmptyString(row.resource_uri)
    || row.status !== "active"
    || !Array.isArray(row.permissions)
    || !row.permissions.every((permission) => typeof permission === "string")
  ) {
    throw new Error("Invalid EGA MCP authorization grant record.");
  }

  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    oauthClientId: row.oauth_client_id,
    resourceUri: row.resource_uri,
    status: "active",
    permissionProfile,
    permissions: row.permissions,
    permissionsVersion,
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
