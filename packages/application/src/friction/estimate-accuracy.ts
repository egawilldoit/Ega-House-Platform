import {
  getFrictionEstimatePercentError,
  getFrictionEstimateSeverity,
  isMeaningfulFrictionEstimate,
} from "@ega/domain/friction";
import type { FrictionEstimateSignal } from "@ega/contracts/friction";

import {
  calculateExecutionEvidenceForWindow,
  getExecutionEvidenceSessionOverlapSeconds,
  type ExecutionEvidenceSessionRow,
  type ExecutionEvidenceWindow,
} from "../shared/execution-evidence";

export type EstimateAccuracyOptions = Readonly<{
  nowIso?: string;
  includeOpenSessions?: boolean;
}>;

/**
 * Estimate accuracy friction — only evaluates Tasks with both a meaningful
 * estimate and tracked execution evidence within the supplied window.
 *
 * Actual time is derived from canonical execution evidence (clipped overlap
 * per session, no double-count of window time). Tasks without meaningful
 * estimate (`<5 minutes`, null/undefined) or without tracked evidence
 * (`actualMinutes === 0`) are excluded.
 *
 * Thresholds deterministic (domain-owned): `>50%` → medium, `>100%` → high.
 * Uses canonical ordered-session evidence ordering only indirectly via
 * execution-evidence aggregation, and window boundaries are caller-supplied
 * via EGA-523 time-context windows (e.g. `getLocalDayWindow`).
 */
export function getEstimateAccuracySignals(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: EstimateAccuracyOptions = {},
): FrictionEstimateSignal[] {
  const includeOpen = options.includeOpenSessions === true;
  const nowIso = options.nowIso;

  // Canonical aggregation — per-task trackedSeconds already clipped to window,
  // each session counted once, window half-open [start, end).
  const evidence = calculateExecutionEvidenceForWindow(sessions, window, {
    nowIso,
    includeOpenSessions: includeOpen,
  });

  // Build metadata map from sessions that actually contributed (>0 overlap).
  // We scan again with overlap helper to ensure we only consider contributing
  // sessions for estimate/title resolution.
  type TaskMeta = {
    estimateMinutes: number | null;
    title: string;
    projectId: string;
    goalId: string | null;
  };
  const metaByTask = new Map<string, TaskMeta>();

  for (const session of sessions) {
    const overlap = getExecutionEvidenceSessionOverlapSeconds(session, window, {
      nowIso,
      includeOpenSessions: includeOpen,
    });
    if (overlap <= 0) continue;
    // Only capture first meaningful estimate encountered; if later session has
    // different estimate we keep first — tasks.estimate_minutes is assumed
    // stable within a window. Caller can supply canonical task estimate via
    // tasks relation; we preserve the first non-null title/estimate.
    const taskId = session.task_id;
    if (metaByTask.has(taskId)) continue;
    const task = session.tasks;
    metaByTask.set(taskId, {
      estimateMinutes: typeof task?.estimate_minutes === "number" ? task.estimate_minutes : null,
      title: task?.title ?? "Untitled task",
      projectId: (task?.projects?.id ?? task?.project_id ?? "unknown") as string,
      goalId: (task?.goals?.id ?? task?.goal_id ?? null) as string | null,
    });
  }

  // Also ensure tasks that contributed but whose first session had null
  // metadata get filled from any contributing session that has metadata.
  // For simplicity, if first had null estimate but later has estimate, use it.
  for (const session of sessions) {
    const overlap = getExecutionEvidenceSessionOverlapSeconds(session, window, {
      nowIso,
      includeOpenSessions: includeOpen,
    });
    if (overlap <= 0) continue;
    const meta = metaByTask.get(session.task_id);
    if (!meta) continue;
    const task = session.tasks;
    if ((meta.estimateMinutes === null || meta.estimateMinutes === undefined) && typeof task?.estimate_minutes === "number") {
      meta.estimateMinutes = task.estimate_minutes;
    }
    if (meta.title === "Untitled task" && task?.title) {
      meta.title = task.title;
    }
  }

  const signals: FrictionEstimateSignal[] = [];

  for (const [taskId, trackedSeconds] of evidence.trackedSecondsByTask.entries()) {
    const actualMinutes = Math.floor(trackedSeconds / 60);
    if (actualMinutes <= 0) continue;

    const meta = metaByTask.get(taskId);
    const estimateMinutes = meta?.estimateMinutes ?? null;

    if (!isMeaningfulFrictionEstimate(estimateMinutes)) continue;
    // estimateMinutes is now guaranteed meaningful number
    const estimate = estimateMinutes as number;
    const percentError = getFrictionEstimatePercentError(actualMinutes, estimate);
    if (percentError === null) continue;

    const severity = getFrictionEstimateSeverity(percentError);
    if (severity !== "medium" && severity !== "high") continue;

    const deltaMinutes = actualMinutes - estimate;
    let status: FrictionEstimateSignal["status"];
    if (actualMinutes === estimate) status = "exact";
    else if (actualMinutes > estimate) status = "over";
    else status = "under";

    // Handle Infinity case where estimate is 0 but we earlier filtered <5, so not reachable.
    // Keep for completeness: Infinity treated as over high.
    const safePercent = Number.isFinite(percentError) ? percentError : 999;

    signals.push({
      id: taskId,
      title: meta?.title ?? "Untitled task",
      projectId: meta?.projectId ?? "unknown",
      goalId: meta?.goalId ?? null,
      estimateMinutes: estimate,
      actualMinutes,
      deltaMinutes,
      percentError: safePercent,
      severity,
      status,
    });
  }

  // Deterministic ordering: highest absolute percentError first, then id.
  signals.sort((a, b) => {
    const absA = Math.abs(a.percentError);
    const absB = Math.abs(b.percentError);
    if (absA !== absB) return absB - absA;
    return a.id.localeCompare(b.id);
  });

  return signals;
}
