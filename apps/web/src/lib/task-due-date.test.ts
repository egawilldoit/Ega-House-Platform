import assert from "node:assert/strict";
import test from "node:test";

import {
  getTaskDueDateState,
  isTaskDueSoon,
  isTaskDueToday,
  isTaskOverdue,
  normalizeTaskDueDateInput,
} from "./task-due-date";

test("normalizes empty due date input to null", () => {
  assert.deepEqual(normalizeTaskDueDateInput(""), {
    value: null,
    error: null,
  });
});

test("accepts a valid date-only due date", () => {
  assert.deepEqual(normalizeTaskDueDateInput("2026-04-24"), {
    value: "2026-04-24",
    error: null,
  });
});

test("rejects an invalid due date string", () => {
  assert.equal(
    normalizeTaskDueDateInput("2026-02-30").error,
    "Due date must be a valid date in YYYY-MM-DD format.",
  );
});

test("detects overdue and due-today states without timezone drift", () => {
  const today = "2026-04-18";

  assert.equal(isTaskOverdue("2026-04-17", "todo", today), true);
  assert.equal(isTaskDueToday("2026-04-18", "todo", today), true);
  assert.equal(isTaskDueSoon("2026-04-25", "todo", today), true);
  assert.equal(isTaskDueSoon("2026-04-26", "todo", today), false);
});

test("does not mark completed tasks as overdue or due soon", () => {
  const today = "2026-04-18";

  assert.equal(isTaskOverdue("2026-04-17", "done", today), false);
  assert.equal(isTaskDueToday("2026-04-18", "done", today), false);
  assert.equal(isTaskDueSoon("2026-04-19", "done", today), false);
  assert.equal(getTaskDueDateState("2026-04-17", "done", today), "scheduled");
});
