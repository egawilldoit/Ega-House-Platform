import {
  TASK_DUE_BUCKET_GROUP_ORDER,
  TASK_DUE_BUCKET_LABELS,
  TASK_PRIORITY_GROUP_ORDER,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_GROUP_ORDER,
  TASK_STATUS_LABELS,
  type TaskViewFilter,
  type TaskViewGroupBy,
  type TaskViewSort,
  type TaskViewDefinition,
} from "@ega/contracts/common/task-list";
import {
  getTaskDueBucket,
  isTaskCompletedStatus,
  isTaskDueSoon,
  isTaskDueWithinDays,
  type TaskPriority,
  type TaskStatus,
} from "@ega/domain";

/**
 * Minimal task shape the shared view engine needs. Both the web server model
 * and the Hono/api-client read model project their records onto this shape, so
 * filtering, grouping, ordering and counting cannot drift between surfaces.
 */
export type TaskViewRecord = Readonly<{
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  projectId: string;
  projectName?: string | null;
  goalId: string | null;
  goalTitle?: string | null;
  dueDate: string | null;
  plannedForDate?: string | null;
  estimateMinutes: number | null;
  /** 785 manual board rank; the canonical manual order for the shared view. */
  boardRank?: string | null;
  focusRank?: number | null;
  createdAt?: string | null;
  updatedAt: string;
}>;

export type TaskViewContext = Readonly<{
  /** Owner canonical local date (YYYY-MM-DD) from Time Context. */
  today: string;
}>;

export type TaskViewGroup<T extends TaskViewRecord> = Readonly<{
  key: string;
  label: string;
  /** Count across the full filtered set, even when `items` is paginated. */
  count: number;
  items: T[];
}>;

export type TaskViewResult<T extends TaskViewRecord> = Readonly<{
  items: T[];
  groups: TaskViewGroup<T>[];
  /** Tasks matching the filters, before the limit slice. */
  matchedCount: number;
  /** Tasks returned in `items`. */
  loadedCount: number;
  /** Owner-scoped total supplied by the caller, or `matchedCount` when absent. */
  totalCount: number;
  truncated: boolean;
}>;

