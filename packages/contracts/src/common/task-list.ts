import {
  TASK_DUE_BUCKET_VALUES,
  isTaskDueBucket,
  isTaskPriority,
  isTaskStatus,
  type TaskDueBucket,
  type TaskPriority,
  type TaskStatus,
} from "@ega/domain";

/**
 * Legacy due filter retained for URL/API compatibility. New view definitions
 * use `due_bucket`; `due_soon` migrates to `next_7_days`.
 */
export const TASK_DUE_FILTER_VALUES = [
  "all",
  "overdue",
  "due_today",
  "due_soon",
  "no_due_date",
] as const;

/**
 * Legacy sort values retained for URL/API compatibility. New view definitions
 * use a sort key + direction (`TaskViewSort`); these map onto it.
 */
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

/* -------------------------------------------------------------------------- */
/* Table column layout (EGA-792)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Columns whose configuration is persisted with a view. `task` is the row
 * anchor and is always visible/first; the remaining columns can be hidden,
 * resized and reordered. The action column is fixed.
 */
export const TASK_TABLE_COLUMN_IDS = [
  "task",
  "project",
  "priority",
  "due",
  "status",
  "estimate",
] as const;

export type TaskTableColumnId = (typeof TASK_TABLE_COLUMN_IDS)[number];

export const TASK_TABLE_COLUMN_MIN_WIDTH = 80;
export const TASK_TABLE_COLUMN_MAX_WIDTH = 480;

export type TaskTableColumnConfig = {
  id: TaskTableColumnId;
  width: number;
  visible: boolean;
};

export const TASK_TABLE_DEFAULT_COLUMNS: readonly TaskTableColumnConfig[] = [
  { id: "task", width: 360, visible: true },
  { id: "project", width: 160, visible: false },
  { id: "priority", width: 112, visible: true },
  { id: "due", width: 152, visible: true },
  { id: "status", width: 144, visible: true },
  { id: "estimate", width: 112, visible: false },
];

const TASK_TABLE_DEFAULT_COLUMN_BY_ID = new Map(
  TASK_TABLE_DEFAULT_COLUMNS.map((column) => [column.id, column]),
);
const DEFAULT_VISIBLE_COLUMNS = TASK_TABLE_DEFAULT_COLUMNS.filter(
  (column) => column.visible,
).map((column) => column.id);

export function isTaskTableColumnId(value: string): value is TaskTableColumnId {
  return (TASK_TABLE_COLUMN_IDS as readonly string[]).includes(value);
}

export function getTaskTableDefaultColumnWidth(id: TaskTableColumnId): number {
  return TASK_TABLE_DEFAULT_COLUMN_BY_ID.get(id)?.width ?? TASK_TABLE_COLUMN_MIN_WIDTH;
}

export function clampTaskTableColumnWidth(
  value: unknown,
  fallback = TASK_TABLE_COLUMN_MIN_WIDTH,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(
    TASK_TABLE_COLUMN_MAX_WIDTH,
    Math.max(TASK_TABLE_COLUMN_MIN_WIDTH, Math.round(numeric)),
  );
}

/**
 * Normalize an untrusted persisted column config. Unknown ids and duplicates
 * are dropped, widths are clamped, `task` is forced visible/first, and any
 * column absent from the input falls back to its default.
 */
export function normalizeTaskTableColumns(raw: unknown): TaskTableColumnConfig[] {
  const entries: TaskTableColumnConfig[] = [];
  const seen = new Set<TaskTableColumnId>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
      const idValue = (item as { id?: unknown }).id;
      if (typeof idValue !== "string" || !isTaskTableColumnId(idValue) || seen.has(idValue)) {
        continue;
      }
      seen.add(idValue);
      const fallback = TASK_TABLE_DEFAULT_COLUMN_BY_ID.get(idValue);
      const width = clampTaskTableColumnWidth(
        (item as { width?: unknown }).width,
        fallback?.width ?? TASK_TABLE_COLUMN_MIN_WIDTH,
      );
      const rawVisible = (item as { visible?: unknown }).visible;
      const visible =
        idValue === "task"
          ? true
          : typeof rawVisible === "boolean"
            ? rawVisible
            : (fallback?.visible ?? true);
      entries.push({ id: idValue, width, visible });
    }
  }

  for (const fallback of TASK_TABLE_DEFAULT_COLUMNS) {
    if (!seen.has(fallback.id)) entries.push({ ...fallback });
  }

  const task = entries.find((entry) => entry.id === "task") ?? {
    ...TASK_TABLE_DEFAULT_COLUMNS[0],
  };
  const rest = entries.filter((entry) => entry.id !== "task");
  const visible = rest.filter((entry) => entry.visible);
  const hidden = rest.filter((entry) => !entry.visible);

  return [{ ...task, visible: true }, ...visible, ...hidden];
}

