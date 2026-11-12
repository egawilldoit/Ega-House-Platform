import type { McpPermission } from "@/lib/mcp/permissions";

export type McpToolDefinition = {
  name: string;
  requiredPermission?: McpPermission;
  /** Tool is advertised to every authenticated principal regardless of permissions (e.g. capabilities metadata). */
  alwaysAllowed?: boolean;
  writesEnabledRequired?: boolean;
};

/**
 * Canonical MCP tool catalog. Delivery reads are intentionally EXCLUDED:
 * delivery run state lives in the automation/Runner control-plane database,
 * outside the workspace Supabase RLS scope an MCP bearer token can reach.
 */
const ALL_TOOLS: readonly McpToolDefinition[] = [
  { name: "ega_get_capabilities", alwaysAllowed: true },
  // Reads
  { name: "ega_list_projects", requiredPermission: "projects.read" },
  { name: "ega_get_task", requiredPermission: "tasks.read" },
  { name: "ega_list_goals", requiredPermission: "goals.read" },
  { name: "ega_list_tasks", requiredPermission: "tasks.read" },
  { name: "ega_get_today_plan", requiredPermission: "today.read" },
  { name: "ega_list_timer_sessions", requiredPermission: "timer.read" },
  // Personal Operations reads (PO-13): explicit grants only, no inherit from
  // legacy profiles.
  { name: "ega_personal_ops_summary", requiredPermission: "personal_ops.read" },
  { name: "ega_personal_ops_expenses_list", requiredPermission: "personal_ops.read" },
  { name: "ega_personal_ops_checkin_get", requiredPermission: "personal_ops.read" },
  // Canonical Money reads (MONEY-02). Compatibility names above stay listed.
  { name: "ega_money_get", requiredPermission: "personal_ops.read" },
  { name: "ega_money_ledger_list", requiredPermission: "personal_ops.read" },
  // Money period context (MONEY-03): explicit finance read grant only.
  { name: "ega_money_state", requiredPermission: "personal_ops.read" },
  // Money movements (MONEY-04): a distinct read/write family, never a rename
  // of the expense reads above.
  { name: "ega_money_movement_list", requiredPermission: "personal_ops.read" },
  { name: "ega_money_movement_get", requiredPermission: "personal_ops.read" },
  // Budgets/categories/counted coffee (MONEY-05): names never collide with the
  // expense, state or movement tools above.
  { name: "ega_money_budget_get", requiredPermission: "personal_ops.read" },
  { name: "ega_money_coffee_window", requiredPermission: "personal_ops.read" },
  { name: "ega_money_coffee_visits_list", requiredPermission: "personal_ops.read" },
  // Money obligation reads (MONEY-06): bills and subscriptions share rows.
  { name: "ega_money_obligations_list", requiredPermission: "personal_ops.read" },
  { name: "ega_money_obligation_get", requiredPermission: "personal_ops.read" },
  { name: "ega_money_obligation_templates_list", requiredPermission: "personal_ops.read" },
  { name: "ega_money_obligation_summary", requiredPermission: "personal_ops.read" },
  // Personal Operations writes: explicit writer grant, never auto-upgraded.
  { name: "ega_create_personal_ops_expense", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_save_personal_ops_checkin", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  // Canonical Money writes (MONEY-02).
  { name: "ega_money_create_expense", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_update_expense", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_delete_expense", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  // Money settings (MONEY-03).
  { name: "ega_money_update_settings", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  // Money movement writes (MONEY-04).
  { name: "ega_money_create_movement", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_update_movement", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  // Budget/category/counted-coffee writes (MONEY-05).
  { name: "ega_money_set_allocation", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_classify_expense", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_record_coffee_visit", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_delete_coffee_visit", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  // Money obligation writes (MONEY-06): scheduling/cancelling never posts cash.
  { name: "ega_money_create_obligation", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_update_obligation", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_transition_obligation", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_create_obligation_template", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_update_obligation_template", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_generate_obligations", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  // Money obligation payments (MONEY-07): one atomic payment, correction or
  // undo; the operation id is the retry identity of the write.
  { name: "ega_money_pay_obligation", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_correct_obligation_payment", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  { name: "ega_money_undo_obligation_payment", requiredPermission: "personal_ops.write", writesEnabledRequired: true },
  // Project writes
  { name: "ega_create_project", requiredPermission: "projects.create", writesEnabledRequired: true },
  { name: "ega_update_project_status", requiredPermission: "projects.update", writesEnabledRequired: true },
  { name: "ega_archive_project", requiredPermission: "projects.update", writesEnabledRequired: true },
  { name: "ega_unarchive_project", requiredPermission: "projects.update", writesEnabledRequired: true },
  // Goal writes
  { name: "ega_create_goal", requiredPermission: "goals.create", writesEnabledRequired: true },
  { name: "ega_update_goal_status", requiredPermission: "goals.update", writesEnabledRequired: true },
  { name: "ega_update_goal_health", requiredPermission: "goals.update", writesEnabledRequired: true },
  { name: "ega_update_goal_next_step", requiredPermission: "goals.update", writesEnabledRequired: true },
  { name: "ega_archive_goal", requiredPermission: "goals.update", writesEnabledRequired: true },
  { name: "ega_unarchive_goal", requiredPermission: "goals.update", writesEnabledRequired: true },
  // Task writes
  { name: "ega_create_task", requiredPermission: "tasks.create", writesEnabledRequired: true },
  { name: "ega_update_task", requiredPermission: "tasks.update", writesEnabledRequired: true },
  { name: "ega_archive_task", requiredPermission: "tasks.update", writesEnabledRequired: true },
  { name: "ega_unarchive_task", requiredPermission: "tasks.update", writesEnabledRequired: true },
  { name: "ega_set_task_focus_rank", requiredPermission: "tasks.update", writesEnabledRequired: true },
  { name: "ega_create_task_reminder", requiredPermission: "tasks.update", writesEnabledRequired: true },
  { name: "ega_cancel_task_reminder", requiredPermission: "tasks.update", writesEnabledRequired: true },
  // Today writes (projection over tasks)
  { name: "ega_plan_task_for_today", requiredPermission: "today.update", writesEnabledRequired: true },
  { name: "ega_remove_task_from_today", requiredPermission: "today.update", writesEnabledRequired: true },
  { name: "ega_update_today_task_status", requiredPermission: "today.update", writesEnabledRequired: true },
  { name: "ega_clear_completed_today", requiredPermission: "today.update", writesEnabledRequired: true },
  // Timer writes
  { name: "ega_start_timer", requiredPermission: "timer.create", writesEnabledRequired: true },
  { name: "ega_stop_timer", requiredPermission: "timer.update", writesEnabledRequired: true },
];

export function filterToolsByPermissions(
  permissions: readonly McpPermission[],
  writesEnabled: boolean,
): string[] {
  return ALL_TOOLS.filter((tool) => {
    if (tool.writesEnabledRequired && !writesEnabled) return false;
    if (tool.alwaysAllowed) return true;
    return tool.requiredPermission !== undefined && permissions.includes(tool.requiredPermission);
  }).map((tool) => tool.name);
}

export function getAllToolNames(): string[] {
  return ALL_TOOLS.map((t) => t.name);
}
