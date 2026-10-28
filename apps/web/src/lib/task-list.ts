import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_DEFINITIONS,
  TASK_SORT_VALUES,
  isTaskDueFilter,
  isTaskSortValue,
  type TaskDueFilter,
  type TaskSortValue,
} from "@ega/contracts/common/task-list";
import { compareTaskField, compareTaskIds } from "@ega/domain";

import { isTaskDueToday, isTaskDueSoon, isTaskOverdue } from "@/lib/task-due-date";
import { isTaskStatus, type TaskStatus } from "@/lib/task-domain";

export {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_VALUES,
  isTaskDueFilter,
  isTaskSortValue,
};
export type { TaskDueFilter, TaskSortValue };

export const TASK_LAYOUT_VALUES = ["list", "kanban"] as const;
export const DEFAULT_TASK_LAYOUT = "list" as const;

export const TASK_DENSITY_VALUES = ["comfortable", "compact"] as const;
export type TaskDensity = (typeof TASK_DENSITY_VALUES)[number];
export const DEFAULT_TASK_DENSITY: TaskDensity = "comfortable";

export function normalizeTaskDensity(value: string | null | undefined): TaskDensity {
  return value === "compact" ? "compact" : DEFAULT_TASK_DENSITY;
}

export const TASK_KANBAN_COLUMNS = [
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In Progress" },
  { status: "review", label: "In Review" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
] as const satisfies ReadonlyArray<{ status: TaskStatus; label: string }>;

export type TaskLayoutMode = (typeof TASK_LAYOUT_VALUES)[number];

type TaskListLike = {
  id: string;
  title: string;
  priority: string;
  due_date: string | null;
  status: string;
  estimate_minutes: number | null;
  updated_at: string;
};

type TaskKanbanLike = { status: string };

export type TaskKanbanColumn = (typeof TASK_KANBAN_COLUMNS)[number];

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
    review: [],
    blocked: [],
    done: [],
  };

  for (const task of tasks) {
    if (isTaskStatus(task.status)) tasksByStatus[task.status].push(task);
  }

  const columns = activeStatus
    ? TASK_KANBAN_COLUMNS.filter((column) => column.status === activeStatus)
    : TASK_KANBAN_COLUMNS;

  return { columns, tasksByStatus };
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
    density?: TaskDensity | string | null;
    /** Ordered visible table column ids, e.g. `task,priority,due,status`. */
    cols?: string | null;
    /** Non-default column widths, e.g. `task:420,priority:96`. */
    widths?: string | null;
  },
) {
  const searchParams = new URLSearchParams();

  if (filters.activeTasks) searchParams.set("tasks", "active");
  if (filters.status) searchParams.set("status", filters.status);
  if (filters.priority) searchParams.set("priority", filters.priority);
  if (filters.estimateMin) searchParams.set("estimateMin", String(filters.estimateMin));
  if (filters.estimateMax) searchParams.set("estimateMax", String(filters.estimateMax));
  if (filters.dueWithin) searchParams.set("dueWithin", String(filters.dueWithin));
  if (filters.project) searchParams.set("project", filters.project);
  if (filters.goal) searchParams.set("goal", filters.goal);
  if (filters.due && filters.due !== DEFAULT_TASK_DUE_FILTER) searchParams.set("due", filters.due);
  if (filters.sort && filters.sort !== DEFAULT_TASK_SORT) searchParams.set("sort", filters.sort);
  if (filters.view && filters.view !== "active") searchParams.set("archive", filters.view);
  if (filters.layout === "kanban") searchParams.set("layout", "kanban");
  if (filters.density === "compact") searchParams.set("density", "compact");
  if (filters.cols) searchParams.set("cols", filters.cols);
  if (filters.widths) searchParams.set("widths", filters.widths);

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

function sortFieldValue(
  task: TaskListLike,
  field: "title" | "due" | "priority" | "status" | "estimate" | "updated",
): string | number | null {
  switch (field) {
    case "due":
      return task.due_date;
    case "priority":
      return task.priority;
    case "status":
      return task.status;
    case "estimate":
      return task.estimate_minutes;
    case "updated":
      return task.updated_at;
    case "title":
    default:
      return task.title;
  }
}

export function sortTasksByValue<T extends TaskListLike>(
  tasks: T[],
  sortValue: TaskSortValue,
) {
  const definition = TASK_SORT_DEFINITIONS[sortValue] ?? TASK_SORT_DEFINITIONS[DEFAULT_TASK_SORT];

  return [...tasks].sort((left, right) => {
    const primary = compareTaskField(
      definition.field,
      definition.direction,
      sortFieldValue(left, definition.field),
      sortFieldValue(right, definition.field),
    );
    // Stable, deterministic final tie-breaker shared with the toolbar sort.
    return primary !== 0 ? primary : compareTaskIds(left.id, right.id);
  });
}

export function applyTaskListQuery<T extends TaskListLike>(
  tasks: T[],
  options: { dueFilter?: TaskDueFilter; sortValue?: TaskSortValue; today?: string } = {},
) {
  const filteredTasks = filterTasksByDueFilter(
    tasks,
    options.dueFilter ?? DEFAULT_TASK_DUE_FILTER,
    options.today,
  );

  return sortTasksByValue(filteredTasks, options.sortValue ?? DEFAULT_TASK_SORT);
}
