import assert from "node:assert/strict";
import test from "node:test";

import {
  ARCHIVE_SEARCH_MAX_LENGTH,
  ARCHIVE_TAB_VALUES,
  isArchiveTab,
  normalizeArchiveSearchQuery,
  normalizeArchiveTab,
} from "../src/index";

test("archive tabs are the fixed tasks/goals/projects set", () => {
  assert.deepEqual([...ARCHIVE_TAB_VALUES], ["tasks", "goals", "projects"]);
  assert.equal(isArchiveTab("tasks"), true);
  assert.equal(isArchiveTab("goals"), true);
  assert.equal(isArchiveTab("projects"), true);
  assert.equal(isArchiveTab("backlog"), false);
  assert.equal(isArchiveTab(null), false);
});

test("archive tab normalisation is case-insensitive and falls back to tasks", () => {
  assert.equal(normalizeArchiveTab(" Goals "), "goals");
  assert.equal(normalizeArchiveTab("PROJECTS"), "projects");
  assert.equal(normalizeArchiveTab("tasks"), "tasks");
  assert.equal(normalizeArchiveTab(""), "tasks");
  assert.equal(normalizeArchiveTab(undefined), "tasks");
  assert.equal(normalizeArchiveTab("archived"), "tasks");
});

test("archive search trims, collapses whitespace and bounds length", () => {
  assert.equal(normalizeArchiveSearchQuery("  ship   the  app "), "ship the app");
  assert.equal(normalizeArchiveSearchQuery(null), "");
  assert.equal(normalizeArchiveSearchQuery(42), "42");
  assert.equal(
    normalizeArchiveSearchQuery("x".repeat(ARCHIVE_SEARCH_MAX_LENGTH + 50)).length,
    ARCHIVE_SEARCH_MAX_LENGTH,
  );
});
