import {
  ExecutionEvidenceSessionRow,
  ExecutionEvidenceWindow,
  calculateExecutionEvidenceForWindow,
} from './execution-evidence-service';

export type WorkAnalyticsPeriod = {
  totalWorkedMinutes: number;
  sessionCount: number;
  completedTaskCount?: number; // undefined if not computed
};

export type WorkAnalyticsOptions = {
  nowIso?: string;
  includeOpenSessions?: boolean; // default false for completed sessions only
};

/**
 * Aggregates work analytics for a given time window.
 * @param sessions Raw session data from task_sessions table (with tasks relation)
 * @param window Start and end of the period to analyze (in ISO strings)
 * @param options Optional configuration (now for mocking, includeOpenSessions)
 * @returns Period totals for worked time and session count
 */
export function calculateWorkAnalytics(
  sessions: ExecutionEvidenceSessionRow[],
  window: ExecutionEvidenceWindow,
  options: WorkAnalyticsOptions = {}
): WorkAnalyticsPeriod {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const includeOpenSessions = options.includeOpenSessions ?? false;

  const evidence = calculateExecutionEvidenceForWindow(sessions, window, {
    nowIso,
    includeOpenSessions,
  });

  return {
    totalWorkedMinutes: Math.floor(evidence.totalTrackedSeconds / 60),
    sessionCount: evidence.sessionCount,
    completedTaskCount: undefined,
  };
}