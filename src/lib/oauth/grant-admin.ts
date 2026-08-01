import type { SupabaseClient } from "@supabase/supabase-js";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";

type GrantIdentity = {
  ownerUserId: string;
  oauthClientId: string;
};

type ActivateGrantInput = GrantIdentity & {
  clientName: string;
  resourceUri: string;
  now?: string;
};

type FailGrantInput = GrantIdentity & {
  now?: string;
};

function resolveTimestamp(now?: string): string {
  return now ?? new Date().toISOString();
}

export async function activateReadOnlyMcpGrant(
  admin: SupabaseClient<McpDatabase>,
  input: ActivateGrantInput,
): Promise<string> {
  const timestamp = resolveTimestamp(input.now);
  const { data, error } = await admin
    .from("mcp_authorization_grants")
    .upsert(
      {
        owner_user_id: input.ownerUserId,
        oauth_client_id: input.oauthClientId,
        client_name: input.clientName,
        resource_uri: input.resourceUri,
        status: "active",
        permission_profile: "read_only",
        permissions: getPermissionsForProfile("read_only"),
        permissions_version: 1,
        approved_at: timestamp,
        revoked_at: null,
        updated_at: timestamp,
      },
      { onConflict: "owner_user_id,oauth_client_id" },
    )
    .select("id")
    .single();

  if (error || !data || typeof data.id !== "string") {
    throw new Error("Failed to activate EGA MCP authorization grant.");
  }

  return data.id;
}

export async function markMcpGrantFailed(
  admin: SupabaseClient<McpDatabase>,
  input: FailGrantInput,
): Promise<void> {
  const timestamp = resolveTimestamp(input.now);
  const { error } = await admin
    .from("mcp_authorization_grants")
    .update({
      status: "failed",
      revoked_at: timestamp,
      updated_at: timestamp,
    })
    .eq("owner_user_id", input.ownerUserId)
    .eq("oauth_client_id", input.oauthClientId);

  if (error) {
    throw new Error("Failed to compensate EGA MCP authorization grant.");
  }
}