const PRIORITY_RANK = new Map<TaskPriority, number>(
  TASK_PRIORITY_GROUP_ORDER.map((priority, index) => [priority, index]),
);
const STATUS_RANK = new Map<TaskStatus, number>(
  TASK_STATUS_GROUP_ORDER.map((status, index) => [status, index]),
);

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function compareText(left: string, right: string) {
  const leftNormalized = normalizeText(left);
  const rightNormalized = normalizeText(right);
  if (leftNormalized < rightNormalized) return -1;
  if (leftNormalized > rightNormalized) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNullable(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
  direction: "asc" | "desc",
  compare: (a: string | number, b: string | number) => number,
) {
  const hasLeft = left !== null && left !== undefined && left !== "";
  const hasRight = right !== null && right !== undefined && right !== "";
  // Missing values always sort last, in both directions, so an empty due date
  // cannot jump to the top of "oldest first".
  if (!hasLeft && !hasRight) return 0;
  if (!hasLeft) return 1;
  if (!hasRight) return -1;
  const result = compare(left, right);
  return direction === "asc" ? result : -result;
}

function compareNumbers(left: string | number, right: string | number) {
  return Number(left) - Number(right);
}

function compareStrings(left: string | number, right: string | number) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function matchesScalarFilter(
  value: string | null,
  filter: TaskViewFilter,
): boolean {
  const [first] = filter.values;
  switch (filter.operator) {
    case "is":
      return value !== null && value === first;
    case "is_not":
      // Null is "not that value" and therefore matches. This keeps the
      // operator's complement relationship with `is` explicit.
      return value !== first;
    case "is_any_of":
      return value !== null && filter.values.includes(value);
    case "is_none_of":
      return value === null || !filter.values.includes(value);
    default:
      return false;
  }
}

/**
 * `next_7_days` deliberately overlaps `today`: it is the legacy "due soon"
 * window (today through +7), so an old `?due=due_soon` link keeps its meaning.
 * Grouping still uses the disjoint `getTaskDueBucket` partition.
 */
function matchesDueBucket(record: TaskViewRecord, bucket: string, today: string) {
  if (bucket === "next_7_days") {
    return isTaskDueSoon(record.dueDate, record.status, today);
  }
  return getTaskDueBucket(record.dueDate, record.status, today) === bucket;
}

function matchesDueBucketFilter(
  record: TaskViewRecord,
  filter: TaskViewFilter,
  today: string,
) {
  const [first] = filter.values;
  switch (filter.operator) {
    case "is":
      return matchesDueBucket(record, first, today);
    case "is_not":
      return !matchesDueBucket(record, first, today);
    case "is_any_of":
      return filter.values.some((bucket) => matchesDueBucket(record, bucket, today));
    case "is_none_of":
      return !filter.values.some((bucket) => matchesDueBucket(record, bucket, today));
    default:
      return false;
  }
}

function matchesEstimateFilter(record: TaskViewRecord, filter: TaskViewFilter) {
  if (record.estimateMinutes === null) return false;
  const [rawMin, rawMax] = filter.values;
  const min = rawMin === "" ? null : Number(rawMin);
  const max = rawMax === "" ? null : Number(rawMax);
  if (min !== null && record.estimateMinutes < min) return false;
  if (max !== null && record.estimateMinutes > max) return false;
  return true;
}

export function matchesTaskViewFilter(
  record: TaskViewRecord,
  filter: TaskViewFilter,
  context: TaskViewContext,
) {
  switch (filter.field) {
    case "status":
      return matchesScalarFilter(record.status, filter);
    case "priority":
      return matchesScalarFilter(record.priority, filter);
    case "project":
      return matchesScalarFilter(record.projectId, filter);
    case "goal":
      return matchesScalarFilter(record.goalId, filter);
    case "due_bucket":
      return matchesDueBucketFilter(record, filter, context.today);
    case "due_within_days":
      return isTaskDueWithinDays(record.dueDate, context.today, Number(filter.values[0]));
    case "estimate":
      return matchesEstimateFilter(record, filter);
    default:
      return true;
  }
}

/**
 * Apply every filter with AND semantics. Search is a separate, case-insensitive
 * substring match over the title (also pushed down as `ilike` by adapters, so
 * the result does not depend on how many rows were loaded).
 */
export function filterTaskViewRecords<T extends TaskViewRecord>(
  records: readonly T[],
  view: Pick<TaskViewDefinition, "filters" | "search" | "activeOnly">,
  context: TaskViewContext,
): T[] {
  const search = normalizeText(view.search);

  return records.filter((record) => {
    if (view.activeOnly && isTaskCompletedStatus(record.status)) return false;
    if (search && !normalizeText(record.title).includes(search)) return false;

    return view.filters.every((filter) => matchesTaskViewFilter(record, filter, context));
  });
}

function sortValue(
  record: TaskViewRecord,
  key: TaskViewSort["key"],
) {
  switch (key) {
    case "manual":
      return record.boardRank ?? null;
    case "title":
      return record.title;
    case "due":
      return record.dueDate;
    case "planned":
      return record.plannedForDate ?? null;
    case "priority":
      return PRIORITY_RANK.get(record.priority as TaskPriority) ?? null;
    case "status":
      return STATUS_RANK.get(record.status as TaskStatus) ?? null;
    case "created":
      return record.createdAt ?? null;
    case "updated":
      return record.updatedAt;
    case "estimate":
      return record.estimateMinutes;
    default:
      return null;
  }
}

function compareSortValues(
  left: ReturnType<typeof sortValue>,
  right: ReturnType<typeof sortValue>,
  sort: TaskViewSort,
) {
  if (sort.key === "title") {
    return compareNullable(
      typeof left === "string" ? left : null,
      typeof right === "string" ? right : null,
      sort.direction,
      compareStrings,
    );
  }

  if (
    sort.key === "manual" ||
    sort.key === "priority" ||
    sort.key === "status" ||
    sort.key === "estimate"
  ) {
    return compareNullable(
      typeof left === "number" ? left : null,
      typeof right === "number" ? right : null,
      sort.direction,
      compareNumbers,
    );
  }

  return compareNullable(
    typeof left === "string" ? left : null,
    typeof right === "string" ? right : null,
    sort.direction,
    compareStrings,
  );
}

/**
 * Deterministic ordering. Every key breaks ties on the task id ascending, so two
 * items with the same title/due date/manual rank never swap between requests.
 */
export function sortTaskViewRecords<T extends TaskViewRecord>(
  records: readonly T[],
  sort: TaskViewSort,
): T[] {
  return [...records].sort((left, right) => {
    const result = compareSortValues(sortValue(left, sort.key), sortValue(right, sort.key), sort);
    if (result !== 0) return result;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function projectLabel(record: TaskViewRecord) {
  return record.projectName?.trim() || record.projectId || "No project";
}

function goalLabel(record: TaskViewRecord) {
  if (!record.goalId) return "No goal";
  return record.goalTitle?.trim() || record.goalId;
}

type GroupDefinition = Readonly<{ key: string; label: string; match: (record: TaskViewRecord) => boolean }>;

function fixedGroupDefinitions(groupBy: TaskViewGroupBy): GroupDefinition[] {
  if (groupBy === "status") {
    return TASK_STATUS_GROUP_ORDER.map((status) => ({
      key: status,
      label: TASK_STATUS_LABELS[status],
      match: (record) => record.status === status,
    }));
  }

  if (groupBy === "priority") {
    return TASK_PRIORITY_GROUP_ORDER.map((priority) => ({
      key: priority,
      label: TASK_PRIORITY_LABELS[priority],
      match: (record) => record.priority === priority,
    }));
  }

  return [];
}

/**
 * Group tasks in display order. Status and priority always return their full
 * enum (empty groups included) so a board/list can drop work into them; project
 * and goal return only groups present in the filtered set.
 */
export function groupTaskViewRecords<T extends TaskViewRecord>(
  records: readonly T[],
  groupBy: TaskViewGroupBy,
  context: TaskViewContext,
): TaskViewGroup<T>[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "All tasks", count: records.length, items: [...records] }];
  }

  if (groupBy === "status" || groupBy === "priority") {
    return fixedGroupDefinitions(groupBy).map((definition) => {
      const items = records.filter((record) => definition.match(record));
      return { key: definition.key, label: definition.label, count: items.length, items };
    });
  }

  if (groupBy === "due_bucket") {
    return TASK_DUE_BUCKET_GROUP_ORDER.map((bucket) => {
      const items = records.filter(
        (record) => getTaskDueBucket(record.dueDate, record.status, context.today) === bucket,
      );
      return {
        key: bucket,
        label: TASK_DUE_BUCKET_LABELS[bucket],
        count: items.length,
        items,
      };
    });
  }

  const groups = new Map<string, { label: string; items: T[] }>();
  for (const record of records) {
    const key = groupBy === "project" ? record.projectId : (record.goalId ?? "");
    const label = groupBy === "project" ? projectLabel(record) : goalLabel(record);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(record);
    } else {
      groups.set(key, { label, items: [record] });
    }
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key: key || "none",
      label: group.label,
      count: group.items.length,
      items: group.items,
    }))
    .sort((left, right) => {
      if (left.key === "none") return 1;
      if (right.key === "none") return -1;
      const labelResult = compareText(left.label, right.label);
      return labelResult !== 0 ? labelResult : compareText(left.key, right.key);
    });
}

