export const MCP_PERMISSION_PROFILES = [
  "read_only",
  "task_manager",
  "workspace_manager",
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
};

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
