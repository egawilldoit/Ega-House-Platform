import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_VALUES,
  isTaskDueFilter,
  isTaskSortValue,
  type TaskDueFilter,
  type TaskSortValue,
} from "@ega/contracts/common/task-list";
import { compareBoardRankedItems } from "@ega/domain";

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
  due_date: string | null;
  status: string;
  updated_at: string;
};

type TaskKanbanLike = { status: string };

export type TaskKanbanColumn = (typeof TASK_KANBAN_COLUMNS)[number];

/**
 * Board-local ordering. It is intentionally separate from the shared
 * `TASK_SORT_VALUES` contract: only the web board renders `board_rank`, and a
 * "manual" value in the shared list contract would silently change list order
 * for every consumer (including mobile) without them knowing.
 *
 * `null` means "use the active list sort" (Recent / due date). Only `manual`
 * enables dragging, so a drag can never silently replace an explicit sort.
 */
export const TASK_BOARD_ORDER_VALUES = ["manual", "priority"] as const;
export type TaskBoardOrder = (typeof TASK_BOARD_ORDER_VALUES)[number];

export function isTaskBoardOrder(value: string): value is TaskBoardOrder {
  return (TASK_BOARD_ORDER_VALUES as readonly string[]).includes(value);
}

export function normalizeTaskBoardOrder(
  value: string | null | undefined,
): TaskBoardOrder | null {
  return value && isTaskBoardOrder(value) ? value : null;
}

const TASK_PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type BoardSortableTask = {
  id: string;
  priority: string;
  updated_at: string;
  board_rank?: string | null;
};

/**
 * Order tasks for the board without touching the list's sort.
 *
 * Manual order is `(board_rank, id)` exactly as the database orders it, so a
 * filtered/project board is a projection of the one canonical order. Priority
 * order is board-local and still breaks ties deterministically.
 */
export function sortTasksForBoard<T extends BoardSortableTask>(
  tasks: T[],
  boardOrder: TaskBoardOrder | null,
): T[] {
  if (boardOrder === "manual") {
    return [...tasks].sort(compareBoardRankedItems);
  }

  if (boardOrder === "priority") {
    return [...tasks].sort((left, right) => {
      const leftPriority = TASK_PRIORITY_ORDER[left.priority] ?? 99;
      const rightPriority = TASK_PRIORITY_ORDER[right.priority] ?? 99;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const updatedResult = right.updated_at.localeCompare(left.updated_at);
      return updatedResult !== 0 ? updatedResult : left.id.localeCompare(right.id);
    });
  }

  return tasks;
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
    boardOrder?: TaskBoardOrder | null;
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
  if (filters.boardOrder) searchParams.set("boardOrder", filters.boardOrder);

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
  if (!leftDueDate && !rightDueDate) return 0;
  if (!leftDueDate) return 1;
  if (!rightDueDate) return -1;
  return direction === "asc"
    ? leftDueDate.localeCompare(rightDueDate)
    : rightDueDate.localeCompare(leftDueDate);
}

export function sortTasksByValue<T extends TaskListLike>(tasks: T[], sortValue: TaskSortValue) {
  return [...tasks].sort((left, right) => {
    if (sortValue === "due_date_asc") {
      const dueDateResult = compareDueDates(left.due_date, right.due_date, "asc");
      return dueDateResult !== 0 ? dueDateResult : right.updated_at.localeCompare(left.updated_at);
    }

    if (sortValue === "due_date_desc") {
      const dueDateResult = compareDueDates(left.due_date, right.due_date, "desc");
      return dueDateResult !== 0 ? dueDateResult : right.updated_at.localeCompare(left.updated_at);
    }

    return right.updated_at.localeCompare(left.updated_at);
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
