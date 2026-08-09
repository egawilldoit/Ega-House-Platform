export const TASK_VIEW_VALUES = ["active", "archived", "all"] as const;

export type TaskViewFilter = (typeof TASK_VIEW_VALUES)[number];

export function normalizeTaskViewFilter(value: string | null | undefined): TaskViewFilter {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "archived") {
    return "archived";
  }

  if (normalized === "all") {
    return "all";
  }

  return "active";
}

export function isTaskArchived(archivedAt: string | null | undefined) {
  return Boolean(archivedAt);
}
