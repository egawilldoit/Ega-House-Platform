import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_VALUES,
  isTaskDueFilter,
  isTaskSortValue,
  normalizeTaskTableColumns,
  parseTaskViewSearchParams,
  parseTaskTableColumns,
  serializeTaskTableColumns,
  taskViewFromLegacyInput,
  toTaskViewSearchPairs,
  getDefaultTaskViewSortDirection,
  type TaskDueFilter,
  type TaskSortValue,
  type TaskTableColumnConfig,
  type TaskViewDefinition,
  type TaskViewFilter,
  type TaskViewSearchParams,
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
  normalizeTaskTableColumns,
  parseTaskViewSearchParams,
  parseTaskTableColumns,
  serializeTaskTableColumns,
  taskViewFromLegacyInput,
  toTaskViewSearchPairs,
  getDefaultTaskViewSortDirection,
};
export type {
  TaskDueFilter,
  TaskSortValue,
  TaskTableColumnConfig,
  TaskViewDefinition,
  TaskViewFilter,
  TaskViewSearchParams,
};

export const TASK_LAYOUT_VALUES = ["list", "kanban", "timeline", "calendar"] as const;
export const DEFAULT_TASK_LAYOUT = "list" as const;

/** Calendar range modes for `layout=calendar`. */
export const TASK_CALENDAR_VIEW_VALUES = ["month", "week"] as const;
export type TaskCalendarView = (typeof TASK_CALENDAR_VIEW_VALUES)[number];
export const DEFAULT_TASK_CALENDAR_VIEW: TaskCalendarView = "month";

/** Which task date field places a task on a calendar day. */
export const TASK_CALENDAR_DATE_FIELD_VALUES = ["due", "planned"] as const;
export type TaskCalendarDateField = (typeof TASK_CALENDAR_DATE_FIELD_VALUES)[number];
export const DEFAULT_TASK_CALENDAR_DATE_FIELD: TaskCalendarDateField = "due";

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
  if (value === "kanban") return "kanban";
  if (value === "timeline") return "timeline";
  if (value === "calendar") return "calendar";
  return DEFAULT_TASK_LAYOUT;
}

/** True only for a layout the web workspace can render today. */
export function isTaskLayout(value: unknown): value is TaskLayoutMode {
  return value === "list" || value === "kanban" || value === "timeline" || value === "calendar";
}

export function normalizeTaskCalendarView(
  value: string | null | undefined,
): TaskCalendarView {
  return value === "week" ? "week" : DEFAULT_TASK_CALENDAR_VIEW;
}

export function normalizeTaskCalendarDateField(
  value: string | null | undefined,
): TaskCalendarDateField {
  return value === "planned" ? "planned" : DEFAULT_TASK_CALENDAR_DATE_FIELD;
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

export type TaskListUrlFilters = {
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
  /** Canonical toolbar state; supersedes the legacy scalar filters above. */
  filters?: readonly TaskViewFilter[];
  group?: TaskViewDefinition["groupBy"];
  q?: string | null;
  sortKey?: TaskViewDefinition["sort"]["key"];
  sortDirection?: TaskViewDefinition["sort"]["direction"];
  boardOrder?: TaskBoardOrder | null;
  /** Table column layout; `cols`/`widths` are the compact URL spelling. */
  columns?: readonly TaskTableColumnConfig[];
  cols?: string | null;
  widths?: string | null;
  /** Timeline window anchor (YYYY-MM-DD) and week/month zoom. */
  timelineStart?: string | null;
  timelineZoom?: string | null;
  /** Project detail section, when the list is embedded in a tabbed route. */
  tab?: string | null;
  /** Calendar range mode while `layout=calendar`. */
  cal?: TaskCalendarView | null;
  /** Visible-window anchor date while `layout=calendar`. */
  date?: string | null;
  /** Task date field that places tasks on calendar days. */
  dateField?: TaskCalendarDateField | null;
};

function viewFromUrlFilters(filters: TaskListUrlFilters): TaskViewDefinition {
  const legacy = taskViewFromLegacyInput({
    status: filters.status,
    priority: filters.priority,
    projectId: filters.project,
    goalId: filters.goal,
    due: filters.due,
    dueWithinDays: filters.dueWithin,
    estimateMinMinutes: filters.estimateMin,
    estimateMaxMinutes: filters.estimateMax,
    sort: filters.sort,
    activeOnly: filters.activeTasks,
    search: filters.q,
  });

  // Canonical fields let callers replace one legacy-derived filter (for example
  // removing a status chip) without losing unrelated legacy fields.
  return {
    ...legacy,
    filters: filters.filters ? [...filters.filters] : legacy.filters,
    groupBy: filters.group ?? legacy.groupBy,
    sort:
      filters.sortKey
        ? {
            key: filters.sortKey,
            direction: filters.sortDirection ?? getDefaultTaskViewSortDirection(filters.sortKey),
          }
        : legacy.sort,
    search: filters.q !== undefined && filters.q !== null ? String(filters.q).trim() : legacy.search,
    columns: filters.columns
      ? normalizeTaskTableColumns(filters.columns)
      : filters.cols || filters.widths
        ? parseTaskTableColumns({ cols: filters.cols, widths: filters.widths })
        : legacy.columns,
  };
}

export function buildTaskListUrl(
  basePath: string,
  filters: TaskListUrlFilters,
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of toTaskViewSearchPairs(viewFromUrlFilters(filters))) {
    searchParams.append(key, value);
  }

  if (filters.view && filters.view !== "active") searchParams.set("archive", filters.view);
  if (filters.layout === "kanban") searchParams.set("layout", "kanban");
  if (filters.layout === "timeline") {
    searchParams.set("layout", "timeline");
    if (filters.timelineStart) searchParams.set("tlStart", filters.timelineStart);
    if (filters.timelineZoom === "month") searchParams.set("tlZoom", "month");
  }
  if (filters.layout === "calendar") {
    searchParams.set("layout", "calendar");
    // Calendar parameters only exist while the calendar layout is active, so
    // switching back to list/board cannot leave a stale anchor behind.
    if (filters.cal && filters.cal !== DEFAULT_TASK_CALENDAR_VIEW) {
      searchParams.set("cal", filters.cal);
    }
    if (filters.date) searchParams.set("date", filters.date);
    if (filters.dateField && filters.dateField !== DEFAULT_TASK_CALENDAR_DATE_FIELD) {
      searchParams.set("dateField", filters.dateField);
    }
  }
  if (filters.density === "compact") searchParams.set("density", "compact");
  if (filters.boardOrder) searchParams.set("boardOrder", filters.boardOrder);
  if (filters.tab && filters.tab !== "overview") searchParams.set("tab", filters.tab);

  const query = searchParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Parse the canonical view from a Next searchParams record. */
export function parseTaskListView(
  searchParams: TaskViewSearchParams,
): TaskViewDefinition {
  return parseTaskViewSearchParams(searchParams);
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
