import type { McpPermission } from "@/lib/mcp/permissions";

/**
 * Canonical MCP capability registry.
 *
 * Before this existed the catalog was asserted twice by hand - once in
 * tool-discovery.ts and once as 30 registerTool calls in server.ts - with the
 * permission requirement, the MCP annotation set, the audit identity and the
 * rate class all living in separate places that nothing tied together. A rename
 * in one list silently de-advertised a tool; an annotation could drift from the
 * behaviour it described.
 *
 * This registry is the one place that states, per capability: which
 * permissions authorise it, whether it mutates, whether it is destructive, how
 * it is rate limited, and whether it needs user confirmation. Tool discovery,
 * registration eligibility and tool annotations are derived from it. Zod
 * schemas and handlers stay next to their operation, and the database
 * permissions CHECK remains explicit reviewed SQL - the registry is the
 * runtime authority, not a migration generator.
 */

export type McpDomain =
  | "capabilities"
  | "projects"
  | "goals"
  | "tasks"
  | "today"
  | "timer"
  | "friction"
  | "workload"
  | "operator"
  | "inbox"
  | "notifications";

export type McpPrimitive = "read" | "write";

export type McpRateClass =
  /** Cheap, repeatable, derived data. */
  | "read"
  /** Owner-scoped state change, naturally idempotent or receipted. */
  | "write"
  /** Lifecycle or external-effecting change where a mistake is costly. */
  | "sensitive_write";

export type McpConfirmationClass =
  | "none"
  | "required";

/**
 * `one` is modelled as a single-element `allOf`; the variants exist because the
 * two are genuinely different to read, not to evaluate.
 */
export type McpPermissionRequirement =
  | { readonly kind: "always" }
  | { readonly kind: "allOf"; readonly permissions: readonly McpPermission[] }
  | { readonly kind: "anyOf"; readonly permissions: readonly McpPermission[] };

export type McpCapability = {
  readonly name: string;
  readonly domain: McpDomain;
  readonly primitive: McpPrimitive;
  readonly permissionRequirement: McpPermissionRequirement;
  readonly mutation: boolean;
  readonly destructive: boolean;
  readonly idempotent: boolean;
  readonly writesEnabledRequired: boolean;
  readonly rateClass: McpRateClass;
  readonly confirmationClass: McpConfirmationClass;
};

function one(permission: McpPermission): McpPermissionRequirement {
  return { kind: "allOf", permissions: [permission] };
}

function read(
  name: string,
  domain: McpDomain,
  permissionRequirement: McpPermissionRequirement,
): McpCapability {
  return {
    name,
    domain,
    primitive: "read",
    permissionRequirement,
    mutation: false,
    destructive: false,
    idempotent: true,
    writesEnabledRequired: false,
    rateClass: "read",
    confirmationClass: "none",
  };
}

function write(
  name: string,
  domain: McpDomain,
  permissionRequirement: McpPermissionRequirement,
  options: {
    destructive?: boolean;
    rateClass?: McpRateClass;
    confirmationClass?: McpConfirmationClass;
  } = {},
): McpCapability {
  return {
    name,
    domain,
    primitive: "write",
    permissionRequirement,
    mutation: true,
    destructive: options.destructive ?? false,
    idempotent: !options.destructive,
    writesEnabledRequired: true,
    rateClass: options.rateClass ?? "write",
    confirmationClass: options.confirmationClass ?? "none",
  };
}

/**
 * Delivery reads are intentionally EXCLUDED: delivery run state lives in the
 * automation/Runner control-plane database, outside the workspace Supabase RLS
 * scope an MCP bearer token can reach.
 */
