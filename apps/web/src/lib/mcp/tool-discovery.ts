import type { McpPermission } from "@/lib/mcp/permissions";

export type McpToolDefinition = {
  name: string;
  requiredPermission: McpPermission;
  writesEnabledRequired?: boolean;
};

const ALL_TOOLS: readonly McpToolDefinition[] = [
  { name: "ega_get_capabilities", requiredPermission: "projects.read" },
  { name: "ega_list_projects", requiredPermission: "projects.read" },
  { name: "ega_list_goals", requiredPermission: "goals.read" },
  { name: "ega_list_tasks", requiredPermission: "tasks.read" },
  { name: "ega_get_task", requiredPermission: "tasks.read" },
  { name: "ega_get_today_plan", requiredPermission: "today.read" },
  { name: "ega_list_timer_sessions", requiredPermission: "timer.read" },
  { name: "ega_create_project", requiredPermission: "projects.create", writesEnabledRequired: true },
  { name: "ega_update_project_status", requiredPermission: "projects.update", writesEnabledRequired: true },
  { name: "ega_create_goal", requiredPermission: "goals.create", writesEnabledRequired: true },
  { name: "ega_create_task", requiredPermission: "tasks.create", writesEnabledRequired: true },
  { name: "ega_update_task", requiredPermission: "tasks.update", writesEnabledRequired: true },
  { name: "ega_plan_task_for_today", requiredPermission: "today.update", writesEnabledRequired: true },
  { name: "ega_start_timer", requiredPermission: "timer.create", writesEnabledRequired: true },
  { name: "ega_stop_timer", requiredPermission: "timer.update", writesEnabledRequired: true },
  { name: "ega_clear_completed_today", requiredPermission: "today.update", writesEnabledRequired: true },
];

export function filterToolsByPermissions(
  permissions: readonly McpPermission[],
  writesEnabled: boolean,
): string[] {
  return ALL_TOOLS.filter((tool) => {
    if (tool.writesEnabledRequired && !writesEnabled) return false;
    return permissions.includes(tool.requiredPermission);
  }).map((tool) => tool.name);
}

export function getAllToolNames(): string[] {
  return ALL_TOOLS.map((t) => t.name);
}
