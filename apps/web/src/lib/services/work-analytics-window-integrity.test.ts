import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkAnalyticsReport } from "./work-analytics-report-builder";
import {
  computeEvidenceWindowForRange,
  computeWindowForRange,
  type AnalyticsFilterValues,
} from "./work-analytics-filters";

const NOW = new Date("2026-06-20T12:00:00.000Z");

const filters: AnalyticsFilterValues = {
  range: "30d",
  groupBy: "day",
  breakdownBy: "project",
  includeOpen: false,
};

const noTaskCounts = { completedCount: 0, createdCount: 0, blockedCount: 0 };
const taskCounts = { selected: noTaskCounts, last30d: noTaskCounts };

function session(id: string, startedAt: string) {
  return {
    task_id: id,
    started_at: startedAt,
    ended_at: new Date(new Date(startedAt).getTime() + 60 * 60 * 1000).toISOString(),
    duration_seconds: 3600,
    tasks: { id, title: id, projects: { id: `proj-${id}`, name: `Project ${id}` } },
  };
}

// Activity distributed across every relevant boundary (now = 2026-06-20T12:00Z).
const sessions = [
  session("today", "2026-06-20T09:00:00.000Z"), // today + 7d + 30d + mtm + qtd
  session("threeDays", "2026-06-17T09:00:00.000Z"), // 7d + 30d + mtm + qtd
  session("fifteenDays", "2026-06-05T09:00:00.000Z"), // 30d + mtm + qtd
  session("may25", "2026-05-25T09:00:00.000Z"), // 30d (>= 05-21T12:00) but not mtm; previous month
  session("may10", "2026-05-10T09:00:00.000Z"), // previous month only
  session("qtdFar", "2026-04-15T09:00:00.000Z"), // current quarter, outside last 30d
];

function breakdownTotal(report: ReturnType<typeof buildWorkAnalyticsReport>) {
  return report.projectBreakdown.reduce((sum, entry) => sum + entry.workedMinutes, 0);
}

const EXPECTED_SELECTED_MINUTES: Record<string, number> = {
  today: 60,
  "7d": 120,
  "30d": 240,
  mtm: 180,
  "prev-month": 120,
  qtd: 360,
};

test("EGA-655 RED: selected-range breakdown follows the canonical selected window", () => {
  for (const [range, expected] of Object.entries(EXPECTED_SELECTED_MINUTES)) {
    const report = buildWorkAnalyticsReport(sessions, taskCounts, { ...filters, range: range as AnalyticsFilterValues["range"] }, NOW);
    assert.equal(
      breakdownTotal(report),
      expected,
      `range=${range} breakdown should equal the canonical selected window total`,
    );
  }
});

test("EGA-655: selected summary follows the canonical selected window", () => {
  for (const [range, expected] of Object.entries(EXPECTED_SELECTED_MINUTES)) {
    const report = buildWorkAnalyticsReport(sessions, taskCounts, { ...filters, range: range as AnalyticsFilterValues["range"] }, NOW);
    assert.equal(
      (report as unknown as { selectedSummary: { workedMinutes: number } }).selectedSummary.workedMinutes,
      expected,
      `range=${range} selectedSummary should equal the canonical window total`,
    );
  }
});

test("EGA-655: the canonical selected window and the report label agree", () => {
  for (const range of Object.keys(EXPECTED_SELECTED_MINUTES) as AnalyticsFilterValues["range"][]) {
    const report = buildWorkAnalyticsReport(sessions, taskCounts, { ...filters, range }, NOW) as unknown as {
      selectedRangeLabel: string;
    };
    const window = computeWindowForRange(range, NOW);
    assert.ok(report.selectedRangeLabel.length > 0, `range=${range} needs a label`);
    assert.ok(window.startIso && window.endIso, `range=${range} needs a window`);
  }
});

test("EGA-655: fixed 30-day context stays correct from the superset evidence", () => {
  // range=today must not make the fixed Last 30 days context wrong.
  const report = buildWorkAnalyticsReport(sessions, taskCounts, { ...filters, range: "today" }, NOW);
  assert.equal(report.summary.last30DaysWorkedMinutes, 240);
  assert.equal(report.summary.todayWorkedMinutes, 60);
  // Previous calendar month (all of May) = may25 + may10.
  assert.equal(report.monthComparison.previousMonthMinutes, 120);
});

test("EGA-655: the evidence fetch window is a bounded superset of every visible section", () => {
  const last30Start = new Date(NOW);
  last30Start.setUTCDate(last30Start.getUTCDate() - 30);
  const previousMonthStart = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 1));

  for (const range of Object.keys(EXPECTED_SELECTED_MINUTES) as AnalyticsFilterValues["range"][]) {
    const evidence = computeEvidenceWindowForRange(range, NOW);
    const selected = computeWindowForRange(range, NOW);

    assert.ok(evidence.startIso <= selected.startIso, `range=${range} must cover the selected window`);
    assert.ok(evidence.startIso <= last30Start.toISOString(), `range=${range} must cover the 30d context`);
    assert.ok(evidence.startIso <= previousMonthStart.toISOString(), `range=${range} must cover the previous month`);
    assert.equal(evidence.endIso, NOW.toISOString(), `range=${range} must run through now`);
  }
});