export function areTaskTableColumnsEqual(
  left: readonly TaskTableColumnConfig[],
  right: readonly TaskTableColumnConfig[],
): boolean {
  return (
    left.length === right.length &&
    left.every((column, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.id === column.id &&
        other.width === column.width &&
        other.visible === column.visible
      );
    })
  );
}

function splitColumnList(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Parse the compact table URL contract (`cols` + `widths`). */
export function parseTaskTableColumns(input: {
  cols?: string | null;
  widths?: string | null;
}): TaskTableColumnConfig[] {
  const requestedOrder: TaskTableColumnId[] = [];
  const seen = new Set<TaskTableColumnId>();
  for (const entry of splitColumnList(input.cols)) {
    if (!isTaskTableColumnId(entry) || seen.has(entry)) continue;
    seen.add(entry);
    requestedOrder.push(entry);
  }

  const visibleOrder = requestedOrder.length > 0 ? requestedOrder : DEFAULT_VISIBLE_COLUMNS;
  const orderedVisible = ["task" as const, ...visibleOrder.filter((id) => id !== "task")];
  const visible = new Set<TaskTableColumnId>(orderedVisible);
  const widths = new Map<TaskTableColumnId, number>();
  for (const entry of splitColumnList(input.widths)) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;
    const id = entry.slice(0, separator).trim();
    const rawWidth = entry.slice(separator + 1).trim();
    if (!isTaskTableColumnId(id) || widths.has(id) || !rawWidth) continue;
    const width = Number(rawWidth);
    if (!Number.isFinite(width)) continue;
    widths.set(id, clampTaskTableColumnWidth(width, getTaskTableDefaultColumnWidth(id)));
  }

  const remaining = TASK_TABLE_DEFAULT_COLUMNS.map((column) => column.id).filter(
    (id) => !visible.has(id),
  );
  return normalizeTaskTableColumns(
    [...orderedVisible, ...remaining].map((id) => ({
      id,
      width: widths.get(id) ?? getTaskTableDefaultColumnWidth(id),
      visible: visible.has(id),
    })),
  );
}

/** Serialize only deviations from the defaults, keeping ordinary URLs short. */
export function serializeTaskTableColumns(
  columns: readonly TaskTableColumnConfig[] | undefined,
): { cols: string | null; widths: string | null } {
  const safeColumns = normalizeTaskTableColumns(columns ?? null);
  const orderedVisible = safeColumns
    .filter((column) => column.visible)
    .map((column) => column.id);
  const sameOrder =
    orderedVisible.length === DEFAULT_VISIBLE_COLUMNS.length &&
    orderedVisible.every((value, index) => value === DEFAULT_VISIBLE_COLUMNS[index]);
  const cols = sameOrder ? null : orderedVisible.join(",");
  const widths = safeColumns
    .filter((column) => column.width !== getTaskTableDefaultColumnWidth(column.id))
    .map((column) => `${column.id}:${column.width}`)
    .join(",");

  return { cols, widths: widths || null };
}


/* -------------------------------------------------------------------------- */
/* Versioned task view definition                                             */
/* -------------------------------------------------------------------------- */

export const TASK_VIEW_DEFINITION_VERSION = 2 as const;

/** Hard bounds for untrusted URL and `definition_json` input. */
export const TASK_VIEW_DEFINITION_MAX_CHARS = 4096;
export const TASK_VIEW_MAX_FILTERS = 8;
export const TASK_VIEW_MAX_FILTER_VALUES = 20;
export const TASK_VIEW_MAX_VALUE_LENGTH = 120;
export const TASK_VIEW_MAX_SEARCH_LENGTH = 120;
export const TASK_VIEW_MAX_ESTIMATE_MINUTES = 1_000_000;
export const TASK_VIEW_MAX_DUE_WITHIN_DAYS = 365;

export const TASK_VIEW_FILTER_FIELDS = [
  "status",
  "priority",
  "project",
  "goal",
  "due_bucket",
  "due_within_days",
  "estimate",
] as const;

export const TASK_VIEW_FILTER_OPERATORS = [
  "is",
  "is_not",
  "is_any_of",
  "is_none_of",
  "between",
] as const;

export const TASK_VIEW_GROUP_BY_VALUES = [
  "none",
  "status",
  "priority",
  "project",
  "goal",
  "due_bucket",
] as const;

export const TASK_VIEW_SORT_KEYS = [
  "manual",
  "title",
  "due",
  "planned",
  "priority",
  "status",
  "created",
  "updated",
  "estimate",
] as const;

export const TASK_VIEW_SORT_DIRECTIONS = ["asc", "desc"] as const;

export type TaskViewFilterField = (typeof TASK_VIEW_FILTER_FIELDS)[number];
export type TaskViewFilterOperator = (typeof TASK_VIEW_FILTER_OPERATORS)[number];
export type TaskViewGroupBy = (typeof TASK_VIEW_GROUP_BY_VALUES)[number];
export type TaskViewSortKey = (typeof TASK_VIEW_SORT_KEYS)[number];
export type TaskViewSortDirection = (typeof TASK_VIEW_SORT_DIRECTIONS)[number];

