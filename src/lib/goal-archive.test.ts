import assert from "node:assert/strict";
import test from "node:test";

import {
  GOAL_ARCHIVE_STATUS,
  isGoalArchivedStatus,
  normalizeGoalViewFilter,
} from "./goal-archive";

test("normalizes unsupported goal view values to active", () => {
  assert.equal(normalizeGoalViewFilter(""), "active");
  assert.equal(normalizeGoalViewFilter("focused"), "active");
});

test("normalizes goal view values", () => {
  assert.equal(normalizeGoalViewFilter(" archived "), "archived");
  assert.equal(normalizeGoalViewFilter("all"), "all");
});

test("detects archived goal statuses", () => {
  assert.equal(isGoalArchivedStatus("archived"), true);
  assert.equal(isGoalArchivedStatus("ARCHIVED"), true);
  assert.equal(isGoalArchivedStatus("active"), false);
  assert.equal(isGoalArchivedStatus(null), false);
  assert.equal(GOAL_ARCHIVE_STATUS, "archived");
});
