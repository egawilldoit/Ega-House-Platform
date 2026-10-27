import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_FIELD_PATCH_FIELDS,
  buildTaskFieldPatchInput,
  isTaskFieldPatchField,
} from "./task-service";

const CURRENT = {
  title: "Draft review",
  status: "in_progress",
  priority: "high",
  due_date: "2026-05-01",
  estimate_minutes: 75,
  blocked_reason: null,
};

test("accepts exactly the whitelisted fields", () => {
  assert.deepEqual([...TASK_FIELD_PATCH_FIELDS], [
    "title",
    "status",
    "priority",
    "dueDate",
    "estimateMinutes",
    "blockedReason",
  ]);
  for (const field of TASK_FIELD_PATCH_FIELDS) {
    assert.equal(isTaskFieldPatchField(field), true);
  }
  for (const field of ["recurrenceRule", "projectId", "scheduledStartAt", ""]) {
    assert.equal(isTaskFieldPatchField(field), false);
  }
});

test("changes only the requested field and carries the rest forward", () => {
  const result = buildTaskFieldPatchInput("task-1", CURRENT, "status", "blocked");
  assert.ok("input" in result);
  assert.equal(result.input.taskId, "task-1");
  assert.equal(result.input.status, "blocked");
  assert.equal(result.input.priority, "high");
  assert.equal(result.input.dueDate, "2026-05-01");
  assert.equal(result.input.estimateMinutes, 75);
  assert.equal(result.input.title, "Draft review");
  assert.equal(result.input.blockedReason, null);
});

test("a priority patch keeps status, due date and estimate intact", () => {
  const result = buildTaskFieldPatchInput("task-1", CURRENT, "priority", "low");
  assert.ok("input" in result);
  assert.equal(result.input.priority, "low");
  assert.equal(result.input.status, "in_progress");
  assert.equal(result.input.dueDate, "2026-05-01");
  assert.equal(result.input.estimateMinutes, 75);
});

test("a null due date stays empty rather than becoming the string 'null'", () => {
  const result = buildTaskFieldPatchInput(
    "task-1",
    { ...CURRENT, due_date: null },
    "priority",
    "medium",
  );
  assert.ok("input" in result);
  assert.equal(result.input.dueDate, "");
});

test("rejects a non-whitelisted field without building an input", () => {
  const result = buildTaskFieldPatchInput("task-1", CURRENT, "projectId", "project-2");
  assert.ok(!("input" in result));
  assert.equal(result.errorMessage, "Unsupported task field update.");
});
