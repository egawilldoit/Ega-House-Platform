import {
  isTaskDueToday,
  isTaskDueSoon,
  isTaskOverdue,
} from "@/lib/task-due-date";

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

type TaskListLike = {
  due_date: string | null;
  status: string;
  updated_at: string;
};

export function isTaskDueFilter(value: string): value is TaskDueFilter {
  return TASK_DUE_FILTER_VALUES.includes(value as TaskDueFilter);
}

export function isTaskSortValue(value: string): value is TaskSortValue {
  return TASK_SORT_VALUES.includes(value as TaskSortValue);
}

export function filterTasksByDueFilter<T extends TaskListLike>(
  tasks: T[],
  dueFilter: TaskDueFilter,
  today?: string,
) {
  switch (dueFilter) {
    case "overdue":
      return tasks.filter((task) => isTaskOverdue(task.due_date, task.status, today));
    case "due_today":
      return tasks.filter((task) => isTaskDueToday(task.due_date, task.status, today));
    case "due_soon":
      return tasks.filter((task) => isTaskDueSoon(task.due_date, task.status, today));
    case "no_due_date":
      return tasks.filter((task) => !task.due_date);
    default:
      return tasks;
  }
}

function compareDueDates(
  leftDueDate: string | null,
  rightDueDate: string | null,
  direction: "asc" | "desc",
) {
  if (!leftDueDate && !rightDueDate) {
    return 0;
  }

  if (!leftDueDate) {
    return 1;
  }

  if (!rightDueDate) {
    return -1;
  }

  return direction === "asc"
    ? leftDueDate.localeCompare(rightDueDate)
    : rightDueDate.localeCompare(leftDueDate);
}

export function sortTasksByValue<T extends TaskListLike>(
  tasks: T[],
  sortValue: TaskSortValue,
) {
  return [...tasks].sort((left, right) => {
    if (sortValue === "due_date_asc") {
      const dueDateResult = compareDueDates(left.due_date, right.due_date, "asc");
      return dueDateResult !== 0
        ? dueDateResult
        : right.updated_at.localeCompare(left.updated_at);
    }

    if (sortValue === "due_date_desc") {
      const dueDateResult = compareDueDates(left.due_date, right.due_date, "desc");
      return dueDateResult !== 0
        ? dueDateResult
        : right.updated_at.localeCompare(left.updated_at);
    }

    return right.updated_at.localeCompare(left.updated_at);
  });
}

export function applyTaskListQuery<T extends TaskListLike>(
  tasks: T[],
  options: {
    dueFilter?: TaskDueFilter;
    sortValue?: TaskSortValue;
    today?: string;
  } = {},
) {
  const filteredTasks = filterTasksByDueFilter(
    tasks,
    options.dueFilter ?? DEFAULT_TASK_DUE_FILTER,
    options.today,
  );

  return sortTasksByValue(filteredTasks, options.sortValue ?? DEFAULT_TASK_SORT);
}
