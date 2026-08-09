import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMonthWindow,
  getCurrentMonthWindow,
  formatDuration,
  buildEstimateAccuracySummary,
  buildMonthlyMarkdown,
} from "./route";
import type { ExecutionEvidenceWindow } from "@/lib/services/execution-evidence-service";

test("buildMonthWindow parses valid YYYY-MM input", () => {
  const result = buildMonthWindow("2026-06");
  assert.notEqual(result, null);
  assert.equal(result!.monthLabel, "June 2026");
  assert.equal(result!.window.startIso, "2026-06-01T00:00:00.000Z");
  assert.equal(result!.window.endIso, "2026-07-01T00:00:00.000Z");
});

test("buildMonthWindow returns null for invalid input", () => {
  assert.equal(buildMonthWindow("2026-13"), null); // invalid month
  assert.equal(buildMonthWindow("2026-0"), null); // zero-padded required
  assert.equal(buildMonthWindow("2026/06"), null); // wrong separator
  assert.equal(buildMonthWindow("invalid"), null); // not a date
  assert.equal(buildMonthWindow(""), null); // empty
});

test("buildMonthWindow handles edge month", () => {
  const result = buildMonthWindow("2025-01");
  assert.notEqual(result, null);
  assert.equal(result!.monthLabel, "January 2025");
  assert.equal(result!.window.startIso, "2025-01-01T00:00:00.000Z");
  assert.equal(result!.window.endIso, "2025-02-01T00:00:00.000Z");
});

test("buildMonthWindow handles December", () => {
  const result = buildMonthWindow("2026-12");
  assert.notEqual(result, null);
  assert.equal(result!.monthLabel, "December 2026");
  assert.equal(result!.window.startIso, "2026-12-01T00:00:00.000Z");
  assert.equal(result!.window.endIso, "2027-01-01T00:00:00.000Z");
});

test("getCurrentMonthWindow returns valid window", () => {
  const result = getCurrentMonthWindow();
  assert.ok(result.window.startIso);
  assert.ok(result.window.endIso);
  assert.ok(result.window.startIso < result.window.endIso);
  assert.ok(result.monthLabel.length > 0);
});

test("formatDuration formats various durations", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(30), "30m");
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(90), "1h 30m");
  assert.equal(formatDuration(1440), "24h");
  assert.equal(formatDuration(1), "1m");
});

test("buildEstimateAccuracySummary handles empty breakdown", () => {
  const result = buildEstimateAccuracySummary([]);
  assert.equal(result.totalEstimatedMinutes, 0);
  assert.equal(result.totalTrackedMinutes, 0);
  assert.equal(result.noEstimateCount, 0);
  assert.deepEqual(result.tasks, []);
});

test("buildEstimateAccuracySummary categorizes tasks correctly", () => {
  const breakdown = [
    {
      taskId: "t1",
      taskTitle: "Exact match",
      goalTitle: null,
      projectName: "Proj",
      workedMinutes: 60,
      sessionCount: 2,
      estimateMinutes: 60,
      percentOfTotal: 50,
    },
    {
      taskId: "t2",
      taskTitle: "Over-estimated",
      goalTitle: null,
      projectName: "Proj",
      workedMinutes: 30,
      sessionCount: 1,
      estimateMinutes: 60,
      percentOfTotal: 25,
    },
    {
      taskId: "t3",
      taskTitle: "Under-estimated",
      goalTitle: null,
      projectName: "Proj",
      workedMinutes: 120,
      sessionCount: 3,
      estimateMinutes: 60,
      percentOfTotal: 25,
    },
    {
      taskId: "t4",
      taskTitle: "No estimate",
      goalTitle: null,
      projectName: null,
      workedMinutes: 45,
      sessionCount: 1,
      estimateMinutes: null,
      percentOfTotal: 0,
    },
  ];

  const result = buildEstimateAccuracySummary(breakdown);
  assert.equal(result.totalTrackedMinutes, 255); // 60 + 30 + 120 + 45
  assert.equal(result.totalEstimatedMinutes, 180); // 60 + 60 + 60 + 0
  assert.equal(result.overEstimatedCount, 1); // t2
  assert.equal(result.underEstimatedCount, 1); // t3
  assert.equal(result.exactCount, 1); // t1
  assert.equal(result.noEstimateCount, 1); // t4
  assert.equal(result.tasks.length, 4);
  assert.equal(result.tasks[0].status, "exact");
  assert.equal(result.tasks[1].status, "over");
  assert.equal(result.tasks[2].status, "under");
  assert.equal(result.tasks[3].status, "no-estimate");
});

