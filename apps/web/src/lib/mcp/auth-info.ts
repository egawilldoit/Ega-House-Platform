import type { AuthInfo } from "@modelcontextprotocol/server";

import {
  MCP_PERMISSION_PROFILES,
  MCP_PERMISSIONS,
  isKnownPermissionVersion,
  type McpPermission,
  type McpPermissionProfile,
} from "@/lib/mcp/permissions";
import { isValidMcpPrincipal, type McpPrincipal } from "@/lib/mcp/principal";

export const MCP_AUTHORIZED_SCOPE = "ega.mcp.authorized";

function clonePrincipal(principal: McpPrincipal): McpPrincipal {
  return {
    ...principal,
    permissions: [...principal.permissions],
  };
}

/**
 * Structural pre-check only. It deliberately does NOT validate the permission
 * set against the principal's (profile, version) document - that is
 * `isValidMcpPrincipal`'s job, and duplicating it here is how the two
 * validators drifted apart before: `requireMcpPermission` authorized on this
 * weaker one while tool discovery used the stronger one, so a principal
 * carrying a permission set outside its profile passed authorization but failed
 * discovery.
 */
function isMcpPrincipalShape(value: unknown): value is McpPrincipal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const principal = value as Record<string, unknown>;
  return (
    typeof principal.ownerUserId === "string"
    && principal.ownerUserId !== ""
    && typeof principal.oauthClientId === "string"
    && principal.oauthClientId !== ""
    && typeof principal.grantId === "string"
    && principal.grantId !== ""
    && MCP_PERMISSION_PROFILES.includes(
      principal.permissionProfile as McpPermissionProfile,
    )
    && isKnownPermissionVersion(principal.permissionsVersion)
    && Array.isArray(principal.permissions)
    && principal.permissions.every(
      (permission) =>
        typeof permission === "string"
        && MCP_PERMISSIONS.includes(permission as McpPermission),
    )
  );
}

export function createMcpAuthInfo(
  accessToken: string,
  principal: McpPrincipal,
  expiresAt?: number,
): AuthInfo {
  const authInfo: AuthInfo = {
    token: accessToken,
    clientId: principal.oauthClientId,
    scopes: [MCP_AUTHORIZED_SCOPE, ...principal.permissions],
    extra: {
      principal: clonePrincipal(principal),
    },
  };

  if (expiresAt !== undefined) {
    authInfo.expiresAt = expiresAt;
  }

  return authInfo;
}

export function readPrincipalFromAuthInfo(authInfo: AuthInfo): McpPrincipal {
  const principal = authInfo.extra?.principal;
  // Authorisation uses the same strong validator as tool discovery, so a
  // permission set that is merely well-formed but outside its own
  // (profile, version) document is rejected everywhere rather than only at
  // discovery.
  if (!isMcpPrincipalShape(principal) || !isValidMcpPrincipal(principal)) {
    throw new Error("Missing EGA MCP principal in auth context.");
  }

  return clonePrincipal(principal);
}
