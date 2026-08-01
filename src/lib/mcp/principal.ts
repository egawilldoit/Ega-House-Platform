import {
  getPermissionsForProfile,
  parsePermissionProfile,
  type McpPermission,
  type McpPermissionProfile,
} from "@/lib/mcp/permissions";

export type McpGrantStatus = "pending" | "active" | "failed" | "revoked";

export type McpGrantRecord = {
  id: string;
  ownerUserId: string;
  oauthClientId: string;
  resourceUri: string;
  status: McpGrantStatus;
  permissionProfile: string;
  permissions: unknown;
  permissionsVersion: number;
};

export type McpPrincipal = {
  ownerUserId: string;
  oauthClientId: string;
  grantId: string;
  permissionProfile: McpPermissionProfile;
  permissionsVersion: number;
  permissions: McpPermission[];
};

export type McpAuthorizationErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED";

export class McpAuthorizationError extends Error {
  readonly code: McpAuthorizationErrorCode;
  readonly status: 401 | 403;

  constructor(
    code: McpAuthorizationErrorCode,
    status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "McpAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

function requireStringClaim(
  claims: Record<string, unknown>,
  claimName: "sub" | "client_id",
): string {
  const value = claims[claimName];

  if (typeof value !== "string" || value.trim() === "") {
    throw new McpAuthorizationError(
      "UNAUTHENTICATED",
      401,
      `Missing or invalid ${claimName} claim.`,
    );
  }

  return value;
}

function denyInactiveGrant(): never {
  throw new McpAuthorizationError(
    "PERMISSION_DENIED",
    403,
    "No active EGA MCP authorization grant.",
  );
}

function permissionsMatchProfile(
  storedPermissions: unknown,
  expectedPermissions: readonly McpPermission[],
): boolean {
  if (
    !Array.isArray(storedPermissions)
    || !storedPermissions.every((permission) => typeof permission === "string")
  ) {
    return false;
  }

  const uniquePermissions = new Set(storedPermissions);
  if (
    uniquePermissions.size !== storedPermissions.length
    || uniquePermissions.size !== expectedPermissions.length
  ) {
    return false;
  }

  return expectedPermissions.every((permission) =>
    uniquePermissions.has(permission),
  );
}

export function resolveMcpPrincipal(
  claims: Record<string, unknown>,
  grant: McpGrantRecord | null,
): McpPrincipal {
  const ownerUserId = requireStringClaim(claims, "sub");
  const oauthClientId = requireStringClaim(claims, "client_id");

  if (!grant || grant.status !== "active") {
    return denyInactiveGrant();
  }

  if (
    grant.ownerUserId !== ownerUserId
    || grant.oauthClientId !== oauthClientId
    || typeof grant.resourceUri !== "string"
    || grant.resourceUri.trim() === ""
  ) {
    return denyInactiveGrant();
  }

  if (
    !Number.isInteger(grant.permissionsVersion)
    || grant.permissionsVersion < 1
  ) {
    return denyInactiveGrant();
  }

  let permissionProfile: McpPermissionProfile;
  try {
    permissionProfile = parsePermissionProfile(grant.permissionProfile);
  } catch {
    return denyInactiveGrant();
  }

  const permissions = getPermissionsForProfile(permissionProfile);
  if (!permissionsMatchProfile(grant.permissions, permissions)) {
    return denyInactiveGrant();
  }

  return {
    ownerUserId,
    oauthClientId,
    grantId: grant.id,
    permissionProfile,
    permissionsVersion: grant.permissionsVersion,
    permissions,
  };
}
