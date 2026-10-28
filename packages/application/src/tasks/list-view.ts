import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  taskViewFromLegacyInput,
  type TaskDueFilter,
  type TaskSortValue,
  type TaskViewDefinition,
} from "@ega/contracts/common/task-list";
import type {
  MobileTaskCounters,
  MobileTaskGoal,
  MobileTaskGroup,
  MobileTaskListItem,
  MobileTaskListFilters,
  MobileTaskProject,
} from "@ega/contracts/mobile";
import {
  isTaskDueToday,
  isTaskOverdue,
  type TaskPriority,
  type TaskStatus,
} from "@ega/domain";

import type { TaskGoalOptionRecord, TaskProjectOptionRecord, TaskQuery, TaskRecord } from "./ports";
import {
  applyTaskView,
  filterTaskViewRecords,
  type TaskViewRecord,
} from "./view";

/**
 * Hard ceiling on rows fetched for one list request; keeps payloads bounded.
 *
 * The adapter may load several pages up to this ceiling, so a filtered view is
 * not silently limited to the historical 500-row first page. The read model
 * still reports `loaded` vs `total` so a larger dataset is called out.
 */
export const TASK_LIST_ROW_CAP = 5000;
export const TASK_LIST_MAX_LIMIT = 200;

function trackedSeconds(record: TaskRecord) {
  return typeof record.totalDurationSeconds === "number"
    ? Math.max(0, Math.round(record.totalDurationSeconds))
    : 0;
}

export function toMobileTaskListItem(record: TaskRecord): MobileTaskListItem {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    blockedReason: record.blockedReason,
    status: record.status,
    priority: record.priority,
    dueDate: record.dueDate,
    plannedForDate: record.plannedForDate,
    archivedAt: record.archivedAt,
    estimateMinutes: record.estimateMinutes,
    updatedAt: record.updatedAt,
    focusRank: record.focusRank,
    trackedDurationSeconds: trackedSeconds(record),
    project: {
      id: record.projectId,
      name: record.projectName ?? "Unknown project",
      slug: record.projectSlug ?? null,
    },
    goal: record.goalId
      ? {
          id: record.goalId,
          title: record.goalTitle ?? "Unknown goal",
        }
      : null,
    reminders: record.reminders.map((reminder) => ({
      id: reminder.id,
      taskId: reminder.taskId,
      remindAt: reminder.remindAt,
      channel: reminder.channel,
      deliveryMode: reminder.deliveryMode ?? "email",
      status: reminder.status,
      sentAt: reminder.sentAt,
      failureReason: reminder.failureReason,
      createdAt: reminder.createdAt ?? "",
      updatedAt: reminder.updatedAt ?? "",
    })),
    recurrence: record.recurrence
      ? {
          rule: record.recurrence.rule,
          anchorDate: record.recurrence.anchorDate,
          timezone: record.recurrence.timezone,
          nextOccurrenceDate: record.recurrence.nextOccurrenceDate,
          lastGeneratedAt: record.recurrence.lastGeneratedAt,
        }
      : null,
  };
}

export function computeMobileTaskCounters(
  items: MobileTaskListItem[],
  today: string,
  scope?: Readonly<{ loaded?: number; truncated?: boolean }>,
): MobileTaskCounters {
  const counters: MobileTaskCounters = {
    total: 0,
    byStatus: { todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 },
    byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
    pinned: 0,
    overdue: 0,
    dueToday: 0,
    loaded: scope?.loaded ?? items.length,
    truncated: scope?.truncated ?? false,
  };

  for (const item of items) {
    counters.byStatus[item.status as TaskStatus] += 1;
    counters.byPriority[item.priority as TaskPriority] += 1;
    counters.total += 1;
    if (item.focusRank !== null) counters.pinned += 1;
    if (isTaskOverdue(item.dueDate, item.status, today)) counters.overdue += 1;
    if (isTaskDueToday(item.dueDate, item.status, today)) counters.dueToday += 1;
  }

  return counters;
}

/**
 * Resolve the effective scope filters the way the mobile contract echoes
 * them back: requested project/goal ids are nulled when they do not exist in
 * the owner's workspace, and a goal outside the active project is ignored.
 */
function resolveScopeFilters(
  query: TaskQuery,
  projects: TaskProjectOptionRecord[],
  goals: TaskGoalOptionRecord[],
) {
  const activeProjectId =
    query.projectId && projects.some((project) => project.id === query.projectId)
      ? query.projectId
      : null;
  const visibleGoals = activeProjectId
    ? goals.filter((goal) => goal.projectId === activeProjectId)
    : goals;
  const activeGoalId =
    query.goalId && visibleGoals.some((goal) => goal.id === query.goalId)
      ? query.goalId
      : null;

  return { activeProjectId, activeGoalId, visibleGoals };
}

function toViewRecord(record: TaskRecord): TaskViewRecord {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    status: record.status,
    priority: record.priority,
    projectId: record.projectId,
    projectName: record.projectName,
    goalId: record.goalId,
    goalTitle: record.goalTitle,
    dueDate: record.dueDate,
    plannedForDate: record.plannedForDate,
    estimateMinutes: record.estimateMinutes,
    boardRank: record.boardRank,
    focusRank: record.focusRank,
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt,
  };
}

