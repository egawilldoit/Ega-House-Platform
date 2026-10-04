export const MCP_PERMISSION_PROFILES = [
  "read_only",
  "task_manager",
  "workspace_manager",
] as const;

export type McpPermissionProfile = (typeof MCP_PERMISSION_PROFILES)[number];

/**
 * The permission universe. Membership here is not authority: a permission only
 * grants anything to a grant whose stored document contains it, and the stored
 * document is pinned to (profile, permissions_version) by the database CHECK
 * constraint in drizzle/0066_mcp_permission_version_2.sql.
 */
export const MCP_PERMISSIONS = [
  // permissions_version 1
  "projects.read",
  "projects.create",
  "projects.update",
  "goals.read",
  "goals.create",
  "goals.update",
  "tasks.read",
  "tasks.create",
  "tasks.update",
  "today.read",
  "today.update",
  "timer.read",
  "timer.create",
  "timer.update",
  // added by permissions_version 2 - read-only, additive
  "friction.read",
  "inbox.read",
  "notifications.read",
  "operator.read",
  "workload.read",
] as const;

export type McpPermission = (typeof MCP_PERMISSIONS)[number];

/**
 * Versioned permission documents.
 *
 * A grant's authority is its stored `permissions` array, and that array is only
 * valid for one (profile, version) pair. This is what makes capability growth
 * safe: a permissions_version 1 row keeps exactly the 14 permissions it was
 * approved for, forever, and a permissions_version 2 row is a different,
 * separately consented document. The previous model instead recomputed the
 * expected set from the CURRENT contents of a profile and demanded exact
 * equality, so adding one permission failed every existing connection closed
 * while leaving the grant row status='active' - unrecoverable in-app, because
 * the exact-array CHECK also rejected the re-consent that would fix it.
 */
export const MCP_PERMISSION_VERSIONS = [1, 2] as const;

export type McpPermissionVersion = (typeof MCP_PERMISSION_VERSIONS)[number];

/**
 * The version written for newly consented grants.
 *
 * DELIBERATELY STILL 1. `permissions_version 2` is defined and understood - the
 * resolver authenticates a v2 row against its own frozen document, and the
 * database already constrains v2 documents (drizzle/0066) - but it is not
 * *issued* yet. Issuing v2 before the v2 capability set is complete would let a
 * consent screen promise authority that has no tool behind it, and would freeze
 * a document that later additions would then have to mutate. The switch to 2
 * happens once, in the same wave that ships the v2 tools.
 *
 * Version documents are immutable once issued. Authority beyond the frozen
 * document is v3, never an edit to v2 - see drizzle/0066.
 */
export const CURRENT_MCP_PERMISSION_VERSION: McpPermissionVersion = 1;

/** Permissions every version 2 document adds. Strictly additive by policy. */
const V2_ADDITIVE_PERMISSIONS = [
  "friction.read",
  "inbox.read",
  "notifications.read",
  "operator.read",
  "workload.read",
] as const satisfies readonly McpPermission[];

const PROFILE_V1_PERMISSIONS: Readonly<
  Record<McpPermissionProfile, readonly McpPermission[]>
> = {
  read_only: [
    "projects.read",
    "goals.read",
    "tasks.read",
    "today.read",
    "timer.read",
  ],
  task_manager: [
    "projects.read",
    "goals.read",
    "tasks.read",
    "tasks.create",
    "tasks.update",
    "today.read",
    "timer.read",
  ],
  workspace_manager: [
    "projects.read",
    "projects.create",
    "projects.update",
    "goals.read",
    "goals.create",
    "goals.update",
    "tasks.read",
    "tasks.create",
    "tasks.update",
    "today.read",
    "today.update",
    "timer.read",
    "timer.create",
    "timer.update",
  ],
};

