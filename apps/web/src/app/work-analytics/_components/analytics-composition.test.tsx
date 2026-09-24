import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";

import { WorkAnalyticsPageView } from "./WorkAnalyticsPageView";
import type { WorkAnalyticsPageModel } from "../_lib/work-analytics-page-model";
import type { DrilldownSessionDTO } from "@/lib/services/work-analytics-service";
import type { WorkAnalyticsReport } from "@/lib/services/work-analytics-report-builder";

const session: DrilldownSessionDTO = {
  taskId: "t1",
  taskTitle: "Ship the refactor",
  projectName: "Alpha",
  projectId: "p1",
  goalTitle: "Design system",
  goalId: "g1",
  startedAt: "2026-09-14T09:00:00.000Z",
  endedAt: "2026-09-14T10:00:00.000Z",
  durationSeconds: 3600,
};

const report: WorkAnalyticsReport = {
  selectedRange: "30d",
  selectedRangeLabel: "Last 30 days",
  selectedSummary: {
    workedMinutes: 300,
    sessionCount: 9,
    activeDays: 5,
    averageSessionLengthMinutes: 33,
    averageWorkPerActiveDayMinutes: 60,
    completedTaskCount: 2,
    createdTaskCount: 3,
    blockedTaskCount: 1,
  },
  selectedSeries: [
    { date: "2026-09-14", workedMinutes: 60, sessionCount: 2 },
    { date: "2026-09-15", workedMinutes: 90, sessionCount: 3 },
  ],
  summary: {
    todayWorkedMinutes: 30,
    todaySessionCount: 1,
    last7DaysWorkedMinutes: 120,
    last7DaysSessionCount: 4,
    last30DaysWorkedMinutes: 300,
    last30DaysSessionCount: 9,
    activeDays: 5,
    averageWorkPerActiveDayMinutes: 60,
    averageSessionLengthMinutes: 33,
    completedTaskCount: 2,
    createdTaskCount: 3,
    blockedTaskCount: 1,
  },
  last7DaysSeries: [
    { date: "2026-09-08", workedMinutes: 30, sessionCount: 1 },
    { date: "2026-09-09", workedMinutes: 0, sessionCount: 0 },
  ],
  last30DaysSeries: [
    { date: "2026-08-16", workedMinutes: 20, sessionCount: 1 },
    { date: "2026-09-14", workedMinutes: 60, sessionCount: 2 },
  ],
  yesterday: { workedMinutes: 45, sessionCount: 2 },
  thisWeekInsights: {
    previousPeriodWorkedMinutes: 90,
    deltaMinutes: 30,
    percentChange: 33,
    bestDay: { date: "2026-09-15", workedMinutes: 90, sessionCount: 3 },
    lowestNonZeroDay: { date: "2026-09-08", workedMinutes: 30, sessionCount: 1 },
    daysWorkedCount: 3,
    currentStreak: 2,
    averageSessionLength: 30,
    longestSession: 60,
    shortestNonZeroSession: 15,
  },
  monthComparison: {
    currentMonthMinutes: 200,
    currentMonthSessionCount: 6,
    currentMonthActiveDays: 4,
    currentMonthAvgPerActiveDayMinutes: 50,
    previousMonthMinutes: 150,
    previousMonthSessionCount: 5,
    deltaMinutes: 50,
    percentChange: 33,
    hasPreviousData: true,
  },
  breakdownBy: "project",
  breakdownTitle: "Project breakdown",
  projectBreakdown: [{ projectId: "p1", projectName: "Alpha", workedMinutes: 200, sessionCount: 6 }],
  goalBreakdown: [],
  taskBreakdown: [],
  selectedComparison: {
    previousPeriodWorkedMinutes: 30,
    deltaMinutes: 30,
    percentChange: 100,
    bestDay: null,
    lowestNonZeroDay: null,
    daysWorkedCount: 1,
    currentStreak: 1,
    averageSessionLength: 60,
    longestSession: 60,
    shortestNonZeroSession: 60,
  },
  selectedComparisonLabel: "vs previous 30 days",
  selectedSeriesRollingAverage: [
    { date: "2026-09-14", workedMinutes: 60, sessionCount: 0 },
  ],
  weekdayDistribution: [
    { weekday: 0, label: "Mon", workedMinutes: 60, sessionCount: 1 },
  ],
  recentDateDrilldownIndex: { "2026-09-14": [session] },
  estimateAccuracy: {
    totalEstimatedMinutes: 240,
    totalTrackedMinutes: 300,
    estimateDeltaMinutes: 60,
    estimateDeltaPercent: 25,
    overCount: 1,
    underCount: 0,
    exactCount: 1,
    noEstimateCount: 2,
    tasks: [],
    projectAccuracy: [],
  },
  drilldownIndexes: {
    date: { "2026-09-14": [session] },
    project: { p1: [session] },
    goal: { g1: [session] },
    task: { t1: [session] },
  },
};

const model = {
  user: { id: "user-1" },
  error: null,
  report,
  filters: { range: "30d", groupBy: "day", breakdownBy: "project", includeOpen: false },
} as unknown as WorkAnalyticsPageModel;

test("WorkAnalyticsPageView renders the reference composition", () => {
  const markup = renderToStaticMarkup(<WorkAnalyticsPageView model={model} />);

  assert.match(markup, /Focused time/);
  assert.match(markup, /Average session/);
  assert.match(markup, /Estimate variance/);
  assert.match(markup, /Focused time over time/);
  assert.match(markup, /Rhythm and allocation/);
  assert.match(markup, /Weekly rhythm/);
  assert.match(markup, /Project breakdown/);
  assert.match(markup, /Weekday pattern/);
  assert.match(markup, /Recent focus sessions/);
  assert.match(markup, /Ship the refactor/);
  assert.match(markup, /View all/);
  assert.match(markup, /Month-to-date/);
  assert.match(markup, /Change vs previous month/);
  assert.match(markup, /role="img"/);
  assert.match(markup, /<table class="sr-only">/);
});

test("estimate variance leads with the absolute delta, then the ratio, then the percentage", () => {
  const markup = renderToStaticMarkup(<WorkAnalyticsPageView model={model} />);
  const start = markup.indexOf('data-testid="analytics-kpi-estimate-variance"');
  assert.ok(start > -1, "expected the estimate variance KPI card");
  const card = markup.slice(start, start + 2000);

  const absoluteIndex = card.indexOf("+1h");
  const ratioIndex = card.indexOf("1.3×");
  const percentIndex = card.indexOf("+25%");

  assert.ok(absoluteIndex > -1, "expected the absolute delta on the estimate KPI");
  assert.ok(ratioIndex > -1, "expected the ratio on the estimate KPI");
  assert.ok(percentIndex > -1, "expected the demoted percentage on the estimate KPI");
  assert.ok(absoluteIndex < ratioIndex, "the absolute delta must lead the ratio");
  assert.ok(ratioIndex < percentIndex, "the ratio must lead the percentage");
});

test("a chart bucket click opens the drilldown for its sessions", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<WorkAnalyticsPageView model={model} />);
  });

  const hitTarget = container.querySelector('[role="button"][aria-label^="Mon, Sep 14"]');
  assert.ok(hitTarget, "expected the chart bucket hit target to be reachable");

  await act(async () => {
    hitTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const bodyText = document.body.textContent ?? "";
  assert.match(bodyText, /Sessions on Sep 14/);
  assert.match(bodyText, /Ship the refactor/);
  assert.match(bodyText, /1h total/);

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
