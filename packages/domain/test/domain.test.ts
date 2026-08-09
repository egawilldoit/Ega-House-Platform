import assert from "node:assert/strict";
import test from "node:test";

import {
  GOAL_HEALTH_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  getNextTaskRecurrenceDateFromAnchor,
  isGoalHealth,
  isProjectArchivedStatus,
  isTaskCompletedStatus,
  isTaskPriority,
  isTaskStatus,
  normalizeGoalHealthInput,
  normalizeGoalNextStepInput,
  normalizeGoalViewFilter,
  normalizeProjectViewFilter,
  normalizeTaskRecurrenceRuleInput,
} from "../src/index";

test("canonical task and goal values remain stable", () => {
  assert.deepEqual(TASK_STATUS_VALUES, ["todo", "in_progress", "done", "blocked"]);
  assert.deepEqual(TASK_PRIORITY_VALUES, ["low", "medium", "high", "urgent"]);
  assert.deepEqual(GOAL_HEALTH_VALUES, ["on_track", "at_risk", "off_track"]);
  assert.equal(isTaskStatus("in_progress"), true);
  assert.equal(isTaskPriority("urgent"), true);
  assert.equal(isTaskCompletedStatus("completed"), true);
  assert.equal(isGoalHealth("at_risk"), true);
});

test("archive view normalizers preserve existing defaults", () => {
  assert.equal(normalizeProjectViewFilter("ARCHIVED"), "archived");
  assert.equal(normalizeProjectViewFilter("unexpected"), "active");
  assert.equal(normalizeGoalViewFilter("all"), "all");
  assert.equal(normalizeGoalViewFilter(null), "active");
  assert.equal(isProjectArchivedStatus(" Archived "), true);
});

test("goal normalization preserves accepted and rejected values", () => {
  assert.deepEqual(normalizeGoalHealthInput(" on_track "), { value: "on_track", error: null });
  assert.deepEqual(normalizeGoalHealthInput(""), { value: null, error: null });
  assert.match(normalizeGoalHealthInput("unknown").error ?? "", /Health must be one of/);
  assert.deepEqual(normalizeGoalNextStepInput(" ship it "), { value: "ship it", error: null });
  assert.match(normalizeGoalNextStepInput("x".repeat(161)).error ?? "", /160 characters or fewer/);
});

test("recurrence normalization and scheduling preserve existing rules", () => {
  assert.deepEqual(normalizeTaskRecurrenceRuleInput(" WEEKDAYS "), {
    errorMessage: null,
    rule: "weekdays",
  });
  assert.deepEqual(normalizeTaskRecurrenceRuleInput("yearly"), {
    errorMessage: "Recurring preset is not supported.",
    rule: null,
  });
  assert.equal(
    getNextTaskRecurrenceDateFromAnchor("monthly:day-of-month", "2026-01-31", "2026-01-31"),
    "2026-02-28",
  );
});
