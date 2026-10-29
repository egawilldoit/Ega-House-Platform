import assert from "node:assert/strict";
import test from "node:test";

import {
  getTaskBarWindow,
  isIsoDateOnly,
  isTaskDateWindowValid,
  isSameTaskDependency,
  isSelfTaskDependency,
  wouldCreateTaskDependencyCycle,
} from "../src/index";

const edge = (taskId: string, blockedByTaskId: string) => ({ taskId, blockedByTaskId });

test("self dependencies are rejected", () => {
  assert.equal(isSelfTaskDependency(edge("task-a", "task-a")), true);
  assert.equal(isSelfTaskDependency(edge("task-a", "task-b")), false);
  assert.equal(wouldCreateTaskDependencyCycle([], edge("task-a", "task-a")), true);
});

test("a duplicate edge is not mistaken for a cycle", () => {
  const existing = [edge("task-b", "task-a")];
  assert.equal(isSameTaskDependency(existing[0]!, edge("task-b", "task-a")), true);
  assert.equal(wouldCreateTaskDependencyCycle(existing, edge("task-b", "task-a")), false);
});

test("direct reverse edges are a cycle", () => {
  const existing = [edge("task-b", "task-a")];
  assert.equal(wouldCreateTaskDependencyCycle(existing, edge("task-a", "task-b")), true);
});

test("indirect cycles are detected across a chain", () => {
  const existing = [edge("task-b", "task-a"), edge("task-c", "task-b")];
  assert.equal(wouldCreateTaskDependencyCycle(existing, edge("task-d", "task-c")), false);
  assert.equal(wouldCreateTaskDependencyCycle(existing, edge("task-a", "task-c")), true);
});

test("unrelated edges remain valid", () => {
  const existing = [edge("task-b", "task-a"), edge("task-c", "task-a")];
  assert.equal(wouldCreateTaskDependencyCycle(existing, edge("task-d", "task-c")), false);
});

test("inclusive date windows allow same-day bars and reject inverted windows", () => {
  assert.equal(isTaskDateWindowValid("2026-05-01", "2026-05-01"), true);
  assert.equal(isTaskDateWindowValid("2026-05-01", "2026-05-02"), true);
  assert.equal(isTaskDateWindowValid("2026-05-02", "2026-05-01"), false);
  assert.equal(isTaskDateWindowValid(null, "2026-05-01"), true);
  assert.equal(isTaskDateWindowValid("2026-05-01", null), true);
  assert.equal(isTaskDateWindowValid(null, null), true);
});

test("invalid date strings are rejected explicitly", () => {
  assert.equal(isIsoDateOnly("2026-02-30"), false);
  assert.equal(isIsoDateOnly("2026-5-1"), false);
  assert.equal(isTaskDateWindowValid("2026-02-30", "2026-03-01"), false);
});

test("bars require both real dates and never invent a missing one", () => {
  assert.deepEqual(getTaskBarWindow("2026-05-01", "2026-05-01"), {
    startDate: "2026-05-01",
    dueDate: "2026-05-01",
  });
  assert.equal(getTaskBarWindow(null, "2026-05-01"), null);
  assert.equal(getTaskBarWindow("2026-05-01", null), null);
  assert.equal(getTaskBarWindow("2026-05-02", "2026-05-01"), null);
});
