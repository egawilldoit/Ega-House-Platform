import assert from "node:assert/strict";
import test from "node:test";

import type { WorkActivityCalendar, WorkActivityDay } from "./work-activity-service";
import { buildWorkActivityGrid } from "./work-activity-grid";

function makeDay(date: string, overrides: Partial<WorkActivityDay> = {}): WorkActivityDay {
  return {
    date,
    trackedSeconds: 0,
    sessionCount: 0,
    completedTaskCount: 0,
    isActive: false,
    intensityLevel: 0,
    ...overrides,
  };
}

function makeCalendar(dates: string[]): WorkActivityCalendar {
  return {
    timezone: "UTC",
    startDate: dates[0] ?? "",
    endDate: dates[dates.length - 1] ?? "",
    startUtcIso: "",
    endUtcIso: "",
    days: dates.map((date) => makeDay(date)),
    activeDayCount: 0,
    totalTrackedSeconds: 0,
    totalCompletedTasks: 0,
    currentStreak: 0,
    longestStreak: 0,
    bestTrackedDay: null,
  };
}

test("grid: places days into 7 weekday rows with correct weekday placement", () => {
  // 2026-09-27 is a Sunday (weekday 0). A 7-day window starting Sunday fills
  // exactly one column across all 7 rows.
  const dates = [
    "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30",
    "2026-10-01", "2026-10-02", "2026-10-03",
  ];
  const grid = buildWorkActivityGrid(makeCalendar(dates));
  assert.equal(grid.cells.length, 7);
  assert.equal(grid.weekCount, 1);
  assert.equal(grid.cells[0]?.weekday, 0); // Sunday
  assert.equal(grid.cells[0]?.weekIndex, 0);
  assert.equal(grid.cells[1]?.weekday, 1); // Monday
  assert.equal(grid.cells[6]?.weekday, 6); // Saturday
  assert.equal(grid.cells[6]?.weekIndex, 0);
});

test("grid: spans multiple week columns with correct alignment", () => {
  // 2026-09-27 (Sun) through 2026-10-10 (Sat) = 14 days = 2 full weeks.
  const dates: string[] = [];
  const start = Date.UTC(2026, 8, 27);
  for (let i = 0; i < 14; i += 1) {
    const d = new Date(start + i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const grid = buildWorkActivityGrid(makeCalendar(dates));
  assert.equal(grid.cells.length, 14);
  assert.equal(grid.weekCount, 2);
  // First cell: Sunday of week 0.
  assert.equal(grid.cells[0]?.weekday, 0);
  assert.equal(grid.cells[0]?.weekIndex, 0);
  // 8th cell (index 7): Sunday of week 1.
  assert.equal(grid.cells[7]?.weekday, 0);
  assert.equal(grid.cells[7]?.weekIndex, 1);
  // Last cell (index 13): Saturday of week 1.
  assert.equal(grid.cells[13]?.weekday, 6);
  assert.equal(grid.cells[13]?.weekIndex, 1);
});

test("grid: partial first week aligns to the correct weekday", () => {
  // 2026-09-30 is a Wednesday (weekday 3). A Wed→Fri window occupies rows 3-5
  // of week 0, leaving rows 0-2 empty.
  const dates = ["2026-09-30", "2026-10-01", "2026-10-02"];
  const grid = buildWorkActivityGrid(makeCalendar(dates));
  assert.equal(grid.weekCount, 1);
  assert.equal(grid.cells[0]?.weekday, 3); // Wednesday
  assert.equal(grid.cells[1]?.weekday, 4); // Thursday
  assert.equal(grid.cells[2]?.weekday, 5); // Friday
});

test("grid: month labels appear where the month changes", () => {
  // 2026-09-27 (Sun) through 2026-10-04 (Sun): Oct 1 falls in week 0, so the
  // Oct label appears at week 0 (the column where the month starts).
  const dates: string[] = [];
  const start = Date.UTC(2026, 8, 27);
  for (let i = 0; i < 8; i += 1) {
    const d = new Date(start + i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const grid = buildWorkActivityGrid(makeCalendar(dates));
  const labels = grid.monthLabels.map((l) => ({ week: l.weekIndex, label: l.label }));
  assert.deepEqual(labels, [
    { week: 0, label: "Sep" },
    { week: 0, label: "Oct" },
  ]);
});

test("grid: month label at year boundary shows the new month", () => {
  // 2025-12-28 (Sun) through 2026-01-03 (Sat): Jan 1 falls in week 0, so the
  // Jan label appears at week 0 (the column where the month starts).
  const dates: string[] = [];
  const start = Date.UTC(2025, 11, 28);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start + i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const grid = buildWorkActivityGrid(makeCalendar(dates));
  const labels = grid.monthLabels.map((l) => ({ week: l.weekIndex, label: l.label }));
  assert.deepEqual(labels, [
    { week: 0, label: "Dec" },
    { week: 0, label: "Jan" },
  ]);
});

test("grid: single day window produces one cell", () => {
  const grid = buildWorkActivityGrid(makeCalendar(["2026-09-27"]));
  assert.equal(grid.cells.length, 1);
  assert.equal(grid.weekCount, 1);
  assert.equal(grid.cells[0]?.isCurrentDay, true);
  assert.deepEqual(grid.monthLabels, [{ weekIndex: 0, label: "Sep" }]);
});

test("grid: empty calendar produces empty grid", () => {
  const grid = buildWorkActivityGrid(makeCalendar([]));
  assert.equal(grid.cells.length, 0);
  assert.equal(grid.weekCount, 0);
  assert.equal(grid.monthLabels.length, 0);
});

test("grid: isCurrentDay marks only the window end date", () => {
  const dates: string[] = [];
  const start = Date.UTC(2026, 8, 27);
  for (let i = 0; i < 10; i += 1) {
    const d = new Date(start + i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const grid = buildWorkActivityGrid(makeCalendar(dates));
  const currentDays = grid.cells.filter((c) => c.isCurrentDay);
  assert.equal(currentDays.length, 1);
  assert.equal(currentDays[0]?.date, "2026-10-06");
});

test("grid: 365-day rolling year produces 53 week columns", () => {
  const dates: string[] = [];
  const start = Date.UTC(2025, 8, 28); // 2025-09-28
  for (let i = 0; i < 365; i += 1) {
    const d = new Date(start + i * 86400000);
    dates.push(d.toISOString().slice(0, 10));
  }
  const grid = buildWorkActivityGrid(makeCalendar(dates));
  assert.equal(grid.cells.length, 365);
  // 2025-09-28 is a Sunday (weekday 0), so 365 days = 52 weeks + 1 day = 53 columns.
  assert.equal(grid.weekCount, 53);
  assert.equal(grid.cells[0]?.weekday, 0);
  assert.equal(grid.cells[364]?.weekday, 0); // 2026-09-27 is also a Sunday
});
