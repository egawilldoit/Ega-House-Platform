import assert from "node:assert/strict";
import test from "node:test";

import {
  getFirstTaskRecurrenceDateAfter,
  getNextTaskRecurrenceDate,
  getNextTaskRecurrenceDateFromAnchor,
  normalizeTaskRecurrenceScheduleInput,
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
  assert.equal(
    getNextTaskRecurrenceDateFromAnchor(
      "monthly:day-of-month",
      "2026-02-28",
      "2026-01-31",
    ),
    "2026-03-31",
  );
});

test("finds first recurrence date after completion without backfill", () => {
  assert.equal(
    getFirstTaskRecurrenceDateAfter({
      rule: "daily",
      anchorDate: "2026-05-01",
      nextOccurrenceDate: "2026-05-02",
      completedAtIso: "2026-05-04T12:00:00.000Z",
      timezone: "UTC",
    }),
    "2026-05-05",
  );

  assert.equal(
    getFirstTaskRecurrenceDateAfter({
      rule: "weekdays",
      anchorDate: "2026-05-01",
      nextOccurrenceDate: "2026-05-02",
      completedAtIso: "2026-05-08T22:00:00.000Z",
      timezone: "UTC",
    }),
    "2026-05-11",
  );

  assert.equal(
    getFirstTaskRecurrenceDateAfter({
      rule: "weekly:monday",
      anchorDate: "2026-05-04",
      nextOccurrenceDate: "2026-05-04",
      completedAtIso: "2026-05-04T09:00:00.000Z",
      timezone: "UTC",
    }),
    "2026-05-11",
  );
});

test("uses stored timezone when deciding completion local date", () => {
  assert.equal(
    getFirstTaskRecurrenceDateAfter({
      rule: "daily",
      anchorDate: "2026-05-04",
      nextOccurrenceDate: "2026-05-04",
      completedAtIso: "2026-05-04T01:00:00.000Z",
      timezone: "America/Los_Angeles",
    }),
    "2026-05-04",
  );
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

test("normalizes recurrence schedule metadata", () => {
  assert.deepEqual(
    normalizeTaskRecurrenceScheduleInput({
      rule: "weekly:monday",
      anchorDate: "2026-05-04",
      timezone: "UTC",
      fallbackAnchorDate: "2026-05-01",
    }),
    {
      errorMessage: null,
      schedule: {
        rule: "weekly:monday",
        anchorDate: "2026-05-04",
        timezone: "UTC",
        nextOccurrenceDate: "2026-05-11",
      },
    },
  );
});

test("rejects invalid recurrence schedule metadata", () => {
  assert.equal(
    normalizeTaskRecurrenceScheduleInput({
      rule: "daily",
      anchorDate: "2026-02-30",
      timezone: "UTC",
      fallbackAnchorDate: "2026-05-01",
    }).errorMessage,
    "Recurring anchor date is invalid.",
  );

  assert.equal(
    normalizeTaskRecurrenceScheduleInput({
      rule: "daily",
      anchorDate: "2026-05-04",
      timezone: "Nope/Zone",
      fallbackAnchorDate: "2026-05-01",
    }).errorMessage,
    "Recurring timezone is invalid.",
  );
});
