import {
  getDefaultTaskViewSortDirection,
  type TaskTableColumnId,
  type TaskViewSortDirection,
  type TaskViewSortKey,
} from "@ega/contracts/common/task-list";

export const TASK_TABLE_COLUMN_LABELS: Record<TaskTableColumnId, string> = {
  task: "Task",
  project: "Project",
  priority: "Priority",
  due: "Due",
  status: "Status",
  estimate: "Estimate",
};

/** Columns that can drive the shared header sort; project has no sort key. */
export const TASK_TABLE_COLUMN_SORT_FIELD: Partial<Record<TaskTableColumnId, TaskViewSortKey>> = {
  task: "title",
  priority: "priority",
  due: "due",
  status: "status",
  estimate: "estimate",
};

export type TaskViewSort = {
  key: TaskViewSortKey;
  direction: TaskViewSortDirection;
};

/**
 * The next header-click sort, using the canonical view sort semantics.
 * Clicking the active field flips direction; a new field uses the same default
 * direction the toolbar's sort control uses.
 */
export function nextTaskViewSort(
  current: TaskViewSort,
  field: TaskViewSortKey,
): TaskViewSort {
  if (current.key === field) {
    return { key: field, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key: field, direction: getDefaultTaskViewSortDirection(field) };
}
