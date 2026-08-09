export const TASK_DUE_FILTER_VALUES = [
  "all",
  "overdue",
  "due_today",
  "due_soon",
  "no_due_date",
] as const;

export const TASK_SORT_VALUES = [
  "updated_desc",
  "due_date_asc",
  "due_date_desc",
] as const;

export const DEFAULT_TASK_DUE_FILTER = "all" as const;
export const DEFAULT_TASK_SORT = "updated_desc" as const;

export type TaskDueFilter = (typeof TASK_DUE_FILTER_VALUES)[number];
export type TaskSortValue = (typeof TASK_SORT_VALUES)[number];

export function isTaskDueFilter(value: string): value is TaskDueFilter {
  return TASK_DUE_FILTER_VALUES.includes(value as TaskDueFilter);
}

export function isTaskSortValue(value: string): value is TaskSortValue {
  return TASK_SORT_VALUES.includes(value as TaskSortValue);
}
