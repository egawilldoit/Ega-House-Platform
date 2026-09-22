/**
 * Work Analytics Report Builder
 *
 * Consolidates all analytics computations into a single call so sessions
 * are normalized once and windows are computed consistently.
 *
 * Each metric delegates to the existing calculator functions from
 * work-analytics-service.ts — no algorithms are duplicated here.
 *
 * Window authority: the caller fetches one bounded evidence window (see
 * computeEvidenceWindowForRange) and this builder filters those sessions to the
 * exact canonical window for each section. The selected-range metrics use
 * computeWindowForRange(filters.range) — never an approximate day count.
 */

import type { ExecutionEvidenceSessionRow, ExecutionEvidenceWindow } from "./execution-evidence-service";
import {
  calculateWorkAnalytics,
  calculateWorkAnalyticsCoreSummary,
  calculateWorkAnalyticsDailySeries,
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
  DrilldownSessionDTO,
  WorkAnalyticsOptions,
} from "./work-analytics-service";
import {
  computeDateRangeForWindow,
  computeLast30DaysWindow,
  computeWindowForRange,
  RANGE_LABELS,
  type AnalyticsFilterValues,
  type AnalyticsBreakdownBy,
  type AnalyticsRange,
} from "./work-analytics-filters";

export type WorkAnalyticsTaskCounts = {
  completedCount: number;
  createdCount: number;
  blockedCount: number;
};

/** Selected-range summary. Its time and task counts all share the selected window. */
export type WorkAnalyticsSelectedSummary = {
  workedMinutes: number;
  sessionCount: number;
  activeDays: number;
  averageSessionLengthMinutes: number;
  averageWorkPerActiveDayMinutes: number;
  completedTaskCount: number;
  createdTaskCount: number;
  blockedTaskCount: number;
};

/**
 * Compact DTO returned by buildWorkAnalyticsReport.
 * Contains all metrics needed by page.tsx and the export route.
 */
