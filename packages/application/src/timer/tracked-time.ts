/**
 * Estimate vs actual — canonical tracked-time and comparison read model.
 *
 * Owner: @ega/application (pure, framework-independent).
 *
 * ## One time policy
 * Per-task tracked time is the same quantity the Timer surface shows for a
 * task: the sum of `getSessionDurationSeconds` over that task's sessions. That
 * helper is the canonical session-duration policy (closed session =
 * `ended_at - started_at`, open session = now, malformed timestamps fall back
 * to the persisted `duration_seconds`). This module never re-derives a session
 * duration and never reads a second time store.
 *
 * ## Running sessions
 * A running (open) session contributes from its start until `nowIso`, exactly
 * like the Timer totals. Aggregates expose `hasOpenSessions` so a surface can
 * label the number as still moving; the value is not live-updated here.
 *
 * ## No window clipping
 * These are lifetime per-task totals. Callers that need a bounded window (for
 * example the weekly review) pass window-clipped seconds from the canonical
 * execution-evidence aggregation into `aggregateEstimateVsActual`; this module
 * does not re-sum sessions for that case.
 *
 * ## No invented values
 * `null` (or an invalid) estimate means "no estimate": there is nothing to
 * compare, and `compareEstimateToTracked` returns `null`. Tracked time is still
 * reported by callers. A zero-minute estimate is a real estimate; it is
 * comparable and never divides by zero.
 *
 * ## Over/under
 * The displayed percent is rounded. A rounded `0%` is reported as
 * `on_target` so the state always agrees with the visible number; the exact
 * `deltaSeconds` remains available. `under` means tracked below estimate.
 */

import { getSessionDurationSeconds } from "../shared/duration";

export type TrackedTaskSessionRow = Readonly<{
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
}>;

export type TrackedTimeOptions = Readonly<{
  nowIso?: string;
}>;

export type TrackedTimeByTask = Readonly<{
  trackedSecondsByTask: ReadonlyMap<string, number>;
  totalTrackedSeconds: number;
  /** Task ids with at least one running session (tracked time is provisional). */
  openSessionTaskIds: ReadonlySet<string>;
  hasOpenSessions: boolean;
  nowIso: string;
}>;

function resolveNowIso(value: unknown): string {
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function toFiniteSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * Sum canonical session durations per task, including running sessions up to
 * `nowIso`. Sessions with a blank task id are ignored; malformed rows still
 * follow the canonical duration helper instead of being silently re-scaled.
 */
export function calculateTrackedTimeByTask(
  sessions: readonly TrackedTaskSessionRow[],
  options: TrackedTimeOptions = {},
): TrackedTimeByTask {
  const nowIso = resolveNowIso(options.nowIso);
  const trackedSecondsByTask = new Map<string, number>();
  const openSessionTaskIds = new Set<string>();
  let totalTrackedSeconds = 0;

  for (const session of sessions) {
    const taskId = typeof session.taskId === "string" ? session.taskId.trim() : "";
    if (!taskId) continue;

    const seconds = getSessionDurationSeconds(
      {
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSeconds: session.durationSeconds,
      },
      nowIso,
    );
    const safeSeconds = toFiniteSeconds(seconds);

    trackedSecondsByTask.set(taskId, (trackedSecondsByTask.get(taskId) ?? 0) + safeSeconds);
    totalTrackedSeconds += safeSeconds;

    if (session.endedAt === null || session.endedAt === undefined) {
      openSessionTaskIds.add(taskId);
    }
  }

  return {
    trackedSecondsByTask,
    totalTrackedSeconds,
    openSessionTaskIds,
    hasOpenSessions: openSessionTaskIds.size > 0,
    nowIso,
  };
}

export type EstimateComparisonState = "over" | "under" | "on_target";

export type EstimateComparison = Readonly<{
  /** Normalized, non-negative whole-minute estimate. */
  estimateMinutes: number;
  estimateSeconds: number;
  trackedSeconds: number;
  /** Tracked minus estimate; positive means over. */
  deltaSeconds: number;
  deltaMinutes: number;
  /** Rounded percent over estimate, or null when the estimate is zero. */
  percent: number | null;
  state: EstimateComparisonState;
  hasTrackedTime: boolean;
  hasOpenSession: boolean;
}>;

export type EstimateComparisonInput = Readonly<{
  estimateMinutes: unknown;
  trackedSeconds: unknown;
  hasOpenSession?: boolean;
}>;

function normalizeEstimateMinutes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/**
 * Compare one estimate with tracked seconds. Returns `null` when no estimate
 * exists, so callers can omit the whole comparison instead of rendering a
 * placeholder ratio.
 */
export function compareEstimateToTracked(
  input: EstimateComparisonInput,
): EstimateComparison | null {
  const estimateMinutes = normalizeEstimateMinutes(input.estimateMinutes);
  if (estimateMinutes === null) return null;

  const trackedSeconds = toFiniteSeconds(input.trackedSeconds);
  const estimateSeconds = estimateMinutes * 60;
  const deltaSeconds = trackedSeconds - estimateSeconds;
  const percent =
    estimateSeconds > 0 ? Math.round((deltaSeconds / estimateSeconds) * 100) : null;

  let state: EstimateComparisonState;
  if (percent !== null) {
    state = percent > 0 ? "over" : percent < 0 ? "under" : "on_target";
  } else {
    // Zero estimate: any tracked work is over; no tracked work is on target.
    state = trackedSeconds > 0 ? "over" : "on_target";
  }

  return {
    estimateMinutes,
    estimateSeconds,
    trackedSeconds,
    deltaSeconds,
    deltaMinutes: Math.round(deltaSeconds / 60),
    percent,
    state,
    hasTrackedTime: trackedSeconds > 0,
    hasOpenSession: input.hasOpenSession === true,
  };
}

/** Tasks whose rounded error is within this band count as estimate-accurate. */
export const ESTIMATE_ACCURACY_TOLERANCE_PERCENT = 20;

export type EstimateTaskTime = Readonly<{
  taskId: string;
  title?: string | null;
  estimateMinutes: number | null;
  trackedSeconds: number;
  hasOpenSession?: boolean;
}>;

export type EstimateOverRun = Readonly<{
  taskId: string;
  title: string;
  comparison: EstimateComparison;
}>;

export type EstimateVsActualAggregate = Readonly<{
  taskCount: number;
  /** Tasks with a non-null estimate. */
  estimatedTaskCount: number;
  /** Tasks with tracked time (estimated or not). */
  trackedTaskCount: number;
  /** Sum of estimates; only estimated tasks contribute. */
  estimateMinutes: number;
  /** Tracked time on estimated tasks only. */
  trackedSeconds: number;
  /** Tracked time on every task, for honest coverage display. */
  trackedSecondsOnAllTasks: number;
  /** Null when no task has an estimate. */
  comparison: EstimateComparison | null;
  overTaskCount: number;
  underTaskCount: number;
  onTargetTaskCount: number;
  /** Estimated tasks with tracked time and a usable ratio. */
  evaluatedTaskCount: number;
  onTargetEvaluatedTaskCount: number;
  /** Rounded share of evaluated tasks within tolerance; null when none. */
  accuracyPercent: number | null;
  topOverRuns: EstimateOverRun[];
  hasOpenSessions: boolean;
}>;

export type EstimateAggregateOptions = Readonly<{
  /** How many over-runs to return. Defaults to 5; clamped to 0..50. */
  topOverRunLimit?: number;
}>;

function resolveOverRunLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.min(50, Math.max(0, Math.floor(value)));
}

