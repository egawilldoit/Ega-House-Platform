import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  buildTaskListUrl,
  type TaskDensity,
  type TaskLayoutMode,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { formatTaskToken } from "@/lib/task-domain";

export type TaskFilterState = {
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
  density?: TaskDensity | null;
};

export const DEFAULT_TASK_FILTER_STATE = {
  due: DEFAULT_TASK_DUE_FILTER,
  sort: DEFAULT_TASK_SORT,
} as const;

export function getDueFilterLabel(value: TaskDueFilter): string {
  switch (value) {
    case "overdue":
      return "Overdue";
    case "due_today":
      return "Due today";
    case "due_soon":
      return "Due soon";
    case "no_due_date":
      return "No due date";
    default:
      return "All";
  }
}

export function getSortLabel(value: TaskSortValue): string {
  switch (value) {
    case "due_date_asc":
      return "Due soonest";
    case "due_date_desc":
      return "Due latest";
    default:
      return "Recent";
  }
}

/**
 * Single URL-construction point for every filter mutation.
 *
 * The full canonical filter state is merged with the requested override so
 * changing one dimension can never silently drop hidden/advanced filters.
 */
export function mergeTaskFilterUrl(
  basePath: string,
  filters: TaskFilterState,
  overrides: TaskFilterState,
): string {
  return buildTaskListUrl(basePath, { ...filters, ...overrides });
}

export function buildTaskFilterReturnPath(
  basePath: string,
  filters: TaskFilterState,
) {
  return buildTaskListUrl(basePath, filters);
}

export function buildClearTaskFiltersUrl(basePath: string, filters: TaskFilterState): string {
  return mergeTaskFilterUrl(basePath, filters, {
    status: null,
    priority: null,
    estimateMin: null,
    estimateMax: null,
    dueWithin: null,
    activeTasks: null,
    project: null,
    goal: null,
    due: DEFAULT_TASK_DUE_FILTER,
    sort: filters.sort ?? DEFAULT_TASK_SORT,
  });
}

export type ActiveTaskFilterChip = {
  key: string;
  label: string;
  removeHref: string;
};

export function buildActiveTaskFilterChips(
  basePath: string,
  filters: TaskFilterState,
  options: {
    projectName?: string | null;
    goalTitle?: string | null;
  } = {},
): ActiveTaskFilterChip[] {
  const hrefFor = (overrides: TaskFilterState) => mergeTaskFilterUrl(basePath, filters, overrides);
  const chips: ActiveTaskFilterChip[] = [];

  if (filters.status) {
    chips.push({
      key: "status",
      label: `Status: ${formatTaskToken(filters.status)}`,
      removeHref: hrefFor({ status: null }),
    });
  }
  if (filters.project) {
    chips.push({
      key: "project",
      label: `Project: ${options.projectName ?? "Project"}`,
      removeHref: hrefFor({ project: null }),
    });
  }
  if (filters.goal) {
    chips.push({
      key: "goal",
      label: `Goal: ${options.goalTitle ?? "Goal"}`,
      removeHref: hrefFor({ goal: null }),
    });
  }
  if (filters.priority) {
    chips.push({
      key: "priority",
      label: `Priority: ${String(filters.priority).split(",").map((value) => formatTaskToken(value)).join(", ")}`,
      removeHref: hrefFor({ priority: null }),
    });
  }
  if (filters.due && filters.due !== DEFAULT_TASK_DUE_FILTER) {
    chips.push({
      key: "due",
      label: `Due: ${getDueFilterLabel(filters.due)}`,
      removeHref: hrefFor({ due: DEFAULT_TASK_DUE_FILTER }),
    });
  }
  if (filters.estimateMin || filters.estimateMax) {
    chips.push({
      key: "estimate",
      label: `Estimate: ${filters.estimateMin ? `${filters.estimateMin}m` : "0m"}–${
        filters.estimateMax ? `${filters.estimateMax}m` : "∞"
      }`,
      removeHref: hrefFor({ estimateMin: null, estimateMax: null }),
    });
  }
  if (filters.dueWithin) {
    chips.push({
      key: "dueWithin",
      label: `Due within ${filters.dueWithin}d`,
      removeHref: hrefFor({ dueWithin: null }),
    });
  }
  if (filters.activeTasks) {
    chips.push({
      key: "activeTasks",
      label: "Active tasks only",
      removeHref: hrefFor({ activeTasks: null }),
    });
  }

  return chips;
}
