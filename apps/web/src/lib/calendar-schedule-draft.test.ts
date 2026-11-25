import assert from "node:assert/strict";
import test from "node:test";

import {
  addMinutesToLocalDateTime,
  buildQuickScheduleBlock,
  durationMinutesBetween,
  formatDurationChipLabel,
  formatTaskScheduleSummary,
} from "./calendar-schedule-draft";

test("buildQuickScheduleBlock snaps Today to the next 30-minute boundary at least 10 minutes ahead", () => {
  const now = new Date(2026, 10, 25, 17, 25, 0, 0);
  const block = buildQuickScheduleBlock(0, 60, now);
  assert.equal(block.start, "2026-11-25T18:00");
  assert.equal(block.end, "2026-11-25T19:00");
});

test("buildQuickScheduleBlock schedules Tomorrow at 09:00 for the requested duration", () => {
  const now = new Date(2026, 10, 25, 17, 25, 0, 0);
  const block = buildQuickScheduleBlock(1, 90, now);
  assert.equal(block.start, "2026-11-26T09:00");
  assert.equal(block.end, "2026-11-26T10:30");
});

test("addMinutesToLocalDateTime rolls cleanly across midnight and durationMinutesBetween measures the span", () => {
  const end = addMinutesToLocalDateTime("2026-11-25T23:30", 90);
  assert.equal(end, "2026-11-26T01:00");
  assert.equal(durationMinutesBetween("2026-11-25T23:30", end), 90);
  assert.equal(durationMinutesBetween("2026-11-25T12:00", "2026-11-25T11:00"), null);
});

test("formatDurationChipLabel renders concise duration labels", () => {
  assert.equal(formatDurationChipLabel(30), "30m");
  assert.equal(formatDurationChipLabel(60), "1h");
  assert.equal(formatDurationChipLabel(90), "1.5h");
  assert.equal(formatDurationChipLabel(120), "2h");
});

test("formatTaskScheduleSummary formats same-day timed blocks and all-day planned dates", () => {
  const now = new Date(2026, 10, 25, 10, 0, 0, 0);
  const start = new Date(2026, 10, 25, 17, 30, 0, 0).toISOString();
  const end = new Date(2026, 10, 25, 19, 30, 0, 0).toISOString();

  const timed = formatTaskScheduleSummary(start, end, null, now);
  assert.ok(timed);
  assert.match(timed, /^Today 5:30 PM–7:30 PM$/);

  const allDay = formatTaskScheduleSummary(null, null, "2026-11-26", now);
  assert.equal(allDay, "Tomorrow, all day");

  assert.equal(formatTaskScheduleSummary(null, null, null, now), null);
});
