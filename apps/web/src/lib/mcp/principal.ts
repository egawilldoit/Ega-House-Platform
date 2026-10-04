import {
  getPermissionsForProfile,
  parsePermissionProfile,
  parsePermissionVersion,
  type McpPermission,
  type McpPermissionProfile,
  type McpPermissionVersion,
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
  permissionsVersion: McpPermissionVersion;
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

export function isValidMcpPrincipal(value: unknown): value is McpPrincipal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const principal = value as Record<string, unknown>;
  if (
    typeof principal.ownerUserId !== "string" || principal.ownerUserId.trim() === ""
    || typeof principal.oauthClientId !== "string" || principal.oauthClientId.trim() === ""
    || typeof principal.grantId !== "string" || principal.grantId.trim() === ""
  ) return false;

  try {
    const profile = parsePermissionProfile(principal.permissionProfile);
    const version = parsePermissionVersion(principal.permissionsVersion);
    return permissionsMatchProfile(
      principal.permissions,
      getPermissionsForProfile(profile, version),
    );
  } catch {
    // Includes an invalid (profile, version) pairing, not just an unknown
    // profile or version.
    return false;
  }
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

  // An unknown permissions_version fails closed. It used to be validated only
  // as "integer >= 1", which meant a row claiming a future or foreign version
  // authenticated normally and propagated an unvalidated version into the MRTR
  // confirmation binding.
  let permissionsVersion: McpPermissionVersion;
  try {
    permissionsVersion = parsePermissionVersion(grant.permissionsVersion);
  } catch {
    return denyInactiveGrant();
  }

  let permissionProfile: McpPermissionProfile;
  try {
    permissionProfile = parsePermissionProfile(grant.permissionProfile);
  } catch {
    return denyInactiveGrant();
  }

  // Authority comes from the grant's own (profile, version) document, not from
  // whatever the profile happens to contain today. A permissions_version 1 row
  // keeps exactly the 14 permissions it was approved for.
  let permissions: McpPermission[];
  try {
    permissions = getPermissionsForProfile(permissionProfile, permissionsVersion);
  } catch {
    // An invalid (profile, version) pairing is a fail-closed deny, never a
    // thrown internal error: there is no document that authorises it.
    return denyInactiveGrant();
  }
  if (!permissionsMatchProfile(grant.permissions, permissions)) {
    return denyInactiveGrant();
  }

  return {
    ownerUserId,
    oauthClientId,
    grantId: grant.id,
    permissionProfile,
    permissionsVersion,
    permissions,
  };
}