export type TaskViewFilter = Readonly<{
  field: TaskViewFilterField;
  operator: TaskViewFilterOperator;
  /**
   * Allow-listed values only. Empty values are never persisted; operators that
   * accept a range (`estimate`) store `[min, max]`, where either bound may be
   * an empty string.
   */
  values: string[];
}>;

export type TaskViewSort = Readonly<{
  key: TaskViewSortKey;
  direction: TaskViewSortDirection;
}>;

export type TaskViewDefinition = Readonly<{
  version: typeof TASK_VIEW_DEFINITION_VERSION;
  /** Conjunctive filters: every entry must match (AND). */
  filters: TaskViewFilter[];
  groupBy: TaskViewGroupBy;
  sort: TaskViewSort;
  /** Case-insensitive title search, trimmed. */
  search: string;
  /** Legacy `tasks=active`: exclude completed status without inventing a chip. */
  activeOnly: boolean;
  /** Table column layout; omitted old definitions read with the defaults. */
  columns?: TaskTableColumnConfig[];
}>;

export const DEFAULT_TASK_VIEW_SORT: TaskViewSort = {
  key: "updated",
  direction: "desc",
};

export const DEFAULT_TASK_VIEW_DEFINITION: TaskViewDefinition = {
  version: TASK_VIEW_DEFINITION_VERSION,
  filters: [],
  groupBy: "none",
  sort: DEFAULT_TASK_VIEW_SORT,
  search: "",
  activeOnly: false,
};

const FIELD_OPERATORS: Record<TaskViewFilterField, readonly TaskViewFilterOperator[]> = {
  status: ["is", "is_not", "is_any_of", "is_none_of"],
  priority: ["is", "is_not", "is_any_of", "is_none_of"],
  project: ["is", "is_not", "is_any_of", "is_none_of"],
  goal: ["is", "is_not", "is_any_of", "is_none_of"],
  due_bucket: ["is", "is_not", "is_any_of", "is_none_of"],
  due_within_days: ["is"],
  estimate: ["between"],
};

/** Allowed operators for a field; the boundary validator uses the same map. */
export function getTaskViewFilterOperators(
  field: TaskViewFilterField,
): readonly TaskViewFilterOperator[] {
  return FIELD_OPERATORS[field];
}

const DEFAULT_SORT_DIRECTION: Record<TaskViewSortKey, TaskViewSortDirection> = {
  manual: "asc",
  title: "asc",
  due: "asc",
  planned: "asc",
  priority: "asc",
  status: "asc",
  created: "desc",
  updated: "desc",
  estimate: "asc",
};

export const TASK_VISIBLE_SORT_KEYS: readonly TaskViewSortKey[] = [
  "manual",
  "title",
  "due",
  "planned",
  "priority",
  "status",
  "created",
  "updated",
  "estimate",
];

export function getDefaultTaskViewSortDirection(key: TaskViewSortKey): TaskViewSortDirection {
  return DEFAULT_SORT_DIRECTION[key];
}

export const TASK_GROUP_BY_LABELS: Record<TaskViewGroupBy, string> = {
  none: "None",
  status: "Status",
  priority: "Priority",
  project: "Project",
  goal: "Goal",
  due_bucket: "Due date",
};

export const TASK_VIEW_SORT_LABELS: Record<TaskViewSortKey, string> = {
  manual: "Manual",
  title: "Title",
  due: "Due date",
  planned: "Planned date",
  priority: "Priority",
  status: "Status",
  created: "Created",
  updated: "Updated",
  estimate: "Estimate",
};

export const TASK_FILTER_FIELD_LABELS: Record<TaskViewFilterField, string> = {
  status: "Status",
  priority: "Priority",
  project: "Project",
  goal: "Goal",
  due_bucket: "Due date",
  due_within_days: "Due window",
  estimate: "Estimate",
};

export const TASK_FILTER_OPERATOR_LABELS: Record<TaskViewFilterOperator, string> = {
  is: "is",
  is_not: "is not",
  is_any_of: "is any of",
  is_none_of: "is none of",
  between: "is between",
};

export const TASK_STATUS_GROUP_ORDER: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "review",
  "blocked",
  "done",
];

export const TASK_PRIORITY_GROUP_ORDER: readonly TaskPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  review: "In Review",
  blocked: "Blocked",
  done: "Done",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const TASK_DUE_BUCKET_LABELS: Record<TaskDueBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  next_7_days: "Next 7 days",
  later: "Later",
  none: "No due date",
};

export const TASK_DUE_BUCKET_GROUP_ORDER: readonly TaskDueBucket[] = TASK_DUE_BUCKET_VALUES;

function isField(value: unknown): value is TaskViewFilterField {
  return typeof value === "string" && TASK_VIEW_FILTER_FIELDS.includes(value as TaskViewFilterField);
}

function isOperator(value: unknown): value is TaskViewFilterOperator {
  return (
    typeof value === "string" &&
    TASK_VIEW_FILTER_OPERATORS.includes(value as TaskViewFilterOperator)
  );
}

