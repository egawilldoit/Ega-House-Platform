import type { OperatorSnapshot, OperatorTask } from "@ega/application";

import type { WorkspaceShellMetrics } from "@/lib/workspace-shell";
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

export type HomeModel = {
  activeTimer: HomeActiveTimer | null;
  startHere: OperatorTask | null;
  nextUp: OperatorTask | null;
  attention: HomeAttention;
  snapshotUnavailable: boolean;
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

/**
 * Composes the minimal authenticated Home from canonical sources only.
 *
 * - Primary focus is the active timer when one exists, otherwise the canonical
 *   Operator `focus.startHere` (no Home-only ranker).
 * - `nextUp` is at most one distinct actionable focus item after Start Here.
 * - Attention counts reuse `WorkspaceShellMetrics` (the same shell semantics as
 *   the top bar and EGA-647), so Home cannot disagree with other screens.
 */
export function buildHomeModel(input: {
  snapshot: OperatorSnapshot | null;
  metrics: WorkspaceShellMetrics;
  activeTimerStartedAt?: string | null;
}): HomeModel {
  const { snapshot, metrics } = input;
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
    attention: {
      overdue: metrics.overdueTaskCount,
      dueToday: metrics.dueTodayTaskCount,
      reviewMissing: metrics.reviewMissing,
    },
    snapshotUnavailable: snapshot === null,
  };
}
