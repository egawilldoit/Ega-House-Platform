import assert from "node:assert/strict";
import test from "node:test";

import {
  getNextTaskRecurrenceDate,
  normalizeTaskRecurrenceRuleInput,
} from "./task-recurrence";

test("calculates daily next date", () => {
  assert.equal(getNextTaskRecurrenceDate("daily", "2026-05-04"), "2026-05-05");
});

test("calculates weekdays next date across weekends", () => {
  assert.equal(getNextTaskRecurrenceDate("weekdays", "2026-05-08"), "2026-05-11");
  assert.equal(getNextTaskRecurrenceDate("weekdays", "2026-05-07"), "2026-05-08");
});

test("calculates weekly next date for target weekday", () => {
  assert.equal(getNextTaskRecurrenceDate("weekly:monday", "2026-05-04"), "2026-05-11");
  assert.equal(getNextTaskRecurrenceDate("weekly:wednesday", "2026-05-04"), "2026-05-06");
});

test("calculates monthly day-of-month next date with month-end clamp", () => {
  assert.equal(getNextTaskRecurrenceDate("monthly:day-of-month", "2026-01-31"), "2026-02-28");
  assert.equal(getNextTaskRecurrenceDate("monthly:day-of-month", "2026-12-15"), "2027-01-15");
});

test("rejects invalid recurrence rules and allows empty non-recurring input", () => {
  assert.deepEqual(normalizeTaskRecurrenceRuleInput(""), {
    errorMessage: null,
    rule: null,
  });
  assert.deepEqual(normalizeTaskRecurrenceRuleInput("yearly"), {
    errorMessage: "Recurring preset is not supported.",
    rule: null,
  });
});