function isGroupBy(value: unknown): value is TaskViewGroupBy {
  return (
    typeof value === "string" && TASK_VIEW_GROUP_BY_VALUES.includes(value as TaskViewGroupBy)
  );
}

function isSortKey(value: unknown): value is TaskViewSortKey {
  return typeof value === "string" && TASK_VIEW_SORT_KEYS.includes(value as TaskViewSortKey);
}

function isSortDirection(value: unknown): value is TaskViewSortDirection {
  return (
    typeof value === "string" &&
    TASK_VIEW_SORT_DIRECTIONS.includes(value as TaskViewSortDirection)
  );
}

/**
 * Project/goal ids are opaque tokens. They are only ever compared as values and
 * are never interpolated into SQL; this guard prevents storing arbitrary text
 * (or SQL fragments) in a definition.
 */
export function isTaskViewIdentifier(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(value);
}

function normalizeInteger(value: string, max: number) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) return null;
  return parsed;
}

function normalizeFilterValues(
  field: TaskViewFilterField,
  operator: TaskViewFilterOperator,
  values: readonly string[],
): string[] | null {
  if (operator === "between") {
    if (field !== "estimate" || values.length !== 2) return null;
    const [rawMin, rawMax] = values;
    const min = rawMin === "" ? "" : String(normalizeInteger(rawMin, TASK_VIEW_MAX_ESTIMATE_MINUTES));
    const max = rawMax === "" ? "" : String(normalizeInteger(rawMax, TASK_VIEW_MAX_ESTIMATE_MINUTES));
    if (min === "null" || max === "null") return null;
    if (min === "" && max === "") return null;
    if (min !== "" && max !== "" && Number(min) > Number(max)) return null;
    return [min, max];
  }

  if (values.length === 0 || values.length > TASK_VIEW_MAX_FILTER_VALUES) return null;

  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  // Duplicate values would make the chip state ambiguous; reject rather than
  // silently changing the user's saved definition.
  if (unique.length === 0 || unique.length !== values.length) return null;

  if (operator === "is" || operator === "is_not") {
    if (unique.length !== 1) return null;
  }

  if (field === "status") {
    if (!unique.every((value) => isTaskStatus(value))) return null;
  } else if (field === "priority") {
    if (!unique.every((value) => isTaskPriority(value))) return null;
  } else if (field === "due_bucket") {
    if (!unique.every((value) => isTaskDueBucket(value))) return null;
  } else if (field === "due_within_days") {
    if (unique.length !== 1) return null;
    const days = normalizeInteger(unique[0], TASK_VIEW_MAX_DUE_WITHIN_DAYS);
    if (days === null || days === 0) return null;
    return [String(days)];
  } else if (field === "estimate") {
    return null;
  } else {
    // project / goal
    if (!unique.every((value) => isTaskViewIdentifier(value))) return null;
  }

  return unique;
}

/**
 * Can this filter be expressed with the legacy single-key URL/API aliases?
 * Negative operators stay in the versioned `filter=` form.
 */
/**
 * True when every filter can be pushed to the database with exactly the same
 * semantics the application engine applies. Count queries use this so a broad
 * pushed predicate can never be reported as a precise total.
 */
export function canExactlyCountTaskViewFilters(
  filters: readonly TaskViewFilter[],
): boolean {
  return filters.every((filter) => {
    if (filter.field === "goal" && filter.operator !== "is" && filter.operator !== "is_any_of") {
      return false;
    }
    if (filter.field === "due_bucket") {
      if (filter.operator !== "is") return false;
      return filter.values[0] !== "later";
    }
    return true;
  });
}

export function canEncodeTaskViewFilterAsLegacy(filter: TaskViewFilter) {
  if (filter.field === "estimate") return filter.operator === "between";
  if (filter.field === "due_within_days") return filter.operator === "is";
  if (filter.operator !== "is" && filter.operator !== "is_any_of") return false;
  if (filter.operator === "is" && filter.values.length !== 1) return false;
  return true;
}

export const TASK_VIEW_LEGACY_FILTER_KEYS: Partial<Record<TaskViewFilterField, string>> = {
  status: "status",
  priority: "priority",
  project: "project",
  goal: "goal",
  due_bucket: "due",
  due_within_days: "dueWithin",
};

function filterSortKey(filter: TaskViewFilter) {
  const fieldIndex = TASK_VIEW_FILTER_FIELDS.indexOf(filter.field);
  const operatorIndex = TASK_VIEW_FILTER_OPERATORS.indexOf(filter.operator);
  return fieldIndex * 100 + operatorIndex;
}

