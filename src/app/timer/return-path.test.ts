import assert from "node:assert/strict";
import test from "node:test";

import { getTimerActionReturnPath } from "./return-path";

test("keeps /timer return paths", () => {
  assert.equal(getTimerActionReturnPath("/timer"), "/timer");
  assert.equal(getTimerActionReturnPath("/timer?view=compact"), "/timer?view=compact");
});

test("allows /dashboard return paths for timer actions", () => {
  assert.equal(getTimerActionReturnPath("/dashboard"), "/dashboard");
  assert.equal(
    getTimerActionReturnPath("/dashboard?panel=focus"),
    "/dashboard?panel=focus",
  );
});

test("allows /today return paths for timer actions", () => {
  assert.equal(getTimerActionReturnPath("/today"), "/today");
  assert.equal(
    getTimerActionReturnPath("/today?section=in-progress"),
    "/today?section=in-progress",
  );
});

test("allows /tasks return paths for timer handoff from task surfaces", () => {
  assert.equal(getTimerActionReturnPath("/tasks"), "/tasks");
  assert.equal(
    getTimerActionReturnPath("/tasks?status=todo&layout=kanban#task-1"),
    "/tasks?status=todo&layout=kanban#task-1",
  );
});

test("falls back to /timer for unsupported return paths", () => {
  assert.equal(getTimerActionReturnPath("/review"), "/timer");
  assert.equal(getTimerActionReturnPath(""), "/timer");
});