test("buildMonthlyMarkdown produces valid markdown", () => {
  const window: ExecutionEvidenceWindow = {
    startIso: "2026-06-01T00:00:00.000Z",
    endIso: "2026-07-01T00:00:00.000Z",
  };

  const markdown = buildMonthlyMarkdown({
    monthLabel: "June 2026",
    window,
    period: { totalWorkedMinutes: 3000, sessionCount: 40 },
    dailySeries: [
      { date: "2026-06-01", workedMinutes: 120, sessionCount: 3 },
      { date: "2026-06-02", workedMinutes: 0, sessionCount: 0 },
      { date: "2026-06-03", workedMinutes: 180, sessionCount: 4 },
    ],
    sessionQuality: {
      averageSessionLengthMinutes: 75,
      medianSessionLengthMinutes: 60,
      longestSessionMinutes: 240,
      sessionsUnder5Min: 2,
      sessionsUnder15Min: 5,
      sessionsOver90Min: 8,
      sessionsOver180Min: 3,
      totalSessions: 40,
    },
    activeDays: 20,
    projectBreakdown: [
      {
        projectId: "p1",
        projectName: "Project Alpha",
        workedMinutes: 1500,
        sessionCount: 20,
      },
      {
        projectId: "p2",
        projectName: "Project Beta",
        workedMinutes: 1000,
        sessionCount: 15,
      },
    ],
    goalBreakdown: [
      {
        goalId: "g1",
        goalTitle: "Improve velocity",
        projectName: "Project Alpha",
        workedMinutes: 800,
        sessionCount: 10,
      },
    ],
    taskBreakdown: [
      {
        taskId: "ta1",
        taskTitle: "Implement feature X",
        goalTitle: "Improve velocity",
        projectName: "Project Alpha",
        workedMinutes: 600,
        sessionCount: 8,
        estimateMinutes: 480,
        percentOfTotal: 20,
      },
    ],
    insights: {
      previousPeriodWorkedMinutes: 2500,
      deltaMinutes: 500,
      percentChange: 20,
      bestDay: {
        date: "2026-06-03",
        workedMinutes: 180,
        sessionCount: 4,
      },
      lowestNonZeroDay: null,
      daysWorkedCount: 20,
      currentStreak: 5,
      averageSessionLength: 75,
      longestSession: 240,
      shortestNonZeroSession: 15,
    },
    estimateAccuracy: {
      totalEstimatedMinutes: 480,
      totalTrackedMinutes: 600,
      estimateDeltaMinutes: 120,
      estimateDeltaPercent: 25,
      overEstimatedCount: 0,
      underEstimatedCount: 1,
      exactCount: 0,
      noEstimateCount: 0,
      tasks: [],
      projectAccuracy: [],
    },
    timezoneInfo: {
      ianaName: "America/New_York",
      offsetMinutes: -240,
    },
  });

  // Verify key sections are present
  assert.ok(markdown.includes("# Monthly Analytics: June 2026"));
  assert.ok(markdown.includes("## Summary"));
  assert.ok(markdown.includes("## Comparison with Previous Period"));
  assert.ok(markdown.includes("## Session Quality"));
  assert.ok(markdown.includes("## Problem Signals"));
  assert.ok(markdown.includes("## Top Projects"));
  assert.ok(markdown.includes("## Top Goals"));
  assert.ok(markdown.includes("## Top Tasks"));
  assert.ok(markdown.includes("## Estimate Accuracy"));
  assert.ok(markdown.includes("## Daily Breakdown"));
  assert.ok(markdown.includes("## Timezone Metadata"));

  // Verify timezone rendering
  assert.ok(markdown.includes("America/New_York"));
  assert.ok(markdown.includes("UTC-4:00"));

  // Verify data rendering
  assert.ok(markdown.includes("50h")); // 3000 minutes
  assert.ok(markdown.includes("Project Alpha"));
  assert.ok(markdown.includes("Improve velocity"));
  assert.ok(markdown.includes("Implement feature X"));

  // Verify daily breakdown
  assert.ok(markdown.includes("2026-06-01"));
  assert.ok(markdown.includes("2026-06-03"));
});

test("buildMonthlyMarkdown handles empty data gracefully", () => {
  const window: ExecutionEvidenceWindow = {
    startIso: "2026-06-01T00:00:00.000Z",
    endIso: "2026-07-01T00:00:00.000Z",
  };

  const markdown = buildMonthlyMarkdown({
    monthLabel: "June 2026",
    window,
    period: { totalWorkedMinutes: 0, sessionCount: 0 },
    dailySeries: [],
    sessionQuality: {
      averageSessionLengthMinutes: 0,
      medianSessionLengthMinutes: 0,
      longestSessionMinutes: 0,
      sessionsUnder5Min: 0,
      sessionsUnder15Min: 0,
      sessionsOver90Min: 0,
      sessionsOver180Min: 0,
      totalSessions: 0,
    },
    activeDays: 0,
    projectBreakdown: [],
    goalBreakdown: [],
    taskBreakdown: [],
    insights: {
      previousPeriodWorkedMinutes: 0,
      deltaMinutes: 0,
      percentChange: null,
      bestDay: null,
      lowestNonZeroDay: null,
      daysWorkedCount: 0,
      currentStreak: 0,
      averageSessionLength: 0,
      longestSession: 0,
      shortestNonZeroSession: null,
    },
    estimateAccuracy: {
      totalEstimatedMinutes: 0,
      totalTrackedMinutes: 0,
      estimateDeltaMinutes: 0,
      estimateDeltaPercent: null,
      overEstimatedCount: 0,
      underEstimatedCount: 0,
      exactCount: 0,
      noEstimateCount: 0,
      tasks: [],
      projectAccuracy: [],
    },
    timezoneInfo: {
      ianaName: "UTC",
      offsetMinutes: 0,
    },
  });

  assert.ok(markdown.includes("No significant issues detected this month. ✅"));
  assert.ok(markdown.includes("No project data available."));
  assert.ok(markdown.includes("No goal data available."));
  assert.ok(markdown.includes("No task data available."));
  assert.ok(markdown.includes("No daily data available."));
  assert.ok(markdown.includes("No previous period data for comparison."));
});