function normalizeFilter(raw: unknown): TaskViewFilter | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isField(candidate.field) || !isOperator(candidate.operator)) return null;
  if (!FIELD_OPERATORS[candidate.field].includes(candidate.operator)) return null;
  if (!Array.isArray(candidate.values)) return null;
  if (candidate.values.length > TASK_VIEW_MAX_FILTER_VALUES + 2) return null;

  const rawValues: string[] = [];
  for (const value of candidate.values) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const text = String(value);
    if (text.length > TASK_VIEW_MAX_VALUE_LENGTH) return null;
    rawValues.push(text);
  }

  const values = normalizeFilterValues(candidate.field, candidate.operator, rawValues);
  if (!values) return null;

  return { field: candidate.field, operator: candidate.operator, values };
}

function normalizeFilters(raw: unknown): TaskViewFilter[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > TASK_VIEW_MAX_FILTERS) return null;

  const filters: TaskViewFilter[] = [];
  for (const entry of raw) {
    const filter = normalizeFilter(entry);
    if (!filter) return null;
    filters.push(filter);
  }

  return filters.sort((left, right) => filterSortKey(left) - filterSortKey(right));
}

function normalizeSort(raw: unknown): TaskViewSort | null {
  if (raw === undefined) return DEFAULT_TASK_VIEW_SORT;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (!isSortKey(candidate.key)) return null;
  const direction = candidate.direction === undefined
    ? DEFAULT_SORT_DIRECTION[candidate.key]
    : candidate.direction;
  if (!isSortDirection(direction)) return null;
  return { key: candidate.key, direction };
}

function normalizeSearch(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const search = raw.trim().replace(/\s+/g, " ");
  if (search.length > TASK_VIEW_MAX_SEARCH_LENGTH) return null;
  return search;
}

const V2_KEYS = new Set(["version", "filters", "groupBy", "sort", "search", "activeOnly", "columns"]);
const V1_FILTER_KEYS = new Set([
  "activeTasks",
  "status",
  "priority",
  "estimateMinMinutes",
  "estimateMaxMinutes",
  "dueWithinDays",
]);

function migrateVersionOneDefinition(raw: Record<string, unknown>): TaskViewDefinition | null {
  const filters = raw.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return null;
  const legacy = filters as Record<string, unknown>;
  if (Object.keys(legacy).some((key) => !V1_FILTER_KEYS.has(key))) return null;

  const migrated: TaskViewFilter[] = [];
  if (legacy.activeTasks !== undefined && legacy.activeTasks !== true) {
    if (legacy.activeTasks !== false) return null;
  }

  if (legacy.status !== undefined) {
    if (typeof legacy.status !== "string" || !isTaskStatus(legacy.status)) return null;
    migrated.push({ field: "status", operator: "is", values: [legacy.status] });
  }

  if (legacy.priority !== undefined) {
    if (!Array.isArray(legacy.priority)) return null;
    const priority = Array.from(
      new Set(
        legacy.priority.filter(
          (value): value is TaskPriority =>
            typeof value === "string" && isTaskPriority(value),
        ),
      ),
    );
    if (priority.length !== legacy.priority.length) return null;
    if (priority.length > 0) {
      migrated.push({
        field: "priority",
        operator: priority.length === 1 ? "is" : "is_any_of",
        values: priority,
      });
    }
  }

  const estimateMin = legacy.estimateMinMinutes;
  const estimateMax = legacy.estimateMaxMinutes;
  if (
    (estimateMin !== undefined && typeof estimateMin !== "number") ||
    (estimateMax !== undefined && typeof estimateMax !== "number")
  ) {
    return null;
  }
  if (estimateMin !== undefined || estimateMax !== undefined) {
    const values = [
      estimateMin === undefined ? "" : String(estimateMin),
      estimateMax === undefined ? "" : String(estimateMax),
    ];
    const normalized = normalizeFilterValues("estimate", "between", values);
    if (!normalized) return null;
    migrated.push({ field: "estimate", operator: "between", values: normalized });
  }

  if (legacy.dueWithinDays !== undefined) {
    if (typeof legacy.dueWithinDays !== "number") return null;
    const normalized = normalizeFilterValues("due_within_days", "is", [
      String(legacy.dueWithinDays),
    ]);
    if (!normalized) return null;
    migrated.push({ field: "due_within_days", operator: "is", values: normalized });
  }

  return {
    version: TASK_VIEW_DEFINITION_VERSION,
    filters: migrated.sort((left, right) => filterSortKey(left) - filterSortKey(right)),
    groupBy: "none",
    sort: DEFAULT_TASK_VIEW_SORT,
    search: "",
    activeOnly: legacy.activeTasks === true,
    ...(raw.columns === undefined
      ? {}
      : { columns: normalizeTaskTableColumns(raw.columns) }),
  };
}

/**
 * Validate an untrusted saved-view definition. Version 1 definitions are
 * migrated on read; invalid shapes and unknown versions return `null` so the
 * caller can fall back to the legacy columns instead of trusting the payload.
 */
