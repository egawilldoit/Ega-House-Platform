import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkAnalyticsReport } from "./work-analytics-report-builder";
import type { AnalyticsFilterValues } from "./work-analytics-filters";

const defaultFilters: AnalyticsFilterValues = {
  range: "30d",
  groupBy: "day",
  breakdownBy: "project",
  includeOpen: false,
};

const defaultTaskCounts = {
  completedCount: 0,
  createdCount: 0,
  blockedCount: 0,
};

test("buildWorkAnalyticsReport returns full report shape with no sessions", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");
  const report = buildWorkAnalyticsReport([], defaultTaskCounts, defaultFilters, now);

  // Verify top-level keys exist
  assert.ok(report.summary, "summary should exist");
  assert.ok(Array.isArray(report.last7DaysSeries), "last7DaysSeries should be an array");
  assert.ok(Array.isArray(report.last30DaysSeries), "last30DaysSeries should be an array");
  assert.ok(report.yesterday, "yesterday should exist");
  assert.ok(report.thisWeekInsights, "thisWeekInsights should exist");
  assert.ok(report.monthComparison, "monthComparison should exist");
  assert.ok(report.breakdownBy, "breakdownBy should exist");
  assert.ok(typeof report.breakdownTitle === "string", "breakdownTitle should be a string");
  assert.ok(Array.isArray(report.projectBreakdown), "projectBreakdown should be an array");
  assert.ok(Array.isArray(report.goalBreakdown), "goalBreakdown should be an array");
  assert.ok(Array.isArray(report.taskBreakdown), "taskBreakdown should be an array");
  assert.ok(report.estimateAccuracy, "estimateAccuracy should exist");
  assert.ok(report.drilldownIndexes, "drilldownIndexes should exist");

  // Verify zero/empty defaults
  assert.strictEqual(report.summary.todayWorkedMinutes, 0);
  assert.strictEqual(report.summary.last30DaysWorkedMinutes, 0);
  assert.strictEqual(report.yesterday.workedMinutes, 0);
  assert.strictEqual(report.yesterday.sessionCount, 0);
  assert.strictEqual(report.estimateAccuracy.totalTrackedMinutes, 0);
  assert.strictEqual(report.projectBreakdown.length, 0);
  assert.strictEqual(report.goalBreakdown.length, 0);
  assert.strictEqual(report.taskBreakdown.length, 0);
});

test("buildWorkAnalyticsReport returns correct breakdownTitle by breakdownBy", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");

  const projectReport = buildWorkAnalyticsReport([], defaultTaskCounts, { ...defaultFilters, breakdownBy: "project" }, now);
  assert.strictEqual(projectReport.breakdownTitle, "Project breakdown");

  const goalReport = buildWorkAnalyticsReport([], defaultTaskCounts, { ...defaultFilters, breakdownBy: "goal" }, now);
  assert.strictEqual(goalReport.breakdownTitle, "Goal breakdown");

  const taskReport = buildWorkAnalyticsReport([], defaultTaskCounts, { ...defaultFilters, breakdownBy: "task" }, now);
  assert.strictEqual(taskReport.breakdownTitle, "Task breakdown");
});

test("buildWorkAnalyticsReport respects includeOpen=false (default)", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");
  const sessions = [
    {
      task_id: "open-task",
      started_at: "2026-04-27T09:00:00.000Z",
      ended_at: null,
      duration_seconds: null,
      tasks: { id: "open-task", title: "Open Task" },
    },
  ];

  const report = buildWorkAnalyticsReport(sessions, defaultTaskCounts, defaultFilters, now);
  // Open sessions should be excluded by default
  assert.strictEqual(report.summary.todayWorkedMinutes, 0);
  assert.strictEqual(report.summary.todaySessionCount, 0);
});

test("buildWorkAnalyticsReport with non-default range propagates series correctly", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-25T09:00:00.000Z",
      ended_at: "2026-04-25T10:00:00.000Z",
      duration_seconds: 3600,
      tasks: { id: "task-1", title: "Task 1" },
    },
  ];

  // Use "today" range — only today's window, but summary still uses 30d
  const report = buildWorkAnalyticsReport(
    sessions,
    { completedCount: 1, createdCount: 1, blockedCount: 0 },
    { ...defaultFilters, range: "today" },
    now,
  );

  // The tasks row shows the task counts we passed
  assert.strictEqual(report.summary.completedTaskCount, 1);
  assert.strictEqual(report.summary.createdTaskCount, 1);
  assert.strictEqual(report.summary.blockedTaskCount, 0);

  // drilldownIndexes should be present and have expected shape
  assert.strictEqual(typeof report.drilldownIndexes.date, "object");
  assert.strictEqual(typeof report.drilldownIndexes.project, "object");
  assert.strictEqual(typeof report.drilldownIndexes.goal, "object");
  assert.strictEqual(typeof report.drilldownIndexes.task, "object");
});

test("buildWorkAnalyticsReport smoke test with complete session data", () => {
  const now = new Date("2026-04-27T12:00:00.000Z");
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-27T09:00:00.000Z",
      ended_at: "2026-04-27T10:00:00.000Z",
      duration_seconds: 3600,
      tasks: {
        id: "task-1",
        title: "Task 1",
        projects: { id: "proj-1", name: "Project A" },
        goals: { id: "goal-1", title: "Goal 1" },
        estimate_minutes: 60,
      },
    },
    {
      task_id: "task-2",
      started_at: "2026-04-20T14:00:00.000Z",
      ended_at: "2026-04-20T15:30:00.000Z",
      duration_seconds: 5400,
      tasks: {
        id: "task-2",
        title: "Task 2",
        projects: { id: "proj-2", name: "Project B" },
        goals: { id: "goal-1", title: "Goal 1" },
      },
    },
  ];

  const report = buildWorkAnalyticsReport(sessions, defaultTaskCounts, defaultFilters, now);

  // Today should have 60 minutes from the first session
  assert.strictEqual(report.summary.todayWorkedMinutes, 60);
  assert.strictEqual(report.summary.todaySessionCount, 1);

  // Project breakdown should have 2 entries (Project A, Project B)
  assert.strictEqual(report.projectBreakdown.length, 2);
  const projectA = report.projectBreakdown.find((p) => p.projectName === "Project A");
  const projectB = report.projectBreakdown.find((p) => p.projectName === "Project B");
  assert.ok(projectA, "Project A should be in breakdown");
  assert.ok(projectB, "Project B should be in breakdown");
  assert.strictEqual(projectA!.workedMinutes, 60);
  assert.strictEqual(projectB!.workedMinutes, 90);

  // Goal breakdown should have 1 entry
  assert.strictEqual(report.goalBreakdown.length, 1);
  assert.strictEqual(report.goalBreakdown[0].goalTitle, "Goal 1");

  // Task breakdown should have 2 entries
  assert.strictEqual(report.taskBreakdown.length, 2);

  // Estimate accuracy: task-1 has estimate=60, tracked=60 -> exact
  // task-2 has no estimate -> no-estimate
  assert.strictEqual(report.estimateAccuracy.exactCount, 1);
  assert.strictEqual(report.estimateAccuracy.noEstimateCount, 1);
  assert.strictEqual(report.estimateAccuracy.totalEstimatedMinutes, 60);
  assert.strictEqual(report.estimateAccuracy.totalTrackedMinutes, 150); // 60 + 90

  // Yesterday should be zero (no sessions that started yesterday)
  assert.strictEqual(report.yesterday.workedMinutes, 0);
  assert.strictEqual(report.yesterday.sessionCount, 0);
});
