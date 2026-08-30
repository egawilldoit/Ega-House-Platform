import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizeAuthorizationDetails,
  type OAuthConsentDecision,
} from "@/lib/oauth/consent";
import {
  activateMcpGrant,
  markMcpGrantFailed,
} from "@/lib/oauth/grant-admin";
import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import { parsePermissionProfile } from "@/lib/mcp/permissions";

type OAuthMethodResult = Promise<{
  data: unknown;
  error: unknown;
}>;

export type OAuthDecisionClient = {
  getAuthorizationDetails(authorizationId: string): OAuthMethodResult;
  approveAuthorization(authorizationId: string): OAuthMethodResult;
  denyAuthorization(authorizationId: string): OAuthMethodResult;
};

type ActivateGrant = typeof activateMcpGrant;
type FailGrant = typeof markMcpGrantFailed;

type ProcessConsentInput = {
  decision: OAuthConsentDecision;
  authorizationId: string;
  ownerUserId: string;
  resourceUri: string;
  permissionProfile?: string;
  oauth: OAuthDecisionClient;
  admin?: SupabaseClient<McpDatabase>;
  activateGrant?: ActivateGrant;
  failGrant?: FailGrant;
};

function parseRedirectUrl(value: unknown): string {
  if (
    typeof value !== "object"
    || value === null
    || !("redirect_url" in value)
    || typeof value.redirect_url !== "string"
    || value.redirect_url.length > 4096
  ) {
    throw new Error("Invalid OAuth authorization response.");
  }

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(value.redirect_url);
  } catch {
    throw new Error("Invalid OAuth authorization response.");
  }

  if (redirectUrl.protocol !== "https:" && redirectUrl.protocol !== "http:") {
    throw new Error("Invalid OAuth authorization response.");
  }

  return redirectUrl.toString();
}

export async function processOAuthConsentDecision(
  input: ProcessConsentInput,
): Promise<string> {
  const activateGrant = input.activateGrant ?? activateMcpGrant;
  const failGrant = input.failGrant ?? markMcpGrantFailed;
  const authorizationResult = await input.oauth.getAuthorizationDetails(
    input.authorizationId,
  );

  if (authorizationResult.error || !authorizationResult.data) {
    throw new Error("Invalid OAuth authorization request.");
  }

  const details = normalizeAuthorizationDetails(authorizationResult.data);

  if (input.decision === "deny") {
    const denied = await input.oauth.denyAuthorization(input.authorizationId);
    if (denied.error || !denied.data) {
      throw new Error("Failed to deny OAuth authorization request.");
    }
    return parseRedirectUrl(denied.data);
  }

  const admin = input.admin;
  if (!admin) {
    throw new Error("OAuth grant administration is unavailable.");
  }

  const requestedProfile = input.permissionProfile
    ? parsePermissionProfile(input.permissionProfile)
    : "read_only" as const;

  const writesEnabled = process.env.MCP_WRITES_ENABLED === "true";
  const effectiveProfile =
    requestedProfile === "workspace_manager" && !writesEnabled
      ? "read_only" as const
      : requestedProfile;

  await activateGrant(admin, {
    ownerUserId: input.ownerUserId,
    oauthClientId: details.clientId,
    clientName: details.clientName,
    resourceUri: input.resourceUri,
    permissionProfile: effectiveProfile,
  });

  const approved = await input.oauth.approveAuthorization(input.authorizationId);
  if (approved.error || !approved.data) {
    try {
      await failGrant(admin, {
        ownerUserId: input.ownerUserId,
        oauthClientId: details.clientId,
      });
    } catch {
      // Preserve the stable provider-facing error. The failed compensation is
      // observable through server logs and must not expose database details.
    }
    throw new Error("Failed to approve OAuth authorization request.");
  }

  try {
    return parseRedirectUrl(approved.data);
  } catch {
    try {
      await failGrant(admin, {
        ownerUserId: input.ownerUserId,
        oauthClientId: details.clientId,
      });
    } catch {
      // Preserve the stable response-validation error.
    }
    throw new Error("Invalid OAuth authorization response.");
  }
}
