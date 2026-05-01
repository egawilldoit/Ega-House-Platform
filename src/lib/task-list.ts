import {
  isTaskDueToday,
  isTaskDueSoon,
  isTaskOverdue,
} from "@/lib/task-due-date";
import { isTaskStatus, type TaskStatus } from "@/lib/task-domain";

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

export const TASK_LAYOUT_VALUES = ["list", "kanban"] as const;

export const DEFAULT_TASK_DUE_FILTER = "all" as const;
export const DEFAULT_TASK_SORT = "updated_desc" as const;
export const DEFAULT_TASK_LAYOUT = "list" as const;

export const TASK_KANBAN_COLUMNS = [
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
] as const satisfies ReadonlyArray<{
  status: TaskStatus;
  label: string;
}>;

export type TaskDueFilter = (typeof TASK_DUE_FILTER_VALUES)[number];
export type TaskSortValue = (typeof TASK_SORT_VALUES)[number];
export type TaskLayoutMode = (typeof TASK_LAYOUT_VALUES)[number];

type TaskListLike = {
  due_date: string | null;
  status: string;
  updated_at: string;
};

type TaskKanbanLike = {
  status: string;
};

export type TaskKanbanColumn = (typeof TASK_KANBAN_COLUMNS)[number];

export function isTaskDueFilter(value: string): value is TaskDueFilter {
  return TASK_DUE_FILTER_VALUES.includes(value as TaskDueFilter);
}

export function isTaskSortValue(value: string): value is TaskSortValue {
  return TASK_SORT_VALUES.includes(value as TaskSortValue);
}

export function normalizeTaskLayout(value: string | null | undefined): TaskLayoutMode {
  return value === "kanban" ? "kanban" : DEFAULT_TASK_LAYOUT;
}

export function buildTaskKanbanBoard<T extends TaskKanbanLike>(
  tasks: T[],
  activeStatus?: TaskStatus | null,
) {
  const tasksByStatus: Record<TaskStatus, T[]> = {
    todo: [],
    in_progress: [],
    blocked: [],
    done: [],
  };

  for (const task of tasks) {
    if (isTaskStatus(task.status)) {
      tasksByStatus[task.status].push(task);
    }
  }

  const columns = activeStatus
    ? TASK_KANBAN_COLUMNS.filter((column) => column.status === activeStatus)
    : TASK_KANBAN_COLUMNS;

  return {
    columns,
    tasksByStatus,
  };
}

export function buildTaskListUrl(
  basePath: string,
  filters: {
    status?: string | null;
    priority?: string | null;
    estimateMin?: number | string | null;
    estimateMax?: number | string | null;
    dueWithin?: number | string | null;
    activeTasks?: boolean | null;
    project?: string | null;
    goal?: string | null;
    due?: TaskDueFilter;
    sort?: TaskSortValue;
    view?: string | null;
    layout?: TaskLayoutMode;
  },
) {
  const searchParams = new URLSearchParams();

  if (filters.activeTasks) {
    searchParams.set("tasks", "active");
  }

  if (filters.status) {
    searchParams.set("status", filters.status);
  }

  if (filters.priority) {
    searchParams.set("priority", filters.priority);
  }

  if (filters.estimateMin) {
    searchParams.set("estimateMin", String(filters.estimateMin));
  }

  if (filters.estimateMax) {
    searchParams.set("estimateMax", String(filters.estimateMax));
  }

  if (filters.dueWithin) {
    searchParams.set("dueWithin", String(filters.dueWithin));
  }

  if (filters.project) {
    searchParams.set("project", filters.project);
  }

  if (filters.goal) {
    searchParams.set("goal", filters.goal);
  }

  if (filters.due && filters.due !== DEFAULT_TASK_DUE_FILTER) {
    searchParams.set("due", filters.due);
  }

  if (filters.sort && filters.sort !== DEFAULT_TASK_SORT) {
    searchParams.set("sort", filters.sort);
  }

  if (filters.view && filters.view !== "active") {
    searchParams.set("archive", filters.view);
  }

  if (filters.layout === "kanban") {
    searchParams.set("layout", "kanban");
  }

  const query = searchParams.toString();
  return query ? `${basePath}?${query}` : basePath;
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
