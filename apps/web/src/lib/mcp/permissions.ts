export const MCP_PERMISSION_PROFILES = [
  "read_only",
  "task_manager",
  "workspace_manager",
  // Versioned finance/routine grants (PO-13, issue #358). These are explicit
  // opt-ins: existing profiles never gain them implicitly, and the app
  // remains the canonical owner of every record.
  "personal_operations",
  "personal_operations_writer",
  // Combined workspace+Money profiles (MONEY-01) so one ChatGPT connection
  // can keep its task/workspace capabilities while reading or writing Money.
  // The reader profile is read-only everywhere; the writer profile matches
  // workspace_manager plus personal_ops.read/write. Neither is implied by an
  // existing workspace grant.
  "workspace_money_reader",
  "workspace_money_writer",
] as const;

export type McpPermissionProfile = (typeof MCP_PERMISSION_PROFILES)[number];

export const MCP_PERMISSIONS = [
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
  "personal_ops.read",
  "personal_ops.write",
] as const;

export type McpPermission = (typeof MCP_PERMISSIONS)[number];

const PROFILE_PERMISSIONS: Readonly<
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
  personal_operations: [
    "today.read",
    "timer.read",
    "personal_ops.read",
  ],
  personal_operations_writer: [
    "today.read",
    "timer.read",
    "personal_ops.read",
    "personal_ops.write",
  ],
  workspace_money_reader: [
    "projects.read",
    "goals.read",
    "tasks.read",
    "today.read",
    "timer.read",
    "personal_ops.read",
  ],
  workspace_money_writer: [
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
    "personal_ops.read",
    "personal_ops.write",
  ],
};

/**
 * Profiles that grant at least one write permission. Consent must not issue
 * these while `MCP_WRITES_ENABLED` is off, even if a crafted request posts the
 * profile name directly; hiding the radio is not an authorization boundary.
 */
export const MCP_WRITE_PROFILES: readonly McpPermissionProfile[] =
  MCP_PERMISSION_PROFILES.filter((profile) =>
    PROFILE_PERMISSIONS[profile].some(
      (permission) =>
        permission.endsWith(".create")
        || permission.endsWith(".update")
        || permission.endsWith(".write"),
    ),
  );

export function profileHasWritePermission(
  profile: McpPermissionProfile,
): boolean {
  return MCP_WRITE_PROFILES.includes(profile);
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

export function getPermissionsForProfile(
  profile: McpPermissionProfile,
): McpPermission[] {
  return [...PROFILE_PERMISSIONS[profile]];
}

export function hasMcpPermission(
  permissions: readonly McpPermission[],
  requiredPermission: string,
): boolean {
  return permissions.some((permission) => permission === requiredPermission);
}