/**
 * Aggregate task-level comparisons.
 *
 * The estimate and tracked totals only cover tasks that actually have an
 * estimate: adding tracked time from unestimated tasks would compare it with a
 * total that never estimated that work. `trackedSecondsOnAllTasks` and
 * `estimatedTaskCount` let a surface state that coverage honestly.
 */
export function aggregateEstimateVsActual(
  tasks: readonly EstimateTaskTime[],
  options: EstimateAggregateOptions = {},
): EstimateVsActualAggregate {
  let estimateMinutes = 0;
  let trackedSeconds = 0;
  let trackedSecondsOnAllTasks = 0;
  let estimatedTaskCount = 0;
  let trackedTaskCount = 0;
  let overTaskCount = 0;
  let underTaskCount = 0;
  let onTargetTaskCount = 0;
  let evaluatedTaskCount = 0;
  let onTargetEvaluatedTaskCount = 0;
  let hasOpenSessions = false;

  const overRuns: EstimateOverRun[] = [];

  for (const task of tasks) {
    const tracked = toFiniteSeconds(task.trackedSeconds);
    trackedSecondsOnAllTasks += tracked;
    if (tracked > 0) trackedTaskCount += 1;

    const comparison = compareEstimateToTracked({
      estimateMinutes: task.estimateMinutes,
      trackedSeconds: tracked,
      hasOpenSession: task.hasOpenSession,
    });
    if (!comparison) continue;

    estimatedTaskCount += 1;
    estimateMinutes += comparison.estimateMinutes;
    trackedSeconds += comparison.trackedSeconds;
    if (comparison.hasOpenSession) hasOpenSessions = true;

    if (comparison.state === "over") overTaskCount += 1;
    else if (comparison.state === "under") underTaskCount += 1;
    else onTargetTaskCount += 1;

    if (comparison.percent !== null && comparison.hasTrackedTime) {
      evaluatedTaskCount += 1;
      if (Math.abs(comparison.percent) <= ESTIMATE_ACCURACY_TOLERANCE_PERCENT) {
        onTargetEvaluatedTaskCount += 1;
      }
    }

    if (comparison.state === "over" && comparison.deltaSeconds > 0) {
      overRuns.push({
        taskId: task.taskId,
        title: task.title?.trim() || "Untitled task",
        comparison,
      });
    }
  }

  overRuns.sort(
    (left, right) =>
      right.comparison.deltaSeconds - left.comparison.deltaSeconds ||
      left.title.localeCompare(right.title) ||
      left.taskId.localeCompare(right.taskId),
  );

  const comparison =
    estimatedTaskCount > 0
      ? compareEstimateToTracked({
          estimateMinutes,
          trackedSeconds,
          hasOpenSession: hasOpenSessions,
        })
      : null;

  return {
    taskCount: tasks.length,
    estimatedTaskCount,
    trackedTaskCount,
    estimateMinutes,
    trackedSeconds,
    trackedSecondsOnAllTasks,
    comparison,
    overTaskCount,
    underTaskCount,
    onTargetTaskCount,
    evaluatedTaskCount,
    onTargetEvaluatedTaskCount,
    accuracyPercent:
      evaluatedTaskCount > 0
        ? Math.round((onTargetEvaluatedTaskCount / evaluatedTaskCount) * 100)
        : null,
    topOverRuns: overRuns.slice(0, resolveOverRunLimit(options.topOverRunLimit)),
    hasOpenSessions,
  };
}
