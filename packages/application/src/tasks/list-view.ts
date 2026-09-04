import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  type TaskDueFilter,
  type TaskSortValue,
} from "@ega/contracts/common/task-list";
import type {
  MobileTaskCounters,
  MobileTaskGoal,
  MobileTaskListItem,
  MobileTaskListFilters,
  MobileTaskProject,
} from "@ega/contracts/mobile";
import {
  getLocalTodayIsoDate,
  isTaskDueSoon,
  isTaskDueToday,
  isTaskOverdue,
  type TaskPriority,
  type TaskStatus,
} from "@ega/domain";

import type { TaskGoalOptionRecord, TaskProjectOptionRecord, TaskQuery, TaskRecord } from "./ports";

/** Hard ceiling on rows fetched for one list request; keeps payloads bounded. */
export const TASK_LIST_ROW_CAP = 500;
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

type DueSortable = Pick<TaskRecord, "dueDate" | "status" | "updatedAt">;

function filterByDueFilter<T extends DueSortable>(
  tasks: T[],
  dueFilter: TaskDueFilter,
  today: string,
): T[] {
  switch (dueFilter) {
    case "overdue":
      return tasks.filter((task) => isTaskOverdue(task.dueDate, task.status, today));
    case "due_today":
      return tasks.filter((task) => isTaskDueToday(task.dueDate, task.status, today));
    case "due_soon":
      return tasks.filter((task) => isTaskDueSoon(task.dueDate, task.status, today));
    case "no_due_date":
      return tasks.filter((task) => !task.dueDate);
    default:
      return tasks;
  }
}

function compareDueDates(
  left: string | null,
  right: string | null,
  direction: "asc" | "desc",
) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return direction === "asc"
    ? left.localeCompare(right)
    : right.localeCompare(left);
}

function sortByValue<T extends DueSortable>(tasks: T[], sortValue: TaskSortValue): T[] {
  return [...tasks].sort((left, right) => {
    if (sortValue === "due_date_asc") {
      const dueResult = compareDueDates(left.dueDate, right.dueDate, "asc");
      return dueResult !== 0 ? dueResult : right.updatedAt.localeCompare(left.updatedAt);
    }

    if (sortValue === "due_date_desc") {
      const dueResult = compareDueDates(left.dueDate, right.dueDate, "desc");
      return dueResult !== 0 ? dueResult : right.updatedAt.localeCompare(left.updatedAt);
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function computeMobileTaskCounters(
  items: MobileTaskListItem[],
  today = getLocalTodayIsoDate(),
): MobileTaskCounters {
  const counters: MobileTaskCounters = {
    total: 0,
    byStatus: { todo: 0, in_progress: 0, done: 0, blocked: 0 },
    byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
    pinned: 0,
    overdue: 0,
    dueToday: 0,
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

export type MobileTaskListViewInput = Readonly<{
  records: TaskRecord[];
  projects: TaskProjectOptionRecord[];
  goals: TaskGoalOptionRecord[];
  query: TaskQuery;
  now?: Date;
}>;

export type MobileTaskListView = Readonly<{
  items: MobileTaskListItem[];
  counters: MobileTaskCounters;
  filters: MobileTaskListFilters;
  projects: MobileTaskProject[];
  goals: MobileTaskGoal[];
}>;

/**
 * Build the canonical enriched task-list payload.
 *
 * Counters describe the full filtered scope BEFORE the limit slice so clients
 * can render totals and truncation state without extra requests.
 */
export function buildMobileTaskListView(input: MobileTaskListViewInput): MobileTaskListView {
  const today = getLocalTodayIsoDate(input.now ?? new Date());
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

  const orderedRecords = sortByValue(
    filterByDueFilter(scopedRecords, query.due ?? DEFAULT_TASK_DUE_FILTER, today),
    query.sort ?? DEFAULT_TASK_SORT,
  );

  // Counters cover the filtered scope before pagination, on the same
  // server-local "today" as the due filter.
  const allItems = orderedRecords.map(toMobileTaskListItem);
  const counters = computeMobileTaskCounters(allItems, today);

  const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : null;
  const items = limit ? allItems.slice(0, limit) : allItems;

  return {
    items,
    counters,
    filters: {
      status: query.status ?? null,
      projectId: activeProjectId,
      goalId: activeGoalId,
      priority: query.priority ?? null,
      due: query.due ?? DEFAULT_TASK_DUE_FILTER,
      sort: query.sort ?? DEFAULT_TASK_SORT,
      plannedForDate: query.plannedForDate ?? null,
      includeArchived: query.includeArchived ?? false,
      limit,
    },
    projects: input.projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
    })),
    goals: visibleGoals.map((goal) => ({ id: goal.id, title: goal.title })),
  };
}
