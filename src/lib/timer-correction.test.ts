import assert from "node:assert/strict";
import test from "node:test";

import {
  combineLocalDateAndTimeToIso,
  getTimerCorrectionPreview,
  shiftLocalTimeValue,
  toLocalDateInputValue,
  toLocalTimeInputValue,
} from "./timer-correction";

test("combines local date and time into ISO", () => {
  const iso = combineLocalDateAndTimeToIso("2026-04-21", "09:30");
  assert.ok(iso);
  assert.equal(iso, new Date(2026, 3, 21, 9, 30, 0, 0).toISOString());
});

test("builds local input values from ISO", () => {
  const sourceIso = new Date(2026, 3, 21, 14, 5, 0, 0).toISOString();
  assert.equal(toLocalDateInputValue(sourceIso), "2026-04-21");
  assert.equal(toLocalTimeInputValue(sourceIso), "14:05");
});

test("returns preview duration when date and times are valid", () => {
  const preview = getTimerCorrectionPreview({
    date: "2026-04-21",
    startTime: "09:00",
    endTime: "10:45",
  });

  assert.equal(preview.errorMessage, null);
  assert.equal(preview.data?.durationSeconds, 6300);
});

test("returns inline validation for invalid ranges", () => {
  const preview = getTimerCorrectionPreview({
    date: "2026-04-21",
    startTime: "11:00",
    endTime: "10:59",
  });

  assert.equal(preview.errorMessage, "End time must be after start time.");
});

test("supports compact end-time nudges", () => {
  assert.equal(shiftLocalTimeValue("10:30", 15), "10:45");
  assert.equal(shiftLocalTimeValue("00:10", -30), "00:00");
  assert.equal(shiftLocalTimeValue("23:50", 30), "23:59");
});
