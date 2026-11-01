import type { OperatorSnapshot, OperatorTask } from "@ega/application";

import type { TaskDueBucket } from "@ega/domain";

import { buildTaskListUrl, type TaskViewFilter } from "@/lib/task-list";
import { getTaskContextHref } from "@/lib/task-navigation";
import { isTaskCompletedStatus } from "@/lib/task-domain";

import type {
  HomeDashboardData,
  HomeDashboardGroup,
  HomeDashboardTask,
} from "./home-dashboard-data";

export type HomeAttention = {
  overdue: number;
  dueToday: number;
  reviewMissing: boolean;
};

export type HomeActiveTimer = {
  sessionId: string;
  taskId: string;
  task: OperatorTask | null;
  /** Canonical session start, when the bounded timer read succeeded. */
  startedAt: string | null;
};

/**
 * Compact Today progress scoped to the Today projection. `completedCount`
 * belongs to the Today plan — it is never labeled as a universal
 * "tasks completed today" metric.
 */
export type HomeTodayProgress = {
  completedCount: number;
  /** planned + inProgress + completed in the Today projection. */
  totalCount: number;
  plannedCount: number;
  inProgressCount: number;
  totalEstimateMinutes: number;
  /** Completed share of the Today projection; null when nothing is planned. */
  ratio: number | null;
};

export type HomeAvailability = {
  operator: "available" | "unavailable";
  attention: "available" | "unavailable";
};

/** Compact task row shared by the deadline and My-tasks previews. */
export type HomeTaskPreview = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  projectName: string | null;
  projectSlug: string | null;
  href: string;
};

/**
 * A stat's exact scope total. `count: null` means the aggregate read failed and
 * the UI must not render a fabricated zero.
 */
export type HomeStat = {
  count: number | null;
  href: string;
};

export type HomeStats = {
  activeProjects: HomeStat & { atRiskCount: number | null };
  openTasks: HomeStat;
  completedThisWeek: HomeStat;
  overdue: HomeStat;
  trackedThisWeek: { minutes: number | null; href: string };
};

export type HomeDeadlineBucketKey = "today" | "tomorrow" | "thisWeek";

export type HomeDeadlineBucket = {
  key: HomeDeadlineBucketKey;
  label: string;
  /** Destination scope for the whole bucket (all tasks, not just previews). */
  href: string;
  count: number | null;
  tasks: HomeTaskPreview[];
};

export const HOME_MY_TASKS_TAB_VALUES = ["upcoming", "overdue", "completed"] as const;
export type HomeMyTasksTabKey = (typeof HOME_MY_TASKS_TAB_VALUES)[number];

export type HomeMyTasksTab = {
  key: HomeMyTasksTabKey;
  label: string;
  /** URL state for switching the Home tab. */
  href: string;
  /** Canonical Tasks destination with the same scope as the tab count. */
  viewAllHref: string;
  count: number | null;
  tasks: HomeTaskPreview[];
};

export type HomeMyTasks = {
  activeTab: HomeMyTasksTabKey;
  tabs: HomeMyTasksTab[];
};

export type HomeModel = {
  /** Canonical local date (YYYY-MM-DD) from the Operator snapshot. */
  date: string;
  /** Canonical IANA timezone from the Operator snapshot. */
  timezone: string;
  activeTimer: HomeActiveTimer | null;
  startHere: OperatorTask | null;
  /** At most one next actionable focus task; null when absent. */
  nextUp: OperatorTask | null;
  todayProgress: HomeTodayProgress | null;
  /** Null when shell attention metrics are unavailable (degraded). */
  attention: HomeAttention | null;
  availability: HomeAvailability;
  stats: HomeStats;
  deadlines: HomeDeadlineBucket[];
  myTasks: HomeMyTasks;
};

const HOME_DEADLINE_LABELS: Record<HomeDeadlineBucketKey, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  thisWeek: "This week",
};

const HOME_MY_TASKS_LABELS: Record<HomeMyTasksTabKey, string> = {
  upcoming: "Upcoming",
  overdue: "Overdue",
  completed: "Completed",
};