export type WorkAnalyticsReport = {
  selectedRange: AnalyticsRange;
  selectedRangeLabel: string;
  selectedSummary: WorkAnalyticsSelectedSummary;
  selectedSeries: WorkAnalyticsDaily[];
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
  /** Date drilldowns for the fixed recent-7-day chart, scoped to its own window. */
  recentDateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
  /** Date drilldowns for the fixed 30-day trend chart, scoped to its own window. */
  trendDateDrilldownIndex: Record<string, DrilldownSessionDTO[]>;
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
 * @param sessions  Pre-fetched execution evidence covering the union evidence window
 * @param taskCounts Task counts for the selected window and the fixed 30-day context,
 *                   fetched with explicit windows so the two never mix
 * @param filters   Parsed analytics filter values (range, groupBy, breakdownBy, includeOpen)
 * @param now       Reference date/time for window computation
 */
export function buildWorkAnalyticsReport(
  sessions: ExecutionEvidenceSessionRow[],
  taskCounts: { selected: WorkAnalyticsTaskCounts; last30d: WorkAnalyticsTaskCounts },
  filters: AnalyticsFilterValues,
  now: Date,
): WorkAnalyticsReport {
  const nowIso = now.toISOString();
  const options: WorkAnalyticsOptions = {
    nowIso,
    includeOpenSessions: filters.includeOpen,
  };

  // 1. Selected-range window is the canonical authority (calendar-correct for
  //    mtm/qtd/prev-month, not an approximate day count).
  const selectedWindow = computeWindowForRange(filters.range, now);
  const selectedDates = computeDateRangeForWindow(selectedWindow);

  // 2. Selected-range summary: time, active days and task counts share this window.
  const selectedCore = calculateWorkAnalytics(sessions, selectedWindow, options);
  const selectedDaily = calculateWorkAnalyticsDailySeries(
    sessions,
    selectedDates.startDate,
    selectedDates.endDate,
    options,
  );
  const selectedActiveDays = selectedDaily.filter((day) => day.workedMinutes > 0).length;
  const selectedSummary: WorkAnalyticsSelectedSummary = {
    workedMinutes: selectedCore.totalWorkedMinutes,
    sessionCount: selectedCore.sessionCount,
    activeDays: selectedActiveDays,
    averageSessionLengthMinutes:
      selectedCore.sessionCount > 0
        ? Math.round(selectedCore.totalWorkedMinutes / selectedCore.sessionCount)
        : 0,
    averageWorkPerActiveDayMinutes:
      selectedActiveDays > 0
        ? Math.round(selectedCore.totalWorkedMinutes / selectedActiveDays)
        : 0,
    completedTaskCount: taskCounts.selected.completedCount,
    createdTaskCount: taskCounts.selected.createdCount,
    blockedTaskCount: taskCounts.selected.blockedCount,
  };

  const selectedSeries = calculateWorkAnalyticsGroupedSeries(
    sessions,
    selectedDates.startDate,
    selectedDates.endDate,
    filters.groupBy,
    options,
  );

  // 3. Fixed 30-day context (uses its own exact calendar windows and the 30-day task counts).
  const monthWindow = computeLast30DaysWindow(now);
  const summary = calculateWorkAnalyticsCoreSummary(sessions, monthWindow, taskCounts.last30d, options);

  // 4. Yesterday
  const yesterdayStart = daysAgoIsoDate(1, now);
  const yesterdaySeries = calculateWorkAnalyticsGroupedSeries(
    sessions,
    yesterdayStart,
    yesterdayStart,
    "day",
    options,
  );
  const yesterday = yesterdaySeries[0] ?? { workedMinutes: 0, sessionCount: 0 };

  // 5. Week window for insights
  const weekWindow = windowFromDays(7, now);
  const thisWeekInsights = calculateWorkAnalyticsInsights(sessions, weekWindow, options);

  // 6. 7-day and 30-day series for trend charts. The recent chart is a fixed
  // daily rhythm, so it always groups by day regardless of the selected grouping.
  const recentStartDate = daysAgoIsoDate(6, now);
  const recentWindow: ExecutionEvidenceWindow = {
    startIso: `${recentStartDate}T00:00:00.000Z`,
    endIso: nowIso,
  };
  const last7DaysSeries = calculateWorkAnalyticsGroupedSeries(
    sessions,
    recentStartDate,
    nowIso.slice(0, 10),
    "day",
    options,
  );
  const trendStartDate = daysAgoIsoDate(29, now);
  const trendWindow: ExecutionEvidenceWindow = {
    startIso: `${trendStartDate}T00:00:00.000Z`,
    endIso: nowIso,
  };
  const last30DaysSeries = calculateWorkAnalyticsGroupedSeries(
    sessions,
    trendStartDate,
    nowIso.slice(0, 10),
    "day",
    options,
  );

  // 7. Breakdowns (selected window)
  const breakdownBy: AnalyticsBreakdownBy = filters.breakdownBy;
  const projectBreakdown = calculateWorkAnalyticsProjectBreakdown(sessions, selectedWindow, options);
  const goalBreakdown = calculateWorkAnalyticsGoalBreakdown(sessions, selectedWindow, options);
  const taskBreakdown = calculateWorkAnalyticsTaskBreakdown(sessions, selectedWindow, options);

  // 8. Month-to-date comparison (calendar months, from the evidence superset)
  const monthComparison = calculateWorkAnalyticsMonthComparison(sessions, options);

  // 9. Estimate accuracy (selected window)
  const estimateAccuracy = calculateEstimateAccuracy(sessions, selectedWindow, options);

  // 10. Compact drilldown indexes. Entity and primary-chart drilldowns are
  // selected-window authoritative; the fixed recent chart gets its own 7-day index.
  const drilldownIndexes = buildDrilldownIndexes(sessions, selectedWindow, options);
  const recentDateDrilldownIndex = buildDrilldownIndexes(
    sessions,
    recentWindow,
    options,
  ).date;
  const trendDateDrilldownIndex = buildDrilldownIndexes(
    sessions,
    trendWindow,
    options,
  ).date;

  // 11. Breakdown title
  const breakdownTitle =
    breakdownBy === "goal"
      ? "Goal breakdown"
      : breakdownBy === "task"
        ? "Task breakdown"
        : "Project breakdown";

  return {
    selectedRange: filters.range,
    selectedRangeLabel: RANGE_LABELS[filters.range],
    selectedSummary,
    selectedSeries,
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
    recentDateDrilldownIndex,
    trendDateDrilldownIndex,
  };
}
