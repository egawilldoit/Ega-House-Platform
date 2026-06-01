/**
 * Work Analytics Report Builder
 *
 * Consolidates all analytics computations into a single call so sessions
 * are normalized once and windows are computed consistently.
 *
 * Each metric delegates to the existing calculator functions from
 * work-analytics-service.ts — no algorithms are duplicated here.
 * The value is in the data flow: single session normalization,
 * consistent window computation, and a compact returned DTO.
 */

import type { ExecutionEvidenceSessionRow, ExecutionEvidenceWindow } from "./execution-evidence-service";
import {
  calculateWorkAnalyticsCoreSummary,
  calculateWorkAnalyticsGroupedSeries,
  calculateWorkAnalyticsInsights,
  calculateWorkAnalyticsMonthComparison,
  calculateWorkAnalyticsProjectBreakdown,
  calculateWorkAnalyticsGoalBreakdown,
  calculateWorkAnalyticsTaskBreakdown,
  calculateEstimateAccuracy,
  buildDrilldownIndexes,
} from "./work-analytics-service";
import type {
  WorkAnalyticsCoreSummary,
  WorkAnalyticsDaily,
  WorkAnalyticsInsights,
  WorkAnalyticsMonthComparison,
  WorkAnalyticsProjectBreakdown,
  WorkAnalyticsGoalBreakdown,
  WorkAnalyticsTaskBreakdown,
  EstimateAccuracySummary,
  DrilldownIndexes,
  WorkAnalyticsOptions,
} from "./work-analytics-service";
import type { AnalyticsFilterValues, AnalyticsBreakdownBy } from "./work-analytics-filters";

/**
 * Compact DTO returned by buildWorkAnalyticsReport.
 * Contains all metrics needed by page.tsx and the export route.
 */
export type WorkAnalyticsReport = {
  summary: WorkAnalyticsCoreSummary;
  last7DaysSeries: WorkAnalyticsDaily[];
  last30DaysSeries: WorkAnalyticsDaily[];
  yesterday: { workedMinutes: number; sessionCount: number };
  thisWeekInsights: WorkAnalyticsInsights;
  monthComparison: WorkAnalyticsMonthComparison;
  breakdownBy: AnalyticsBreakdownBy;
  breakdownTitle: string;
  projectBreakdown: WorkAnalyticsProjectBreakdown[];
  goalBreakdown: WorkAnalyticsGoalBreakdown[];
  taskBreakdown: WorkAnalyticsTaskBreakdown[];
  estimateAccuracy: EstimateAccuracySummary;
  drilldownIndexes: DrilldownIndexes;
};

// ── Helpers ────────────────────────────────────────────────────────────

function daysAgoIsoDate(days: number, now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function windowFromDays(days: number, now: Date): ExecutionEvidenceWindow {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

// ── Report builder ─────────────────────────────────────────────────────

/**
 * Build a compact WorkAnalyticsReport from raw sessions, task counts, filters, and now.
 *
 * Sessions are fetched once by the caller. This function computes all metrics
 * in sequence using the same sessions, delegating to existing calculator functions.
 * Windows are computed internally from the filter range and the `now` date.
 *
 * @param sessions  Pre-fetched execution evidence session rows (for the primary window)
 * @param taskCounts Task counts from getWorkAnalyticsTaskCounts
 * @param filters   Parsed analytics filter values (range, groupBy, breakdownBy, includeOpen)
 * @param now       Reference date/time for window computation
 * @returns A compact WorkAnalyticsReport DTO with all metrics pre-computed
 */
export function buildWorkAnalyticsReport(
  sessions: ExecutionEvidenceSessionRow[],
  taskCounts: { completedCount: number; createdCount: number; blockedCount: number },
  filters: AnalyticsFilterValues,
  now: Date,
): WorkAnalyticsReport {
  const nowIso = now.toISOString();
  const options: WorkAnalyticsOptions = {
    nowIso,
    includeOpenSessions: filters.includeOpen,
  };

  // 1. Primary window (used for breakdowns, estimate accuracy, drilldowns)
  const primaryWindow = windowFromDays(
    filters.range === "today" ? 0 : filters.range === "7d" ? 7 : filters.range === "30d" ? 30 : filters.range === "mtm" ? 30 : filters.range === "prev-month" ? 60 : 30,
    now,
  );

  // 2. Summary (always uses 30d for consistency with summary cards)
  const monthWindow = windowFromDays(30, now);
  const summary = calculateWorkAnalyticsCoreSummary(sessions, monthWindow, taskCounts, options);

  // 3. Yesterday
  const yesterdayStart = daysAgoIsoDate(1, now);
  const yesterdaySeries = calculateWorkAnalyticsGroupedSeries(
    sessions,
    yesterdayStart,
    yesterdayStart,
    "day",
    options,
  );
  const yesterday = yesterdaySeries[0] ?? { workedMinutes: 0, sessionCount: 0 };

  // 4. Week window for insights
  const weekWindow = windowFromDays(7, now);
  const thisWeekInsights = calculateWorkAnalyticsInsights(sessions, weekWindow, options);

  // 5. 7-day and 30-day series for trend charts
  const last7DaysSeries = calculateWorkAnalyticsGroupedSeries(
    sessions,
    daysAgoIsoDate(6, now),
    nowIso.slice(0, 10),
    filters.groupBy,
    options,
  );
  const last30DaysSeries = calculateWorkAnalyticsGroupedSeries(
    sessions,
    daysAgoIsoDate(29, now),
    nowIso.slice(0, 10),
    filters.groupBy,
    options,
  );

  // 6. Breakdowns (using primary window)
  const breakdownBy: AnalyticsBreakdownBy = filters.breakdownBy;
  const projectBreakdown = calculateWorkAnalyticsProjectBreakdown(sessions, primaryWindow, options);
  const goalBreakdown = calculateWorkAnalyticsGoalBreakdown(sessions, primaryWindow, options);
  const taskBreakdown = calculateWorkAnalyticsTaskBreakdown(sessions, primaryWindow, options);

  // 7. Month-to-date comparison
  const monthComparison = calculateWorkAnalyticsMonthComparison(sessions, options);

  // 8. Estimate accuracy
  const estimateAccuracy = calculateEstimateAccuracy(sessions, primaryWindow, options);

  // 9. Compact drilldown indexes
  const drilldownIndexes = buildDrilldownIndexes(sessions, primaryWindow, options);

  // 10. Breakdown title
  const breakdownTitle =
    breakdownBy === "goal"
      ? "Goal breakdown"
      : breakdownBy === "task"
        ? "Task breakdown"
        : "Project breakdown";

  return {
    summary,
    last7DaysSeries,
    last30DaysSeries,
    yesterday,
    thisWeekInsights,
    monthComparison,
    breakdownBy,
    breakdownTitle,
    projectBreakdown,
    goalBreakdown,
    taskBreakdown,
    estimateAccuracy,
    drilldownIndexes,
  };
}