export function resolveHomeMyTasksTab(value: unknown): HomeMyTasksTabKey {
  const normalized = String(value ?? "").trim();
  return HOME_MY_TASKS_TAB_VALUES.includes(normalized as HomeMyTasksTabKey)
    ? (normalized as HomeMyTasksTabKey)
    : "upcoming";
}

function toHomeTaskPreview(task: HomeDashboardTask): HomeTaskPreview {
  return {
    ...task,
    href: getTaskContextHref(task.id, task.projectSlug),
  };
}

function mapPreviewTasks(group: HomeDashboardGroup | undefined | null): HomeTaskPreview[] {
  return (group?.tasks ?? []).map(toHomeTaskPreview);
}

const dueBucketFilter = (
  bucket: TaskDueBucket,
  operator: "is" | "is_not" = "is",
): TaskViewFilter => ({ field: "due_bucket", operator, values: [bucket] });

/** Canonical Tasks URL for a due scope, ordered by due date. */
function buildDueScopeHref(filters: readonly TaskViewFilter[], activeOnly = false) {
  return buildTaskListUrl("/tasks", {
    filters,
    activeTasks: activeOnly,
    sortKey: "due",
    sortDirection: "asc",
  });
}

function buildDeadlines(dashboard: HomeDashboardData | null): HomeDeadlineBucket[] {
  const windows: Array<{
    key: HomeDeadlineBucketKey;
    group: HomeDashboardGroup | undefined;
    filters: readonly TaskViewFilter[];
  }> = [
    { key: "today", group: dashboard?.deadlines.today, filters: [dueBucketFilter("today")] },
    {
      key: "tomorrow",
      group: dashboard?.deadlines.tomorrow,
      // within the next day, excluding today, is exactly tomorrow
      filters: [
        { field: "due_within_days", operator: "is", values: ["1"] },
        dueBucketFilter("today", "is_not"),
      ],
    },
    {
      key: "thisWeek",
      // The canonical EGA bucket is the next seven days; Home labels it This week
      // and states the real window in its accessible name.
      group: dashboard?.deadlines.thisWeek,
      filters: [dueBucketFilter("next_7_days")],
    },
  ];

  return windows.map(({ key, group, filters }) => ({
    key,
    label: HOME_DEADLINE_LABELS[key],
    href: buildDueScopeHref(filters, true),
    count: group?.count ?? null,
    tasks: mapPreviewTasks(group),
  }));
}

function buildMyTasks(
  dashboard: HomeDashboardData | null,
  requestedTab: unknown,
): HomeMyTasks {
  const tabs: HomeMyTasksTab[] = [
    {
      key: "upcoming",
      label: HOME_MY_TASKS_LABELS.upcoming,
      href: "/home?myTasks=upcoming",
      viewAllHref: buildDueScopeHref([dueBucketFilter("overdue", "is_not")], true),
      count: dashboard?.myTasks.upcoming.count ?? null,
      tasks: mapPreviewTasks(dashboard?.myTasks.upcoming),
    },
    {
      key: "overdue",
      label: HOME_MY_TASKS_LABELS.overdue,
      href: "/home?myTasks=overdue",
      viewAllHref: buildDueScopeHref([dueBucketFilter("overdue")]),
      count: dashboard?.myTasks.overdue.count ?? null,
      tasks: mapPreviewTasks(dashboard?.myTasks.overdue),
    },
    {
      key: "completed",
      label: HOME_MY_TASKS_LABELS.completed,
      href: "/home?myTasks=completed",
      // Completed is all-time in the list; Home's completed-this-week stat is a
      // separate weekly analytics scope and never masquerades as this tab.
      viewAllHref: buildTaskListUrl("/tasks", {
        filters: [{ field: "status", operator: "is", values: ["done"] }],
        view: "all",
      }),
      count: dashboard?.myTasks.completed.count ?? null,
      tasks: mapPreviewTasks(dashboard?.myTasks.completed),
    },
  ];

  return { activeTab: resolveHomeMyTasksTab(requestedTab), tabs };
}