/**
 * The single read-model entry point: filter → sort → count → group → limit.
 *
 * `totalCount` lets a transport pass an exact owner-scoped database count while
 * only loading a bounded page of rows. When it is larger than the loaded set the
 * result is explicitly marked truncated instead of pretending the page is the
 * whole answer.
 */
export function applyTaskView<T extends TaskViewRecord>(
  records: readonly T[],
  view: TaskViewDefinition,
  options: TaskViewContext & { limit?: number | null; totalCount?: number | null },
): TaskViewResult<T> {
  const filtered = filterTaskViewRecords(records, view, options);
  const sorted = sortTaskViewRecords(filtered, view.sort);
  const limit =
    options.limit && options.limit > 0 ? Math.floor(options.limit) : null;
  const items = limit ? sorted.slice(0, limit) : sorted;
  const matchedCount = filtered.length;
  const totalCount = Math.max(
    matchedCount,
    typeof options.totalCount === "number" && Number.isSafeInteger(options.totalCount)
      ? options.totalCount
      : matchedCount,
  );
  const groupCounts = new Map(
    groupTaskViewRecords(sorted, view.groupBy, options).map((group) => [group.key, group.count]),
  );
  const groups = groupTaskViewRecords(items, view.groupBy, options).map((group) => ({
    ...group,
    count: groupCounts.get(group.key) ?? group.count,
  }));

  return {
    items,
    groups,
    matchedCount,
    loadedCount: items.length,
    totalCount,
    truncated: totalCount > items.length,
  };
}
