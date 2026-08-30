import {
  FRICTION_WORKLOAD_IMBALANCE_HIGH_SHARE_THRESHOLD,
  FRICTION_WORKLOAD_IMBALANCE_MIN_FOR_HIGH_MINUTES,
  FRICTION_WORKLOAD_IMBALANCE_MIN_TOTAL_MINUTES,
  FRICTION_WORKLOAD_IMBALANCE_SHARE_THRESHOLD,
  getFrictionWorkloadImbalanceSeverity,
  getFrictionWorkloadSharePercent,
} from "@ega/domain/friction";
import type { FrictionWorkloadImbalanceSignal } from "@ega/contracts/friction";

import {
  calculateExecutionEvidenceForWindow,
  type ExecutionEvidenceSessionRow,
  type ExecutionEvidenceWindow,
} from "../shared/execution-evidence";

export type WorkloadImbalanceOptions = Readonly<{
  nowIso?: string;
  includeOpenSessions?: boolean;
}>;

/**
 * Workload imbalance friction — when one Project consumes a disproportionate
 * share of tracked time in the supplied window.
 *
 * Uses canonical tracked-time aggregation from execution-evidence (no second
 * query). Share math is deterministic (rounded integer percent). Minimum-
 * evidence guards prevent sparse data from emitting:
 * - No signal until total >= FRICTION_WORKLOAD_IMBALANCE_MIN_TOTAL_MINUTES
 * - High-confidence requires total >= MIN_FOR_HIGH, otherwise capped at medium
 * - Single-project or zero-data yields deterministic math but `isImbalance=false`
 *
 * Historical-window fixtures remain stable independent of server timezone
 * because `window` is an explicit ISO range (e.g., from time-context's
 * `getWeekWindow("UTC", date)` or `getLocalDayWindow`), never process TZ.
 */
export function getWorkloadImbalanceSignal(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: WorkloadImbalanceOptions = {},
): FrictionWorkloadImbalanceSignal {
  const evidence = calculateExecutionEvidenceForWindow(sessions, window, {
    nowIso: options.nowIso,
    includeOpenSessions: options.includeOpenSessions === true,
  });

  const totalTrackedSeconds = evidence.totalTrackedSeconds;
  const totalTrackedMinutes = Math.floor(totalTrackedSeconds / 60);
  const projectCount = evidence.trackedSecondsByProject.size;

  let dominantProjectId: string | null = null;
  let dominantProjectName: string | null = null;
  let dominantTrackedSeconds = 0;

  if (projectCount > 0) {
    // Find max tracked seconds — deterministic tie-break by project id lexicographic.
    let maxSeconds = -1;
    let maxId: string | null = null;
    for (const [projectId, seconds] of evidence.trackedSecondsByProject.entries()) {
      if (seconds > maxSeconds || (seconds === maxSeconds && (maxId === null || projectId.localeCompare(maxId) < 0))) {
        maxSeconds = seconds;
        maxId = projectId;
      }
    }
    dominantProjectId = maxId;
    dominantTrackedSeconds = maxSeconds >= 0 ? maxSeconds : 0;

    // Resolve name via projectTimeBuckets (id -> label).
    if (dominantProjectId) {
      const bucket = evidence.projectTimeBuckets.find((b) => b.id === dominantProjectId);
      if (bucket) dominantProjectName = bucket.label;
      else {
        // Fallback: try any session's project name for that id.
        for (const s of sessions) {
          const pid = (s.tasks?.projects?.id ?? s.tasks?.project_id ?? null) as string | null;
          if (pid === dominantProjectId && s.tasks?.projects?.name) {
            dominantProjectName = s.tasks.projects.name;
            break;
          }
        }
      }
    }
  }

  const dominantSharePercent = getFrictionWorkloadSharePercent(dominantTrackedSeconds, totalTrackedSeconds);
  const severity = getFrictionWorkloadImbalanceSeverity(dominantSharePercent, totalTrackedMinutes, projectCount);
  const isImbalance = severity === "medium" || severity === "high";

  return {
    isImbalance,
    severity,
    totalTrackedSeconds,
    totalTrackedMinutes,
    projectCount,
    dominantProjectId,
    dominantProjectName,
    dominantTrackedSeconds,
    dominantSharePercent,
    threshold: FRICTION_WORKLOAD_IMBALANCE_SHARE_THRESHOLD,
    highThreshold: FRICTION_WORKLOAD_IMBALANCE_HIGH_SHARE_THRESHOLD,
    minTotalMinutes: FRICTION_WORKLOAD_IMBALANCE_MIN_TOTAL_MINUTES,
    minForHighMinutes: FRICTION_WORKLOAD_IMBALANCE_MIN_FOR_HIGH_MINUTES,
    window: { startIso: window.startIso, endIso: window.endIso },
  };
}
