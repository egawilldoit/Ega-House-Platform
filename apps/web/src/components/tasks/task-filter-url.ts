import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  buildTaskListUrl,
  type TaskDensity,
  type TaskBoardOrder,
  type TaskLayoutMode,
  type TaskDueFilter,
  type TaskSortValue,
  type TaskViewDefinition,
  type TaskViewFilter,
} from "@/lib/task-list";
import {
  TASK_DUE_BUCKET_LABELS,
  TASK_FILTER_FIELD_LABELS,
  TASK_FILTER_OPERATOR_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskViewFilterField,
  type TaskViewFilterOperator,
} from "@ega/contracts/common/task-list";
import type { TaskDueBucket, TaskPriority, TaskStatus } from "@ega/domain";
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
  boardOrder?: TaskBoardOrder | null;
  /** Canonical toolbar filters; when present these replace the legacy fields. */
  filters?: readonly TaskViewFilter[];
  group?: TaskViewDefinition["groupBy"];
  q?: string | null;
  sortKey?: TaskViewDefinition["sort"]["key"];
  sortDirection?: TaskViewDefinition["sort"]["direction"];
  tab?: string | null;
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
  if (filters.filters) {
    return mergeTaskFilterUrl(basePath, filters, {
      filters: [],
      q: "",
      activeTasks: null,
    });
  }

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
  /** Canonical filter position, when the chip came from a view definition. */
  filterIndex?: number;
  field?: TaskViewFilterField;
  operator?: TaskViewFilterOperator;
  values?: string[];
};

type FilterChipOptions = {
  projectName?: string | null;
  goalTitle?: string | null;
  projectOptions?: Array<{ id: string; name: string }>;
  goalOptions?: Array<{ id: string; title: string }>;
};

function valueLabel(
  filter: TaskViewFilter,
  value: string,
  options: FilterChipOptions,
): string {
  switch (filter.field) {
    case "status":
      return TASK_STATUS_LABELS[value as TaskStatus] ?? formatTaskToken(value);
    case "priority":
      return TASK_PRIORITY_LABELS[value as TaskPriority] ?? formatTaskToken(value);
    case "due_bucket":
      return TASK_DUE_BUCKET_LABELS[value as TaskDueBucket] ?? formatTaskToken(value);
    case "project":
      return (
        options.projectOptions?.find((option) => option.id === value)?.name ??
        options.projectName ??
        "Project"
      );
    case "goal":
      return (
        options.goalOptions?.find((option) => option.id === value)?.title ??
        options.goalTitle ??
        "Goal"
      );
    default:
      return value;
  }
}

export function describeTaskViewFilter(
  filter: TaskViewFilter,
  options: FilterChipOptions = {},
): string {
  const field = TASK_FILTER_FIELD_LABELS[filter.field];

  if (filter.field === "estimate") {
    const [min, max] = filter.values;
    return `${field} ${min || "0"}–${max || "∞"}m`;
  }

  if (filter.field === "due_within_days") {
    return `${field} ${filter.values[0]} days`;
  }

  const values = filter.values.map((value) => valueLabel(filter, value, options));
  const operator = TASK_FILTER_OPERATOR_LABELS[filter.operator];
  return `${field} ${operator} ${values.join(", ")}`;
}

export function buildTaskViewFilterChips(
  basePath: string,
  view: TaskViewDefinition,
  filters: TaskFilterState,
  options: FilterChipOptions = {},
): ActiveTaskFilterChip[] {
  const chips: ActiveTaskFilterChip[] = [];

  if (view.search) {
    chips.push({
      key: "search",
      label: `Search: ${view.search}`,
      removeHref: mergeTaskFilterUrl(basePath, filters, { q: "" }),
    });
  }

  view.filters.forEach((filter, index) => {
    chips.push({
      key: `filter-${index}-${filter.field}-${filter.operator}`,
      label: describeTaskViewFilter(filter, options),
      removeHref: mergeTaskFilterUrl(basePath, filters, {
        filters: view.filters.filter((_, filterIndex) => filterIndex !== index),
      }),
      filterIndex: index,
      field: filter.field,
      operator: filter.operator,
      values: [...filter.values],
    });
  });

  return chips;
}

export function upsertTaskViewFilter(
  filters: readonly TaskViewFilter[],
  filter: TaskViewFilter,
  index: number | null,
): TaskViewFilter[] {
  if (index === null) return [...filters, filter];
  return filters.map((entry, entryIndex) => (entryIndex === index ? filter : entry));
}

export function removeTaskViewFilter(
  filters: readonly TaskViewFilter[],
  index: number,
): TaskViewFilter[] {
  return filters.filter((_, entryIndex) => entryIndex !== index);
}

/**
 * Legacy chip builder retained for the project-scoped task surface. The /tasks
 * toolbar uses `buildTaskViewFilterChips` with the canonical definition.
 */
export function buildActiveTaskFilterChips(
  basePath: string,
  filters: TaskFilterState,
  options: FilterChipOptions = {},
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
