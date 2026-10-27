import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionEvidenceSessionRow } from "./execution-evidence-service";
import { buildWorkAnalyticsReport, type WorkAnalyticsTaskCounts } from "./work-analytics-report-builder";
import { parseAnalyticsFilters, type AnalyticsRange } from "./work-analytics-filters";

/**
 * Selected-range integrity matrix.
 *
 * A selected range must own every selected-range surface: summary, series,
 * breakdowns, recent sessions and drilldowns. Comparison widgets may use other
 * windows, but only their own, and they must be explicitly labelled.
 *
 * The expected values below are computed here with an independent overlap
 * formula so the assertions cannot simply mirror the implementation.
 */

const NOW = new Date("2026-09-23T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const DAY_MS = 86_400_000;

const TASK_COUNTS: WorkAnalyticsTaskCounts = {
  completedCount: 0,
  createdCount: 0,
  blockedCount: 0,
};

function session(
  id: string,
  startedAt: string,
  durationMinutes: number | null,
  options: { open?: boolean } = {},
): ExecutionEvidenceSessionRow {
  const startedMs = new Date(startedAt).getTime();
  return {
    task_id: id,
    started_at: startedAt,
    ended_at: options.open ? null : new Date(startedMs + (durationMinutes ?? 0) * 60_000).toISOString(),
    duration_seconds: options.open ? null : (durationMinutes ?? 0) * 60,
    tasks: {
      id,
      title: `Task ${id}`,
      project_id: "project-1",
      project_id_fk: "project-1",
      projects: { id: "project-1", name: "EGA House" },
      goals: { id: "goal-1", title: "Ship v1.1" },
    },
  } as unknown as ExecutionEvidenceSessionRow;
}

/**
 * Deterministic evidence placed across every boundary the matrix cares about.
 *
 *   today        2026-09-23  60m  (+ a boundary session and an open session)
 *   3 days ago   2026-09-20  30m
 *   6 days ago   2026-09-17  15m
 *   10 days ago  2026-09-13  120m
 *   29 days ago  2026-08-25  45m
 *   40 days ago  2026-08-14  90m   (inside quarter, outside 30d)
 *   prev month   2026-08-10  200m  (previous calendar month)
 *   outside all  2026-01-15  500m
 */
const SESSIONS: ExecutionEvidenceSessionRow[] = [
  session("today", "2026-09-23T09:00:00.000Z", 60),
  session("boundary", "2026-09-22T23:30:00.000Z", 60), // spans midnight into today
  session("open", "2026-09-23T11:00:00.000Z", null, { open: true }),
  session("three-days", "2026-09-20T09:00:00.000Z", 30),
  session("six-days", "2026-09-17T09:00:00.000Z", 15),
  session("ten-days", "2026-09-13T09:00:00.000Z", 120),
  session("twenty-nine-days", "2026-08-25T09:00:00.000Z", 45),
  session("forty-days", "2026-08-14T09:00:00.000Z", 90),
  session("previous-month", "2026-08-10T09:00:00.000Z", 200),
  session("outside-all", "2026-01-15T09:00:00.000Z", 500),
];

/** Independent overlap math — deliberately not the service implementation. */
function overlapMinutes(
  row: ExecutionEvidenceSessionRow,
  window: { startIso: string; endIso: string },
  includeOpen: boolean,
): number {
  const startMs = new Date(row.started_at).getTime();
  if (!row.ended_at && !includeOpen) return 0;
  const endMs = row.ended_at ? new Date(row.ended_at).getTime() : new Date(NOW_ISO).getTime();
  const windowStart = new Date(window.startIso).getTime();
  const windowEnd = new Date(window.endIso).getTime();
  const overlapMs = Math.min(endMs, windowEnd) - Math.max(startMs, windowStart);
  return overlapMs > 0 ? Math.round(overlapMs / 60_000) : 0;
}

function build(range: AnalyticsRange, includeOpen = false) {
  return buildWorkAnalyticsReport(
    SESSIONS,
    { selected: TASK_COUNTS, last30d: TASK_COUNTS },
    parseAnalyticsFilters(
      new URLSearchParams(includeOpen ? { range, includeOpen: "true" } : { range }),
    ),
    NOW,
  );
}

function windowFor(range: AnalyticsRange) {
  // Mirrors the documented range definitions without importing the helper, so a
  // change in window math shows up as a matrix failure rather than silently
  // redefining the expectation.
  switch (range) {
    case "today":
      return { startIso: "2026-09-23T00:00:00.000Z", endIso: NOW_ISO };
    case "7d":
      return { startIso: new Date(NOW.getTime() - 7 * DAY_MS).toISOString(), endIso: NOW_ISO };
    case "30d":
      return { startIso: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(), endIso: NOW_ISO };
    case "mtm":
      return { startIso: "2026-09-01T00:00:00.000Z", endIso: NOW_ISO };
    case "prev-month":
      return { startIso: "2026-08-01T00:00:00.000Z", endIso: "2026-09-01T00:00:00.000Z" };
    case "qtd":
      return { startIso: "2026-07-01T00:00:00.000Z", endIso: NOW_ISO };
    default:
      return { startIso: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(), endIso: NOW_ISO };
  }
}

const ALL_RANGES: AnalyticsRange[] = ["today", "7d", "30d", "mtm", "prev-month", "qtd"];

test("selected summary equals an independent overlap total for every supported range", () => {
  for (const range of ALL_RANGES) {
    const report = build(range);
    const window = windowFor(range);
    const expected = SESSIONS.reduce(
      (sum, row) => sum + overlapMinutes(row, window, false),
      0,
    );

    assert.equal(
      report.selectedSummary.workedMinutes,
      expected,
      `${range}: selected summary must only count sessions overlapping its own window`,
    );
  }
});

test("selected series, breakdowns and recent sessions all agree with the selected summary", () => {
  for (const range of ALL_RANGES) {
    const report = build(range);

    const seriesTotal = report.selectedSeries.reduce((sum, point) => sum + point.workedMinutes, 0);
    assert.equal(seriesTotal, report.selectedSummary.workedMinutes, `${range}: series total`);

    const breakdownTotal = report.projectBreakdown.reduce(
      (sum, entry) => sum + entry.workedMinutes,
      0,
    );
    assert.equal(breakdownTotal, report.selectedSummary.workedMinutes, `${range}: project breakdown`);

    const goalTotal = report.goalBreakdown.reduce((sum, entry) => sum + entry.workedMinutes, 0);
    assert.equal(goalTotal, report.selectedSummary.workedMinutes, `${range}: goal breakdown`);

    const taskTotal = report.taskBreakdown.reduce((sum, entry) => sum + entry.workedMinutes, 0);
    assert.equal(taskTotal, report.selectedSummary.workedMinutes, `${range}: task breakdown`);

    const recentTotal = Object.values(report.drilldownIndexes.date)
      .flat()
      .reduce((sum, entry) => sum + entry.durationSeconds, 0);
    assert.equal(
      Math.round(recentTotal / 60),
      report.selectedSummary.workedMinutes,
      `${range}: recent-session rows must be the sessions behind the selected totals`,
    );
  }
});

test("no session outside the selected window can reach the selected-range drilldowns", () => {
  for (const range of ALL_RANGES) {
    const report = build(range);
    const window = windowFor(range);
    const windowStart = new Date(window.startIso).getTime();
    const windowEnd = new Date(window.endIso).getTime();

    // The previous calendar month and the far-past session are only ever
    // legitimate inside their own explicitly labelled widgets.
    for (const [dateKey, rows] of Object.entries(report.drilldownIndexes.date)) {
      const keyMs = new Date(`${dateKey}T00:00:00.000Z`).getTime();
      assert.ok(
        keyMs >= windowStart - DAY_MS && keyMs <= windowEnd + DAY_MS,
        `${range}: drilldown date ${dateKey} is outside the selected window`,
      );
      for (const row of rows) {
        const startedMs = new Date(row.startedAt).getTime();
        assert.ok(
          startedMs < windowEnd,
          `${range}: session starting ${row.startedAt} leaked into the selected drilldown`,
        );
      }
    }

    const leaked = Object.values(report.drilldownIndexes.task)
      .flat()
      .filter((row) => row.taskId === "outside-all");
    assert.equal(leaked.length, 0, `${range}: far-past session leaked into a task drilldown`);
  }
});

test("the selected range never borrows the previous calendar month", () => {
  const sevenDays = build("7d");

  assert.equal(
    sevenDays.selectedSummary.workedMinutes,
    SESSIONS.filter((row) => overlapMinutes(row, windowFor("7d"), false) > 0).reduce(
      (sum, row) => sum + overlapMinutes(row, windowFor("7d"), false),
      0,
    ),
  );
  // The previous-month session is 200m and must not appear in a 7-day range.
  assert.ok(
    sevenDays.selectedSummary.workedMinutes < 200,
    "7d summary must not include the previous-month session",
  );
  assert.ok(
    sevenDays.monthComparison.previousMonthMinutes >= 200,
    "the previous-month widget still reports its own window",
  );
});

test("selected range comparison is like-for-like, not the fixed 7-day context", () => {
  for (const range of ALL_RANGES) {
    const report = build(range);
    const window = windowFor(range);
    const startMs = new Date(window.startIso).getTime();
    const endMs = new Date(window.endIso).getTime();
    const previousWindow = {
      startIso: new Date(startMs - (endMs - startMs)).toISOString(),
      endIso: window.startIso,
    };
    const expected = SESSIONS.reduce(
      (sum, row) => sum + overlapMinutes(row, previousWindow, false),
      0,
    );

    assert.equal(
      report.selectedComparison.previousPeriodWorkedMinutes,
      expected,
      `${range}: comparison must use the immediately preceding equal-length window`,
    );
    assert.ok(report.selectedComparisonLabel.length > 0, `${range}: comparison needs a label`);
    assert.notEqual(
      report.selectedComparisonLabel,
      report.selectedRangeLabel,
      `${range}: the comparison label must not read as the selected range itself`,
    );
  }
});

test("comparison labels state the window they actually compare", () => {
  assert.equal(build("today").selectedComparisonLabel, "vs previous day");
  assert.equal(build("7d").selectedComparisonLabel, "vs previous 7 days");
  assert.equal(build("30d").selectedComparisonLabel, "vs previous 30 days");
  assert.equal(build("prev-month").selectedComparisonLabel, "vs previous month");
  // Calendar-to-date ranges are duration matched, so the label states the days.
  assert.match(build("mtm").selectedComparisonLabel, /^vs previous \d+ days$/);
  assert.match(build("qtd").selectedComparisonLabel, /^vs previous \d+ days$/);
});

test("open sessions follow the includeOpen filter in every selected-range surface", () => {
  const excluded = build("7d", false);
  const included = build("7d", true);

  assert.equal(included.selectedSummary.workedMinutes > excluded.selectedSummary.workedMinutes, true);
  assert.equal(included.selectedSummary.sessionCount, excluded.selectedSummary.sessionCount + 1);

  const openRows = Object.values(included.drilldownIndexes.task)
    .flat()
    .filter((row) => row.taskId === "open");
  assert.equal(openRows.length, 1, "included open session must be reachable in the drilldown");

  const excludedOpenRows = Object.values(excluded.drilldownIndexes.task)
    .flat()
    .filter((row) => row.taskId === "open");
  assert.equal(excludedOpenRows.length, 0, "excluded open session must not be indexed");
});

test("a session crossing the window start contributes only its overlapping duration", () => {
  const report = build("today");
  const boundaryRow = Object.values(report.drilldownIndexes.task)
    .flat()
    .find((row) => row.taskId === "boundary");

  assert.ok(boundaryRow, "boundary session must be reachable from today");
  // 23:30 -> 00:30 crosses midnight; only 30 minutes fall inside today.
  assert.equal(boundaryRow.durationSeconds, 30 * 60);
});

test("the fixed 30-day context stays separate from the selected range", () => {
  const sevenDays = build("7d");
  const thirtyDays = build("30d");

  // Same 30-day context regardless of the selected range.
  assert.equal(
    sevenDays.summary.last30DaysWorkedMinutes,
    thirtyDays.summary.last30DaysWorkedMinutes,
  );
  // ...and it is not the selected-range value when the range is shorter.
  assert.notEqual(sevenDays.summary.last30DaysWorkedMinutes, sevenDays.selectedSummary.workedMinutes);
});

test("weekday distribution is derived from the canonical 30-day series only", () => {
  const report = build("7d");
  const total = report.weekdayDistribution.reduce((sum, entry) => sum + entry.workedMinutes, 0);
  const seriesTotal = report.last30DaysSeries.reduce((sum, point) => sum + point.workedMinutes, 0);

  assert.equal(total, seriesTotal);
  assert.equal(report.weekdayDistribution.length, 7);
  assert.deepEqual(
    report.weekdayDistribution.map((entry) => entry.label),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  );
});

test("rolling average is a trailing mean of the selected series, never invented data", () => {
  const report = build("30d");
  const rolling = report.selectedSeriesRollingAverage;

  assert.equal(rolling.length, report.selectedSeries.length);

  const windowSize = 7;
  report.selectedSeries.forEach((point, index) => {
    const slice = report.selectedSeries.slice(Math.max(0, index - windowSize + 1), index + 1);
    const expected = Math.round(
      slice.reduce((sum, entry) => sum + entry.workedMinutes, 0) / slice.length,
    );
    assert.equal(rolling[index]?.workedMinutes, expected, `rolling average at ${point.date}`);
    assert.equal(rolling[index]?.date, point.date);
  });

  // A trailing mean can never exceed the peak it smooths.
  const peak = Math.max(...report.selectedSeries.map((point) => point.workedMinutes));
  assert.ok(rolling.every((point) => point.workedMinutes <= peak));
});
