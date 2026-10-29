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
  normalizeSubtaskTitle,
  nextSubtaskPosition,
  moveSubtaskPosition,
  getSubtaskProgress,
  SUBTASK_TITLE_MAX,
  TASK_ACTIVITY_EVENT_KINDS,
  isTaskActivityEventKind,
  taskActivityActorLabel,
} from "../src/index";

test("canonical task and goal values remain stable", () => {
  assert.deepEqual(TASK_STATUS_VALUES, ["todo", "in_progress", "review", "done", "blocked"]);
  assert.equal(isTaskStatus("review"), true);
  // Review is open work: it must never be counted as completed.
  assert.equal(isTaskCompletedStatus("review"), false);
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

test("subtask titles reuse the task title limit and reject blanks", () => {
  assert.deepEqual(normalizeSubtaskTitle("  Write   the plan  "), {
    ok: true,
    title: "Write the plan",
  });
  assert.equal(normalizeSubtaskTitle("   ").ok, false);
  assert.equal(normalizeSubtaskTitle("x".repeat(SUBTASK_TITLE_MAX + 1)).ok, false);
});

test("subtask positions append densely and reordering keeps every item", () => {
  assert.equal(nextSubtaskPosition([]), 0);
  assert.equal(nextSubtaskPosition([0, 1, 2]), 3);
  assert.equal(nextSubtaskPosition([0, 4]), 5);

  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    moveSubtaskPosition(items, "b", "up").map((item) => item.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    moveSubtaskPosition(items, "b", "down").map((item) => item.id),
    ["a", "c", "b"],
  );
  // Edges are no-ops rather than losing the item.
  assert.deepEqual(
    moveSubtaskPosition(items, "a", "up").map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    moveSubtaskPosition(items, "missing", "down").map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("subtask progress is a plain count, never a parent completion signal", () => {
  assert.deepEqual(
    getSubtaskProgress([{ done: true }, { done: false }, { done: true }]),
    { done: 2, total: 3, label: "2/3" },
  );
  assert.deepEqual(getSubtaskProgress([]), { done: 0, total: 0, label: "0/0" });
});

test("activity actor labels never invent an identity", () => {
  assert.deepEqual(TASK_ACTIVITY_EVENT_KINDS, [
    "created",
    "field_change",
    "archived",
    "restored",
    "reminder_scheduled",
    "reminder_updated",
    "reminder_cancelled",
    "comment",
    "attachment_added",
    "attachment_removed",
  ]);
  assert.equal(isTaskActivityEventKind("comment"), true);
  assert.equal(isTaskActivityEventKind("attachment_added"), true);
  assert.equal(isTaskActivityEventKind("status"), false);
  assert.equal(taskActivityActorLabel({ kind: "owner", userId: "u1" }), "You");
  assert.equal(
    taskActivityActorLabel({ kind: "agent", agentId: "client-a", label: "Hermes" }),
    "Hermes",
  );
  assert.equal(taskActivityActorLabel({ kind: "agent", agentId: "client-a" }), "Agent");
  assert.equal(taskActivityActorLabel({ kind: "system" }), "System");
  assert.equal(taskActivityActorLabel({ kind: "unknown" }), "Unknown actor");
});