function buildStats(
  dashboard: HomeDashboardData | null,
  attention: HomeAttention | null,
): HomeStats {
  const activeProjects = dashboard?.stats.activeProjects ?? null;

  return {
    activeProjects: {
      count: activeProjects?.count ?? null,
      atRiskCount: activeProjects?.atRiskCount ?? null,
      href: "/tasks/projects?view=active",
    },
    openTasks: {
      count: dashboard?.stats.openTasks ?? null,
      href: buildTaskListUrl("/tasks", { activeTasks: true }),
    },
    completedThisWeek: {
      count: dashboard?.stats.completedThisWeek ?? null,
      href: "/work-analytics?range=this-week",
    },
    // Shell attention and the overdue destination share the same canonical
    // day window and status/archive scope.
    overdue: {
      count: attention?.overdue ?? null,
      href: buildDueScopeHref([dueBucketFilter("overdue")]),
    },
    trackedThisWeek: {
      minutes: dashboard?.stats.trackedThisWeekMinutes ?? null,
      href: "/work-analytics?range=this-week",
    },
  };
}

function findTask(snapshot: OperatorSnapshot, taskId: string): OperatorTask | null {
  const pools: OperatorTask[][] = [
    snapshot.sections.planned,
    snapshot.sections.inProgress,
    snapshot.sections.blocked,
    snapshot.sections.completed,
    snapshot.focus.queue,
    snapshot.plannedToday,
    snapshot.suggestions.pinned,
    snapshot.suggestions.inProgress,
  ];

  for (const pool of pools) {
    const match = pool.find((task) => task.id === taskId);
    if (match) return match;
  }

  return null;
}

function buildTodayProgress(summary: OperatorSnapshot["summary"]): HomeTodayProgress {
  const totalCount = summary.plannedCount + summary.inProgressCount + summary.completedCount;
  return {
    completedCount: summary.completedCount,
    totalCount,
    plannedCount: summary.plannedCount,
    inProgressCount: summary.inProgressCount,
    totalEstimateMinutes: summary.totalEstimateMinutes,
    ratio: totalCount > 0 ? Math.round((summary.completedCount / totalCount) * 100) : null,
  };
}

/**
 * Composes the minimal authenticated Home from canonical sources only.
 *
 * - Primary focus is the active timer when one exists, otherwise the canonical
 *   Operator `focus.startHere` (no Home-only ranker).
 * - `nextUp` is at most one distinct actionable focus item after Start Here,
 *   never duplicating Start Here or the active Timer task.
 * - Attention counts reuse the canonical shell metrics. A null `attention`
 *   marks an unavailable/degraded shell read so the UI never fabricates a
 *   verified clear state.
 * - The full focus queue and snapshot sections are NOT part of the Home
 *   contract: the queue belongs to Today/Tasks, and Home renders at most one
 *   next task.
 */
export function buildHomeModel(input: {
  snapshot: OperatorSnapshot | null;
  attention: HomeAttention | null;
  activeTimerStartedAt?: string | null;
  dashboard?: HomeDashboardData | null;
  myTasksTab?: unknown;
}): HomeModel {
  const { snapshot, attention } = input;
  const dashboard = input.dashboard ?? null;
  const activeTimer = snapshot?.activeTimer ?? null;
  const startHere = snapshot?.focus.startHere ?? null;
  const queue = snapshot?.focus.queue ?? [];

  const activeTimerTask = snapshot && activeTimer ? findTask(snapshot, activeTimer.taskId) : null;

  const nextUp =
    queue.find(
      (task) =>
        task.id !== startHere?.id &&
        task.id !== activeTimer?.taskId &&
        task.status !== "blocked" &&
        !isTaskCompletedStatus(task.status),
    ) ?? null;

  return {
    date: snapshot?.date ?? "",
    timezone: snapshot?.timezone ?? "",
    activeTimer: activeTimer
      ? {
          sessionId: activeTimer.sessionId,
          taskId: activeTimer.taskId,
          task: activeTimerTask,
          startedAt: input.activeTimerStartedAt ?? null,
        }
      : null,
    startHere,
    nextUp,
    todayProgress: snapshot ? buildTodayProgress(snapshot.summary) : null,
    attention,
    availability: {
      operator: snapshot !== null ? "available" : "unavailable",
      attention: attention !== null ? "available" : "unavailable",
    },
    stats: buildStats(dashboard, attention),
    deadlines: buildDeadlines(dashboard),
    myTasks: buildMyTasks(dashboard, input.myTasksTab),
  };
}
