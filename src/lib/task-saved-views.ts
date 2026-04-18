import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  isTaskDueFilter,
  isTaskSortValue,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { isTaskStatus } from "@/lib/task-domain";

export const MAX_TASK_SAVED_VIEW_NAME_LENGTH = 80;

export type TaskSavedViewFilters = {
  status: string | null;
  projectId: string | null;
  goalId: string | null;
  dueFilter: TaskDueFilter;
  sortValue: TaskSortValue;
};

export function normalizeTaskSavedViewFilters(input: {
  status?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  dueFilter?: string | null;
  sortValue?: string | null;
}): TaskSavedViewFilters {
  const status = String(input.status ?? "").trim();
  const projectId = String(input.projectId ?? "").trim();
  const goalId = String(input.goalId ?? "").trim();
  const dueFilter = String(input.dueFilter ?? "").trim();
  const sortValue = String(input.sortValue ?? "").trim();

  return {
    status: status && isTaskStatus(status) ? status : null,
    projectId: projectId || null,
    goalId: goalId || null,
    dueFilter: isTaskDueFilter(dueFilter) ? dueFilter : DEFAULT_TASK_DUE_FILTER,
    sortValue: isTaskSortValue(sortValue) ? sortValue : DEFAULT_TASK_SORT,
  };
}

export function getTaskSavedViewNameError(name: string) {
  if (!name) {
    return "Saved view name is required.";
  }

  if (name.length > MAX_TASK_SAVED_VIEW_NAME_LENGTH) {
    return `Saved view name must be ${MAX_TASK_SAVED_VIEW_NAME_LENGTH} characters or fewer.`;
  }

  return null;
}

export function areTaskSavedViewFiltersEqual(
  left: TaskSavedViewFilters,
  right: TaskSavedViewFilters,
) {
  return (
    left.status === right.status &&
    left.projectId === right.projectId &&
    left.goalId === right.goalId &&
    left.dueFilter === right.dueFilter &&
    left.sortValue === right.sortValue
  );
}

export function validateTaskSavedViewScope(
  filters: TaskSavedViewFilters,
  scope: {
    projectIds: Set<string>;
    goalsById: Map<string, { id: string; projectId: string }>;
  },
) {
  if (filters.projectId && !scope.projectIds.has(filters.projectId)) {
    return "Selected project is unavailable.";
  }

  if (!filters.goalId) {
    return null;
  }

  const goal = scope.goalsById.get(filters.goalId);

  if (!goal) {
    return "Selected goal is unavailable.";
  }

  if (filters.projectId && goal.projectId !== filters.projectId) {
    return "Selected goal does not belong to the chosen project.";
  }

  return null;
}
