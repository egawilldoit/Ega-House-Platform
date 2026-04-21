import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeTaskBlockedReasonInput,
  validateTaskInlineUpdateInput,
} from "./task-service";

test("normalizes blocked reason input without overvalidating free text", () => {
  assert.equal(normalizeTaskBlockedReasonInput(" waiting on vendor API "), "waiting on vendor API");
  assert.equal(normalizeTaskBlockedReasonInput(""), null);
  assert.equal(normalizeTaskBlockedReasonInput(null), null);
});

test("requires blocked reason when inline status is blocked", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "blocked",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "",
  });

  assert.equal(result.errorMessage, "Blocked reason is required when status is Blocked.");
});

test("allows inline update without blocked reason when status is not blocked", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.blockedReason, null);
});

test("clears blocked reason when status is not blocked", () => {
  const result = validateTaskInlineUpdateInput({
    taskId: "task-1",
    status: "in_progress",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    blockedReason: "waiting on infra fix",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.blockedReason, null);
});