export function normalizeTaskViewDefinition(raw: unknown): TaskViewDefinition | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;

  if (candidate.version === 1) {
    return migrateVersionOneDefinition(candidate);
  }

  if (candidate.version !== TASK_VIEW_DEFINITION_VERSION) return null;
  if (Object.keys(candidate).some((key) => !V2_KEYS.has(key))) return null;

  const filters = normalizeFilters(candidate.filters);
  const sort = normalizeSort(candidate.sort);
  const search = normalizeSearch(candidate.search);
  if (!filters || !sort || search === null) return null;
  if (candidate.groupBy !== undefined && !isGroupBy(candidate.groupBy)) return null;
  if (candidate.activeOnly !== undefined && typeof candidate.activeOnly !== "boolean") return null;

  if (filters.length > TASK_VIEW_MAX_FILTERS) return null;
  if (search.length > TASK_VIEW_MAX_SEARCH_LENGTH) return null;

  const definition: TaskViewDefinition = {
    version: TASK_VIEW_DEFINITION_VERSION,
    filters,
    groupBy: isGroupBy(candidate.groupBy) ? candidate.groupBy : "none",
    sort,
    search,
    activeOnly: candidate.activeOnly === true,
    ...(candidate.columns === undefined
      ? {}
      : { columns: normalizeTaskTableColumns(candidate.columns) }),
  };

  if (serializeTaskViewDefinition(definition).length > TASK_VIEW_DEFINITION_MAX_CHARS) {
    return null;
  }

  return definition;
}

export function serializeTaskViewDefinition(definition: TaskViewDefinition) {
  return JSON.stringify(definition);
}

export function parseTaskViewDefinitionJson(
  rawJson: string | null | undefined,
): TaskViewDefinition | null {
  if (!rawJson) return null;
  if (rawJson.length > TASK_VIEW_DEFINITION_MAX_CHARS) return null;
  try {
    return normalizeTaskViewDefinition(JSON.parse(rawJson));
  } catch {
    return null;
  }
}

export function getTaskViewDefinitionVersion(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const version = (raw as Record<string, unknown>).version;
  return typeof version === "number" ? version : null;
}

/* -------------------------------------------------------------------------- */
/* URL / API codec                                                            */
/* -------------------------------------------------------------------------- */

export type TaskViewSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined | null>
>;

