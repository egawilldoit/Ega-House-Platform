import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalendarRange,
  buildTaskCalendarProjection,
  getCalendarDayDurationMinutes,
  shiftCalendarAnchor,
} from "./task-calendar";
import type { CalendarProjectableSession, CalendarProjectableTask } from "./task-calendar";

const MOROCCO = "Africa/Casablanca";

function task(overrides: Partial<CalendarProjectableTask> = {}): CalendarProjectableTask {
  return {
    id: "task-1",
    title: "Draft weekly review",
    status: "todo",
    priority: "high",
    due_date: null,
    planned_for_date: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    updated_at: "2026-05-01T10:00:00.000Z",
    projects: { name: "EGA House" },
    ...overrides,
  };
}

test("week range is Monday through Sunday in the owner timezone", () => {
  const range = buildCalendarRange({
    view: "week",
    anchorDate: "2026-05-06",
    timezone: MOROCCO,
  });

  assert.equal(range.startDate, "2026-05-04");
  assert.equal(range.endDate, "2026-05-10");
  assert.equal(range.days.length, 7);
  assert.equal(range.days[0], "2026-05-04");
  // Casablanca is +01 in May, so local Monday midnight is Sunday 23:00Z.
  assert.equal(range.startUtcIso, "2026-05-03T23:00:00.000Z");
  assert.equal(range.endUtcIso, "2026-05-10T23:00:00.000Z");
});

test("month range covers every date in the month with whole Monday-start weeks", () => {
  const range = buildCalendarRange({
    view: "month",
    anchorDate: "2026-05-17",
    timezone: MOROCCO,
  });

  assert.equal(range.startDate, "2026-04-27");
  assert.equal(range.endDate, "2026-05-31");
  assert.equal(range.days.length % 7, 0);
  assert.ok(range.days.includes("2026-05-01"));
  assert.ok(range.days.includes("2026-05-31"));
  assert.equal(new Date(`${range.startDate}T00:00:00.000Z`).getUTCDay(), 1);
  assert.equal(new Date(`${range.endDate}T00:00:00.000Z`).getUTCDay(), 0);
});

test("calendar navigation moves by month or by week", () => {
  assert.equal(shiftCalendarAnchor("week", "2026-05-06", 1), "2026-05-13");
  assert.equal(shiftCalendarAnchor("week", "2026-05-06", -1), "2026-04-29");
  assert.equal(shiftCalendarAnchor("month", "2026-01-31", 1), "2026-02-28");
  assert.equal(shiftCalendarAnchor("month", "2026-12-15", 1), "2027-01-15");
});

test("Morocco DST days expose 23 and 25 hour local days", () => {
  assert.equal(getCalendarDayDurationMinutes("2026-02-15", MOROCCO), 25 * 60);
  assert.equal(getCalendarDayDurationMinutes("2026-03-22", MOROCCO), 23 * 60);
  assert.equal(getCalendarDayDurationMinutes("2026-05-06", MOROCCO), 24 * 60);
});

test("due and planned date-only values map to their calendar day without shifting", () => {
  const range = buildCalendarRange({
    view: "week",
    anchorDate: "2026-05-06",
    timezone: MOROCCO,
  });

  const dueProjection = buildTaskCalendarProjection({
    range,
    view: "week",
    dateField: "due",
    todayDate: "2026-05-06",
    tasks: [task({ id: "due", due_date: "2026-05-06", planned_for_date: "2026-05-07" })],
    scheduledTasks: [],
    sessions: [],
  });
  assert.deepEqual(
    dueProjection.days.find((day) => day.date === "2026-05-06")?.tasks.map((item) => item.id),
    ["due"],
  );
  assert.equal(
    dueProjection.days.find((day) => day.date === "2026-05-07")?.tasks.length,
    0,
  );

  const plannedProjection = buildTaskCalendarProjection({
    range,
    view: "week",
    dateField: "planned",
    todayDate: "2026-05-06",
    tasks: [task({ id: "planned", due_date: "2026-05-06", planned_for_date: "2026-05-07" })],
    scheduledTasks: [],
    sessions: [],
  });
  assert.deepEqual(
    plannedProjection.days.find((day) => day.date === "2026-05-07")?.tasks.map((item) => item.id),
    ["planned"],
  );
  assert.equal(
    plannedProjection.days.find((day) => day.date === "2026-05-06")?.tasks.length,
    0,
  );
});

test("a scheduled block crossing local midnight renders on both days without overlap", () => {
  const range = buildCalendarRange({
    view: "week",
    anchorDate: "2026-05-06",
    timezone: MOROCCO,
  });

  const projection = buildTaskCalendarProjection({
    range,
    view: "week",
    dateField: "due",
    todayDate: "2026-05-06",
    tasks: [],
    scheduledTasks: [
      task({
        id: "overnight",
        scheduled_start_at: "2026-05-05T22:30:00.000Z",
        scheduled_end_at: "2026-05-05T23:30:00.000Z",
      }),
    ],
    sessions: [],
  });

  const first = projection.days.find((day) => day.date === "2026-05-05")?.timed ?? [];
  const second = projection.days.find((day) => day.date === "2026-05-06")?.timed ?? [];

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].startMinute, 23 * 60 + 30);
  assert.equal(first[0].endMinute, 24 * 60);
  assert.equal(first[0].continuesAfter, true);
  assert.equal(second[0].startMinute, 0);
  assert.equal(second[0].endMinute, 30);
  assert.equal(second[0].continuesBefore, true);
});

test("timer sessions render read-only across a DST boundary", () => {
  const range = buildCalendarRange({
    view: "week",
    anchorDate: "2026-02-15",
    timezone: MOROCCO,
  });

  const sessions: CalendarProjectableSession[] = [
    {
      id: "session-1",
      taskId: "task-1",
      title: "Deep work",
      // 01:30 local on the 25-hour day, running past the clock change.
      startIso: "2026-02-15T00:30:00.000Z",
      endIso: "2026-02-15T03:30:00.000Z",
    },
  ];

  const projection = buildTaskCalendarProjection({
    range,
    view: "week",
    dateField: "due",
    todayDate: "2026-02-15",
    tasks: [],
    scheduledTasks: [],
    sessions,
  });

  const day = projection.days.find((item) => item.date === "2026-02-15");
  assert.equal(projection.days.find((item) => item.date === "2026-02-15")?.durationMinutes, 1500);
  assert.equal(day?.timed.length, 1);
  assert.equal(day?.timed[0].readOnly, true);
  assert.equal(day?.timed[0].kind, "session");
  // The block occupies three real hours starting at local 01:30 on a 25h day.
  assert.equal(day?.timed[0].startMinute, 90);
  assert.equal(day?.timed[0].endMinute, 270);
});
