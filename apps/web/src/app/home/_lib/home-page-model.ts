import type { OperatorSnapshot, OperatorTask } from "@ega/application";

import { isTaskCompletedStatus } from "@/lib/task-domain";

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
  /** Compact list of planned/active tasks for today (max 5). */
  todayTasks: OperatorTask[];
  /** Null when shell attention metrics are unavailable (degraded). */
  attention: HomeAttention | null;
  availability: HomeAvailability;
};

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
 * - `todayTasks` gathers up to 5 planned or in-progress tasks for Today's Focus.
 */
export function buildHomeModel(input: {
  snapshot: OperatorSnapshot | null;
  attention: HomeAttention | null;
  activeTimerStartedAt?: string | null;
}): HomeModel {
  const { snapshot, attention } = input;
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

  const rawTodayTasks = snapshot
    ? [
        ...(snapshot.plannedToday ?? []),
        ...(snapshot.sections.inProgress ?? []),
        ...(snapshot.sections.planned ?? []),
      ]
    : [];

  const seenIds = new Set<string>();
  const todayTasks: OperatorTask[] = [];
  for (const t of rawTodayTasks) {
    if (!seenIds.has(t.id)) {
      seenIds.add(t.id);
      todayTasks.push(t);
      if (todayTasks.length >= 5) break;
    }
  }

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
    todayTasks,
    attention,
    availability: {
      operator: snapshot !== null ? "available" : "unavailable",
      attention: attention !== null ? "available" : "unavailable",
    },
  };
}
