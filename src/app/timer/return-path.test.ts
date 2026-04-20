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

test("falls back to /timer for unsupported return paths", () => {
  assert.equal(getTimerActionReturnPath("/tasks"), "/timer");
  assert.equal(getTimerActionReturnPath(""), "/timer");
});
