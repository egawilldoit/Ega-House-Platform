import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_ARCHIVE_STATUS,
  isProjectArchivedStatus,
  normalizeProjectViewFilter,
} from "./project-archive";

test("normalizes project archive views", () => {
  assert.equal(normalizeProjectViewFilter(undefined), "active");
  assert.equal(normalizeProjectViewFilter(" archived "), "archived");
  assert.equal(normalizeProjectViewFilter("ALL"), "all");
  assert.equal(normalizeProjectViewFilter("unknown"), "active");
});

test("detects archived project statuses", () => {
  assert.equal(isProjectArchivedStatus("archived"), true);
  assert.equal(isProjectArchivedStatus("ARCHIVED"), true);
  assert.equal(isProjectArchivedStatus("active"), false);
  assert.equal(isProjectArchivedStatus(null), false);
  assert.equal(PROJECT_ARCHIVE_STATUS, "archived");
});
