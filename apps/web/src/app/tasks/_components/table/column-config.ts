import {
  DEFAULT_TASK_SORT,
  TASK_SORT_DEFINITIONS,
  type TaskSortDirection,
  type TaskSortField,
  type TaskSortValue,
  type TaskTableColumnId,
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
export const TASK_TABLE_COLUMN_SORT_FIELD: Partial<Record<TaskTableColumnId, TaskSortField>> = {
  task: "title",
  priority: "priority",
  due: "due",
  status: "status",
  estimate: "estimate",
};

const DEFAULT_SORT_DIRECTION_BY_FIELD: Record<TaskSortField, TaskSortDirection> = {
  title: "asc",
  due: "asc",
  priority: "desc",
  status: "asc",
  estimate: "asc",
  updated: "desc",
};

export function taskSortValueFor(
  field: TaskSortField,
  direction: TaskSortDirection,
): TaskSortValue {
  for (const [value, definition] of Object.entries(TASK_SORT_DEFINITIONS)) {
    if (definition.field === field && definition.direction === direction) {
      return value as TaskSortValue;
    }
  }
  return DEFAULT_TASK_SORT;
}

export function taskSortDirectionFor(
  sort: TaskSortValue,
  field: TaskSortField,
): TaskSortDirection | null {
  const definition = TASK_SORT_DEFINITIONS[sort];
  return definition.field === field ? definition.direction : null;
}

/**
 * The next header-click sort. Clicking the active field flips direction;
 * clicking a new field uses its natural direction (priority high→low first,
 * dates/titles/estimates ascending first).
 */
export function nextTaskSortValue(
  current: TaskSortValue,
  field: TaskSortField,
): TaskSortValue {
  const currentDefinition = TASK_SORT_DEFINITIONS[current];
  if (currentDefinition.field === field) {
    return taskSortValueFor(
      field,
      currentDefinition.direction === "asc" ? "desc" : "asc",
    );
  }
  return taskSortValueFor(field, DEFAULT_SORT_DIRECTION_BY_FIELD[field]);
}
