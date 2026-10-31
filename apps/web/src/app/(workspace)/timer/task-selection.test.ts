import assert from "node:assert/strict";
import test from "node:test";

import {
  getTimerStartEmptyStateCopy,
  getTimerStartTaskOptions,
  isTaskCompletedForTimerStart,
} from "./task-selection";

test("recognizes completed statuses as not eligible for timer start", () => {
  assert.equal(isTaskCompletedForTimerStart("done"), true);
  assert.equal(isTaskCompletedForTimerStart("completed"), true);
  assert.equal(isTaskCompletedForTimerStart("complete"), true);
  assert.equal(isTaskCompletedForTimerStart("in_progress"), false);
});

test("keeps incomplete tasks and excludes completed tasks from timer start options", () => {
  const options = getTimerStartTaskOptions([
    { id: "task-1", title: "Todo task", status: "todo" },
    { id: "task-2", title: "In progress task", status: "in_progress" },
    { id: "task-3", title: "Done task", status: "done" },
    { id: "task-4", title: "Completed task", status: "completed" },
  ]);

  assert.deepEqual(
    options.map((task) => task.id),
    ["task-1", "task-2"],
  );
});

test("returns empty-state copy for all-done task list", () => {
  assert.equal(
    getTimerStartEmptyStateCopy(3),
    "No active tasks available. Reopen a task to start a new session.",
  );
});

test("returns empty-state copy for no tasks", () => {
  assert.equal(
    getTimerStartEmptyStateCopy(0),
    "No tasks available yet. Create a task to start tracking focused work.",
  );
});
