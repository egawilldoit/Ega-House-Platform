import assert from "node:assert/strict";
import test from "node:test";

import { isTaskArchived, normalizeTaskViewFilter } from "./task-archive";

test("normalizes task archive views", () => {
  assert.equal(normalizeTaskViewFilter(" archived "), "archived");
  assert.equal(normalizeTaskViewFilter("all"), "all");
  assert.equal(normalizeTaskViewFilter("unknown"), "active");
  assert.equal(normalizeTaskViewFilter(null), "active");
});

test("detects archived tasks from archived timestamp", () => {
  assert.equal(isTaskArchived("2026-04-25T12:00:00.000Z"), true);
  assert.equal(isTaskArchived(null), false);
  assert.equal(isTaskArchived(undefined), false);
});
