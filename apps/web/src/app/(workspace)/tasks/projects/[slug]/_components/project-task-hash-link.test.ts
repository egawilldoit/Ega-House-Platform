import assert from "node:assert/strict";
import test from "node:test";

import { getTaskIdFromHash } from "./project-task-hash-link";

test("project task hash links resolve only task anchors", () => {
  assert.equal(getTaskIdFromHash("#task-123e4567-e89b-12d3-a456-426614174000"), "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(getTaskIdFromHash("#goal-1"), null);
  assert.equal(getTaskIdFromHash(""), null);
  assert.equal(getTaskIdFromHash("#task-"), null);
  assert.equal(getTaskIdFromHash("#task-a/b"), null);
});