/**
 * Documents are PARTIAL on purpose: a (profile, version) pair with no entry is
 * an invalid pairing and fails closed rather than silently resolving.
 *
 * `task_manager` is the example. The consent screen has only ever offered
 * read_only and workspace_manager, so task_manager is a legacy profile that
 * stays representable at the version it was defined under and gains no new
 * version until something actually issues one. Defining a v2 document for it
 * would add database surface for an unissuable combination and would make
 * "invalid profile/version pairing fails closed" untestable, because there would
 * be no invalid pairing left.
 */
type PermissionDocuments = Readonly<
  Record<McpPermissionProfile, Readonly<Partial<Record<McpPermissionVersion, readonly McpPermission[]>>>>
>;

const PERMISSION_DOCUMENTS: PermissionDocuments = {
  read_only: {
    1: PROFILE_V1_PERMISSIONS.read_only,
    2: [...PROFILE_V1_PERMISSIONS.read_only, ...V2_ADDITIVE_PERMISSIONS],
  },
  task_manager: {
    1: PROFILE_V1_PERMISSIONS.task_manager,
  },
  workspace_manager: {
    1: PROFILE_V1_PERMISSIONS.workspace_manager,
    2: [...PROFILE_V1_PERMISSIONS.workspace_manager, ...V2_ADDITIVE_PERMISSIONS],
  },
};

export function isSupportedPermissionDocument(
  profile: McpPermissionProfile,
  version: McpPermissionVersion,
): boolean {
  return PERMISSION_DOCUMENTS[profile][version] !== undefined;
}

export function parsePermissionProfile(value: unknown): McpPermissionProfile {
  if (
    typeof value === "string"
    && MCP_PERMISSION_PROFILES.includes(value as McpPermissionProfile)
  ) {
    return value as McpPermissionProfile;
  }

  throw new Error("Unsupported MCP permission profile.");
}

export function isKnownPermissionVersion(value: unknown): value is McpPermissionVersion {
  return (
    typeof value === "number"
    && MCP_PERMISSION_VERSIONS.includes(value as McpPermissionVersion)
  );
}

/** Throws for any version this build does not implement, so it fails closed. */
export function parsePermissionVersion(value: unknown): McpPermissionVersion {
  if (isKnownPermissionVersion(value)) return value;

  throw new Error("Unsupported MCP permission version.");
}

/** Throws for an invalid (profile, version) pairing so callers fail closed. */
export function getPermissionsForProfile(
  profile: McpPermissionProfile,
  version: McpPermissionVersion = CURRENT_MCP_PERMISSION_VERSION,
): McpPermission[] {
  const document = PERMISSION_DOCUMENTS[profile][version];
  if (!document) {
    throw new Error("Unsupported MCP permission document.");
  }
  return [...document];
}

export function getCurrentPermissionsForProfile(
  profile: McpPermissionProfile,
): McpPermission[] {
  return getPermissionsForProfile(profile, CURRENT_MCP_PERMISSION_VERSION);
}

/** Every profile/version pair this build can authorise. */
export function listPermissionDocuments(): ReadonlyArray<{
  profile: McpPermissionProfile;
  version: McpPermissionVersion;
  permissions: readonly McpPermission[];
}> {
  return MCP_PERMISSION_PROFILES.flatMap((profile) =>
    MCP_PERMISSION_VERSIONS.flatMap((version) => {
      const document = PERMISSION_DOCUMENTS[profile][version];
      return document ? [{ profile, version, permissions: document }] : [];
    }),
  );
}

/** Every (profile, version) pairing this build refuses. */
export function listUnsupportedPermissionDocuments(): ReadonlyArray<{
  profile: McpPermissionProfile;
  version: McpPermissionVersion;
}> {
  return MCP_PERMISSION_PROFILES.flatMap((profile) =>
    MCP_PERMISSION_VERSIONS
      .filter((version) => !isSupportedPermissionDocument(profile, version))
      .map((version) => ({ profile, version })),
  );
}

export function hasMcpPermission(
  permissions: readonly McpPermission[],
  requiredPermission: string,
): boolean {
  return permissions.some((permission) => permission === requiredPermission);
}