export const MCP_CAPABILITIES: readonly McpCapability[] = [
  read("ega_get_capabilities", "capabilities", { kind: "always" }),

  // ---- permissions_version 1 reads -------------------------------------
  read("ega_list_projects", "projects", one("projects.read")),
  read("ega_get_task", "tasks", one("tasks.read")),
  read("ega_list_goals", "goals", one("goals.read")),
  read("ega_list_tasks", "tasks", one("tasks.read")),
  read("ega_get_today_plan", "today", one("today.read")),
  read("ega_list_timer_sessions", "timer", one("timer.read")),

  // ---- permissions_version 1 writes -------------------------------------
  write("ega_create_project", "projects", one("projects.create")),
  write("ega_update_project_status", "projects", one("projects.update")),
  write("ega_archive_project", "projects", one("projects.update"), { destructive: true }),
  write("ega_unarchive_project", "projects", one("projects.update")),
  write("ega_create_goal", "goals", one("goals.create")),
  write("ega_update_goal_status", "goals", one("goals.update")),
  write("ega_update_goal_health", "goals", one("goals.update")),
  write("ega_update_goal_next_step", "goals", one("goals.update")),
  write("ega_archive_goal", "goals", one("goals.update"), { destructive: true }),
  write("ega_unarchive_goal", "goals", one("goals.update")),
  write("ega_create_task", "tasks", one("tasks.create")),
  write("ega_update_task", "tasks", one("tasks.update")),
  write("ega_archive_task", "tasks", one("tasks.update"), { destructive: true }),
  write("ega_unarchive_task", "tasks", one("tasks.update")),
  write("ega_set_task_focus_rank", "tasks", one("tasks.update")),
  write("ega_create_task_reminder", "tasks", one("tasks.update")),
  write("ega_cancel_task_reminder", "tasks", one("tasks.update"), { destructive: true }),
  write("ega_plan_task_for_today", "today", one("today.update")),
  write("ega_remove_task_from_today", "today", one("today.update")),
  write("ega_update_today_task_status", "today", one("today.update")),
  write("ega_clear_completed_today", "today", one("today.update"), {
    destructive: true,
    rateClass: "sensitive_write",
    confirmationClass: "required",
  }),
  write("ega_start_timer", "timer", one("timer.create")),
  write("ega_stop_timer", "timer", one("timer.update")),
];

/**
 * INVARIANT: this list contains ONLY capabilities that have a real executable
 * implementation - registry entry, Zod schema, handler, application delegation
 * and tests, added in the same wave.
 *
 * `getAllToolNames()`, permission-filtered discovery, `server.ts` registration
 * eligibility, the audit identity set and the database audit allowlist
 * (drizzle/0065) all read from here. So a planned capability appearing here
 * without a handler would advertise something that cannot be invoked, would be
 * authorized-but-invisible to discovery, and would silently widen the
 * auditable surface at the database.
 *
 * New capabilities are therefore added ATOMICALLY:
 *   registry entry + schema + handler + application delegation
 *   + permission requirement + rate class + audit identity + tests
 *
 * The inverse is also load-bearing: a permissions_version 2 permission with no
 * tool behind it is issued to nobody, because it is not part of any issued
 * (profile, version) document while CURRENT_MCP_PERMISSION_VERSION is still 1.
 * See permissions.ts and drizzle/0066.
 */

const CAPABILITY_BY_NAME = new Map(MCP_CAPABILITIES.map((capability) => [capability.name, capability]));

export function getCapability(name: string): McpCapability {
  const capability = CAPABILITY_BY_NAME.get(name);
  if (!capability) {
    throw new Error(`Unknown MCP capability: ${name}`);
  }
  return capability;
}

export function getAllCapabilityNames(): string[] {
  return MCP_CAPABILITIES.map((capability) => capability.name);
}

/**
 * Does this principal's permission set authorise the capability? `always`
 * capabilities are advertised to every authenticated principal.
 */
export function isCapabilityAuthorized(
  capability: McpCapability,
  permissions: readonly McpPermission[],
): boolean {
  const requirement = capability.permissionRequirement;
  if (requirement.kind === "always") return true;

  const held = new Set<string>(permissions);
  if (requirement.kind === "allOf") {
    return requirement.permissions.every((permission) => held.has(permission));
  }
  return requirement.permissions.some((permission) => held.has(permission));
}

export function isCapabilityRegistered(
  capability: McpCapability,
  permissions: readonly McpPermission[],
  writesEnabled: boolean,
): boolean {
  if (capability.writesEnabledRequired && !writesEnabled) return false;
  return isCapabilityAuthorized(capability, permissions);
}

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

/**
 * Derived rather than hand-written. `WRITE_ANNOTATIONS.idempotentHint: true`
 * was previously an assertion about 18 tools that nothing enforced; it is now a
 * fact about the capability, so a tool cannot advertise idempotency it does not
 * have.
 */
export function getCapabilityAnnotations(capability: McpCapability): McpToolAnnotations {
  return {
    readOnlyHint: !capability.mutation,
    destructiveHint: capability.destructive,
    idempotentHint: !capability.mutation || capability.idempotent,
    openWorldHint: false,
  };
}

/** MCP `annotations` must be a plain mutable object for the SDK's schema. */
export function getMutableCapabilityAnnotations(
  capability: McpCapability,
): Record<string, boolean> {
  return { ...getCapabilityAnnotations(capability) };
}
