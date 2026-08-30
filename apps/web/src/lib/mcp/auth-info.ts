import type { AuthInfo } from "@modelcontextprotocol/server";

import {
  MCP_PERMISSION_PROFILES,
  MCP_PERMISSIONS,
  type McpPermission,
  type McpPermissionProfile,
} from "@/lib/mcp/permissions";
import type { McpPrincipal } from "@/lib/mcp/principal";

export const MCP_AUTHORIZED_SCOPE = "ega.mcp.authorized";

function clonePrincipal(principal: McpPrincipal): McpPrincipal {
  return {
    ...principal,
    permissions: [...principal.permissions],
  };
}

function isMcpPrincipal(value: unknown): value is McpPrincipal {
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
    && Number.isInteger(principal.permissionsVersion)
    && (principal.permissionsVersion as number) > 0
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
  if (!isMcpPrincipal(principal)) {
    throw new Error("Missing EGA MCP principal in auth context.");
  }

  return clonePrincipal(principal);
}