function legacyDueFromView(view: TaskViewDefinition): TaskDueFilter {
  const filter = view.filters.find(
    (entry) => entry.field === "due_bucket" && entry.operator === "is",
  );
  switch (filter?.values[0]) {
    case "overdue":
      return "overdue";
    case "today":
      return "due_today";
    case "next_7_days":
      return "due_soon";
    case "none":
      return "no_due_date";
    default:
      return DEFAULT_TASK_DUE_FILTER;
  }
}

function legacySortFromView(view: TaskViewDefinition): TaskSortValue {
  if (view.sort.key === "updated" && view.sort.direction === "desc") {
    return DEFAULT_TASK_SORT;
  }
  if (view.sort.key === "due" && view.sort.direction === "asc") return "due_date_asc";
  if (view.sort.key === "due" && view.sort.direction === "desc") return "due_date_desc";
  return DEFAULT_TASK_SORT;
}

function singleScalarValue(view: TaskViewDefinition, field: "status" | "priority") {
  const filter = view.filters.find(
    (entry) => entry.field === field && (entry.operator === "is" || entry.operator === "is_any_of"),
  );
  return filter?.values[0] ?? null;
}

export type MobileTaskListViewInput = Readonly<{
  records: TaskRecord[];
  projects: TaskProjectOptionRecord[];
  goals: TaskGoalOptionRecord[];
  query: TaskQuery;
  /**
   * Canonical local date (YYYY-MM-DD) for the authenticated owner, resolved
   * from Time Context by the caller. The read model must never derive the
   * owner's calendar day from the process timezone.
   */
  today: string;
}>;

export type MobileTaskListView = Readonly<{
  items: MobileTaskListItem[];
  counters: MobileTaskCounters;
  filters: MobileTaskListFilters;
  groups: MobileTaskGroup[];
  projects: MobileTaskProject[];
  goals: MobileTaskGoal[];
}>;

/**
 * Build the canonical enriched task-list payload.
 *
 * Filtering, sorting, grouping and counting run through the shared
 * `applyTaskView` engine, the same engine the web surface uses. Counters and
 * group counts describe the full filtered scope BEFORE the limit slice so
 * clients can render totals and truncation state without extra requests.
 *
 * `input.today` is the owner's canonical local date resolved from Time
 * Context by the caller; due semantics are evaluated against it, never against
 * the process timezone.
 */
export function buildMobileTaskListView(input: MobileTaskListViewInput): MobileTaskListView {
  const today = input.today;
  const query = input.query;
  const { activeProjectId, activeGoalId, visibleGoals } = resolveScopeFilters(
    query,
    input.projects,
    input.goals,
  );

  const scopedRecords = activeProjectId || activeGoalId
    ? input.records.filter(
        (record) =>
          (!activeProjectId || record.projectId === activeProjectId) &&
          (!activeGoalId || record.goalId === activeGoalId),
      )
    : input.records;

  const view =
    query.view ??
    taskViewFromLegacyInput({
      status: query.status,
      priority: query.priority,
      projectId: activeProjectId,
      goalId: activeGoalId,
      due: query.due,
      sort: query.sort,
    });

  const viewRecords = scopedRecords.map(toViewRecord);
  const result = applyTaskView(viewRecords, view, {
    today,
    limit: query.limit,
    totalCount: query.totalCount,
  });
  const filteredAll = filterTaskViewRecords(viewRecords, view, { today });
  const recordById = new Map(scopedRecords.map((record) => [record.id, record]));
  const items = result.items
    .map((record) => recordById.get(record.id))
    .filter((record): record is TaskRecord => Boolean(record))
    .map(toMobileTaskListItem);

  // Counters describe the full filtered set, not the paginated page.
  const allItems = filteredAll
    .map((record) => recordById.get(record.id))
    .filter((record): record is TaskRecord => Boolean(record))
    .map(toMobileTaskListItem);
  const counters = computeMobileTaskCounters(allItems, today, {
    loaded: items.length,
    truncated: result.truncated,
  });
  // `total` is the exact owner-scoped filtered count when the transport supplied
  // one; `loaded` remains the number of rows in this payload.
  counters.total = result.totalCount;

  return {
    items,
    counters,
    filters: {
      status: singleScalarValue(view, "status") as TaskStatus | null,
      projectId: activeProjectId,
      goalId: activeGoalId,
      priority: singleScalarValue(view, "priority") as TaskPriority | null,
      due: legacyDueFromView(view),
      sort: legacySortFromView(view),
      plannedForDate: query.plannedForDate ?? null,
      includeArchived: query.includeArchived ?? false,
      limit: query.limit && query.limit > 0 ? Math.floor(query.limit) : null,
      search: view.search,
      groupBy: view.groupBy,
      sortKey: view.sort.key,
      sortDirection: view.sort.direction,
    },
    groups: result.groups.map((group) => ({
      key: group.key,
      label: group.label,
      count: group.count,
    })),
    projects: input.projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
    })),
    goals: visibleGoals.map((goal) => ({ id: goal.id, title: goal.title })),
  };
}
