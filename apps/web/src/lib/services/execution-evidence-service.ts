/**
 * Execution Evidence Service — web compatibility adapter.
 *
 * Canonical logic lives in @ega/application/shared/execution-evidence.
 * This module preserves existing web import paths while delegating to the
 * shared implementation so behavior is not forked.
 *
 * The adapter intentionally preserves the historic default:
 * `includeOpenSessions` defaults to `true` (include open sessions) for
 * backwards compatibility. New callers should import from
 * `@ega/application/shared/execution-evidence` directly and rely on its
 * documented `includeOnlyClosed` default (`false`).
 */
import {
  calculateExecutionEvidenceForWindow as calculateSharedEvidenceForWindow,
  calculateTotalTrackedSeconds as calculateSharedTotalTrackedSeconds,
  getExecutionEvidenceSessionDurationSeconds as getSharedDurationSeconds,
  getExecutionEvidenceSessionOverlapSeconds as getSharedOverlapSeconds,
  type ExecutionEvidenceSessionRow as SharedRow,
  type ExecutionEvidenceSummary as SharedSummary,
  type ExecutionEvidenceTimeBucket as SharedBucket,
  type ExecutionEvidenceWindow as SharedWindow,
} from "@ega/application/shared/execution-evidence";

export type ExecutionEvidenceWindow = SharedWindow;

export type ExecutionEvidenceSessionTask = NonNullable<SharedRow["tasks"]>;

export type ExecutionEvidenceSessionRow = SharedRow;

export type ExecutionEvidenceTimeBucket = SharedBucket;

export type ExecutionEvidenceSummary = {
  trackedSecondsByTask: Map<string, number>;
  totalTrackedSeconds: number;
  taskTimeBuckets: ExecutionEvidenceTimeBucket[];
  projectTimeBuckets: ExecutionEvidenceTimeBucket[];
  touchedProjectNames: string[];
  touchedGoalTitles: string[];
  sessionCount: number;
};

function toAdapterSummary(shared: SharedSummary): ExecutionEvidenceSummary {
  return {
    trackedSecondsByTask: shared.trackedSecondsByTask,
    totalTrackedSeconds: shared.totalTrackedSeconds,
    taskTimeBuckets: [...shared.taskTimeBuckets],
    projectTimeBuckets: [...shared.projectTimeBuckets],
    touchedProjectNames: [...shared.touchedProjectNames],
    touchedGoalTitles: [...shared.touchedGoalTitles],
    sessionCount: shared.sessionCount,
  };
}

export function getExecutionEvidenceSessionOverlapSeconds(
  session: ExecutionEvidenceSessionRow,
  window: ExecutionEvidenceWindow,
  options?: {
    nowIso?: string;
    includeOpenSessions?: boolean;
  },
) {
  // Historic web helper included open sessions by default; shared defaults to
  // exclude. Preserve historic behavior at the adapter boundary.
  const normalized = {
    nowIso: options?.nowIso,
    includeOpenSessions: options?.includeOpenSessions ?? true,
  };
  return getSharedOverlapSeconds(session, window, normalized);
}

export function calculateExecutionEvidenceForWindow(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options?: {
    nowIso?: string;
    includeOpenSessions?: boolean;
  },
): ExecutionEvidenceSummary {
  const normalized = {
    nowIso: options?.nowIso,
    includeOpenSessions: options?.includeOpenSessions ?? true,
  };
  const shared = calculateSharedEvidenceForWindow(sessions, window, normalized);
  return toAdapterSummary(shared);
}

export function calculateTotalTrackedSeconds(
  sessions: ExecutionEvidenceSessionRow[],
  nowIso = new Date().toISOString(),
) {
  // Delegate to shared total helper (handles duration_seconds fallback).
  return calculateSharedTotalTrackedSeconds(sessions, nowIso);
}

// Re-export canonical helpers under explicit names for new web code that
// wants richer evidence without importing @ega/application directly.
export const calculateCanonicalExecutionEvidenceForWindow = calculateSharedEvidenceForWindow;
export const getCanonicalSessionDurationSeconds = getSharedDurationSeconds;
export const getCanonicalSessionOverlapSeconds = getSharedOverlapSeconds;