function readParam(params: TaskViewSearchParams, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function readAllParams(params: TaskViewSearchParams, key: string): string[] {
  const value = params[key];
  if (Array.isArray(value)) return [...value];
  return typeof value === "string" ? [value] : [];
}

function splitValues(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function legacyDueBucketFilter(raw: string | null): TaskViewFilter | null {
  if (!raw || raw === "all") return null;
  const bucket =
    raw === "due_today"
      ? "today"
      : raw === "due_soon"
        ? "next_7_days"
        : raw === "no_due_date"
          ? "none"
          : raw;
  if (!isTaskDueBucket(bucket)) return null;
  return { field: "due_bucket", operator: "is", values: [bucket] };
}

function sanitizeLegacyValues(
  field: "status" | "priority" | "project" | "goal",
  values: string[],
) {
  return values.filter((value) =>
    field === "status"
      ? isTaskStatus(value)
      : field === "priority"
        ? isTaskPriority(value)
        : isTaskViewIdentifier(value),
  );
}

function parseLegacyKeyFilters(
  params: TaskViewSearchParams,
  field: "status" | "priority" | "project" | "goal",
) {
  const filters: TaskViewFilter[] = [];
  const positive = Array.from(
    new Set(sanitizeLegacyValues(field, splitValues(readParam(params, field)))),
  );
  if (positive.length > 0) {
    const op = positive.length === 1 ? "is" : "is_any_of";
    filters.push({ field, operator: op, values: positive });
  }

  const negative = Array.from(
    new Set(sanitizeLegacyValues(field, splitValues(readParam(params, `${field}Not`)))),
  );
  if (negative.length > 0) {
    filters.push({
      field,
      operator: negative.length === 1 ? "is_not" : "is_none_of",
      values: negative,
    });
  }

  return filters;
}

function parseCanonicalFilter(raw: string): TaskViewFilter | null {
  const firstSeparator = raw.indexOf(":");
  const secondSeparator = raw.indexOf(":", firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator) return null;
  const field = raw.slice(0, firstSeparator);
  const operator = raw.slice(firstSeparator + 1, secondSeparator);
  const value = raw.slice(secondSeparator + 1);
  if (!isField(field) || !isOperator(operator)) return null;
  if (!FIELD_OPERATORS[field].includes(operator)) return null;

  const values =
    operator === "between"
      ? value.split(",").map((entry) => entry.trim())
      : splitValues(value);
  if (operator === "between" && values.length !== 2) return null;

  return normalizeFilter({ field, operator, values });
}

function legacySort(rawSort: string | null, rawDirection: string | null): TaskViewSort | null {
  if (!rawSort) {
    if (rawDirection === "asc" || rawDirection === "desc") {
      return { key: "updated", direction: rawDirection };
    }
    return DEFAULT_TASK_VIEW_SORT;
  }

  if (rawSort === "updated_desc") return { key: "updated", direction: "desc" };
  if (rawSort === "due_date_asc") return { key: "due", direction: "asc" };
  if (rawSort === "due_date_desc") return { key: "due", direction: "desc" };
  if (!isSortKey(rawSort)) return null;

  const direction = rawDirection === "asc" || rawDirection === "desc"
    ? rawDirection
    : DEFAULT_SORT_DIRECTION[rawSort];
  return { key: rawSort, direction };
}

/**
 * Parse the URL/API representation of a view.
 *
 * Canonical keys are readable aliases for positive filters plus repeated
 * `filter=<field>:<operator>:<values>` entries for everything else. Legacy
 * links (`status`, `priority`, `due`, `sort`, `estimateMin`) keep working.
 * Invalid entries are dropped rather than failing the page; the typed result is
 * still a valid, bounded definition.
 */
export function parseTaskViewSearchParams(params: TaskViewSearchParams): TaskViewDefinition {
  const filters: TaskViewFilter[] = [];

  for (const field of ["status", "priority", "project", "goal"] as const) {
    for (const filter of parseLegacyKeyFilters(params, field)) {
      const normalized = normalizeFilter(filter);
      if (normalized) filters.push(normalized);
    }
  }

  const due = legacyDueBucketFilter(readParam(params, "due"));
  if (due) filters.push(due);
  const dueNot = legacyDueBucketFilter(readParam(params, "dueNot"));
  if (dueNot) filters.push({ ...dueNot, operator: "is_not" });

  const dueWithin = readParam(params, "dueWithin");
  if (dueWithin) {
    const normalized = normalizeFilter({
      field: "due_within_days",
      operator: "is",
      values: [dueWithin],
    });
    if (normalized) filters.push(normalized);
  }

  const estimateMin = readParam(params, "estimateMin") ?? "";
  const estimateMax = readParam(params, "estimateMax") ?? "";
  if (estimateMin || estimateMax) {
    const normalized = normalizeFilter({
      field: "estimate",
      operator: "between",
      values: [estimateMin, estimateMax],
    });
    if (normalized) filters.push(normalized);
  }

  for (const raw of readAllParams(params, "filter")) {
    const normalized = parseCanonicalFilter(raw);
    if (normalized) filters.push(normalized);
  }

  const sort = legacySort(readParam(params, "sort"), readParam(params, "dir")) ?? DEFAULT_TASK_VIEW_SORT;
  const groupRaw = readParam(params, "group");
  const search = normalizeSearch(readParam(params, "q") ?? readParam(params, "search")) ?? "";

  const cols = readParam(params, "cols");
  const widths = readParam(params, "widths");
  const definition: TaskViewDefinition = {
    version: TASK_VIEW_DEFINITION_VERSION,
    filters: filters
      .sort((left, right) => filterSortKey(left) - filterSortKey(right))
      .slice(0, TASK_VIEW_MAX_FILTERS),
    groupBy: isGroupBy(groupRaw) ? groupRaw : "none",
    sort,
    search,
    activeOnly: readParam(params, "tasks") === "active",
    ...(cols || widths
      ? {
          columns: parseTaskTableColumns({
            cols,
            widths,
          }),
        }
      : {}),
  };

  return definition;
}

function legacyFilterKey(filter: TaskViewFilter): string | null {
  if (!canEncodeTaskViewFilterAsLegacy(filter)) return null;
  if (filter.field === "estimate") return null;
  return TASK_VIEW_LEGACY_FILTER_KEYS[filter.field] ?? null;
}

/**
 * Build the canonical URL/API pairs for a view. Positive, expressible filters
 * keep their readable legacy key; negative/compound filters use `filter=`.
 * Round-trip: `parseTaskViewSearchParams(fromPairs(toTaskViewSearchPairs(v)))`
 * equals `v` after canonical normalization.
 */
export function toTaskViewSearchPairs(view: TaskViewDefinition): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const encodedFields = new Set<string>();

  for (const filter of view.filters) {
    if (
      filter.field === "estimate" &&
      filter.operator === "between" &&
      !encodedFields.has("estimate")
    ) {
      encodedFields.add("estimate");
      if (filter.values[0] !== "") pairs.push(["estimateMin", filter.values[0]]);
      if (filter.values[1] !== "") pairs.push(["estimateMax", filter.values[1]]);
      continue;
    }

    const key = legacyFilterKey(filter);
    if (key && !encodedFields.has(filter.field)) {
      encodedFields.add(filter.field);
      if (filter.field === "due_within_days") {
        pairs.push([key, filter.values[0]]);
      } else {
        pairs.push([key, filter.values.join(",")]);
      }
      continue;
    }

    const value =
      filter.operator === "between"
        ? (filter.values[1] ?? "")
        : filter.values.join(",");
    pairs.push(["filter", `${filter.field}:${filter.operator}:${value}`]);
  }

  if (view.search) pairs.push(["q", view.search]);
  if (view.groupBy !== "none") pairs.push(["group", view.groupBy]);
  if (view.sort.key !== "updated" || view.sort.direction !== "desc") {
    pairs.push(["sort", view.sort.key]);
    if (view.sort.direction !== DEFAULT_SORT_DIRECTION[view.sort.key]) {
      pairs.push(["dir", view.sort.direction]);
    }
  }
  if (view.activeOnly) pairs.push(["tasks", "active"]);

  const columns = serializeTaskTableColumns(view.columns);
  if (columns.cols) pairs.push(["cols", columns.cols]);
  if (columns.widths) pairs.push(["widths", columns.widths]);

  return pairs;
}

export function toTaskViewSearchParams(view: TaskViewDefinition): URLSearchParams {
  return new URLSearchParams(toTaskViewSearchPairs(view));
}

/** Map a legacy `TaskDueFilter` value onto the equivalent view filter. */
export function taskDueFilterToViewFilter(due: TaskDueFilter): TaskViewFilter | null {
  switch (due) {
    case "overdue":
      return { field: "due_bucket", operator: "is", values: ["overdue"] };
    case "due_today":
      return { field: "due_bucket", operator: "is", values: ["today"] };
    case "due_soon":
      return { field: "due_bucket", operator: "is", values: ["next_7_days"] };
    case "no_due_date":
      return { field: "due_bucket", operator: "is", values: ["none"] };
    default:
      return null;
  }
}

/** Map a legacy `TaskSortValue` onto the equivalent view sort. */
export function taskSortValueToViewSort(sort: TaskSortValue): TaskViewSort {
  switch (sort) {
    case "due_date_asc":
      return { key: "due", direction: "asc" };
    case "due_date_desc":
      return { key: "due", direction: "desc" };
    default:
      return DEFAULT_TASK_VIEW_SORT;
  }
}

/** Build a view definition from the pre-toolbar query fields. */
export function taskViewFromLegacyInput(input: {
  status?: TaskStatus | string | null;
  priority?: TaskPriority | ReadonlyArray<string> | string | null;
  projectId?: string | null;
  goalId?: string | null;
  due?: TaskDueFilter | string | null;
  dueWithinDays?: number | string | null;
  estimateMinMinutes?: number | string | null;
  estimateMaxMinutes?: number | string | null;
  sort?: TaskSortValue | string | null;
  activeOnly?: boolean | null;
  search?: string | null;
}): TaskViewDefinition {
  const filters: TaskViewFilter[] = [];
  const statusValues = String(input.status ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is TaskStatus => isTaskStatus(value));
  if (statusValues.length > 0) {
    filters.push({
      field: "status",
      operator: statusValues.length === 1 ? "is" : "is_any_of",
      values: statusValues,
    });
  }
  const priorityValues = String(
    Array.isArray(input.priority) ? input.priority.join(",") : (input.priority ?? ""),
  )
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is TaskPriority => isTaskPriority(value));
  if (priorityValues.length > 0) {
    filters.push({
      field: "priority",
      operator: priorityValues.length === 1 ? "is" : "is_any_of",
      values: priorityValues,
    });
  }
  if (input.projectId) {
    const normalized = normalizeFilter({
      field: "project",
      operator: "is",
      values: [input.projectId],
    });
    if (normalized) filters.push(normalized);
  }
  if (input.goalId) {
    const normalized = normalizeFilter({
      field: "goal",
      operator: "is",
      values: [input.goalId],
    });
    if (normalized) filters.push(normalized);
  }
  if (input.due && isTaskDueFilter(String(input.due))) {
    const dueFilter = taskDueFilterToViewFilter(String(input.due) as TaskDueFilter);
    if (dueFilter) filters.push(dueFilter);
  }
  if (input.dueWithinDays !== null && input.dueWithinDays !== undefined && input.dueWithinDays !== "") {
    const normalized = normalizeFilter({
      field: "due_within_days",
      operator: "is",
      values: [String(input.dueWithinDays)],
    });
    if (normalized) filters.push(normalized);
  }
  if (
    (input.estimateMinMinutes !== null && input.estimateMinMinutes !== undefined && input.estimateMinMinutes !== "") ||
    (input.estimateMaxMinutes !== null && input.estimateMaxMinutes !== undefined && input.estimateMaxMinutes !== "")
  ) {
    const normalized = normalizeFilter({
      field: "estimate",
      operator: "between",
      values: [
        String(input.estimateMinMinutes ?? ""),
        String(input.estimateMaxMinutes ?? ""),
      ],
    });
    if (normalized) filters.push(normalized);
  }

  const sort =
    input.sort && isTaskSortValue(String(input.sort))
      ? taskSortValueToViewSort(String(input.sort) as TaskSortValue)
      : DEFAULT_TASK_VIEW_SORT;

  return {
    version: TASK_VIEW_DEFINITION_VERSION,
    filters: filters.sort((left, right) => filterSortKey(left) - filterSortKey(right)),
    groupBy: "none",
    sort,
    search: normalizeSearch(input.search ?? null) ?? "",
    activeOnly: input.activeOnly === true,
  };
}
