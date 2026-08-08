import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  INTERNAL_ERROR_RESPONSE,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_VALUES,
  isTaskDueFilter,
  isTaskSortValue,
} from "../src/index";

test("mobile task list query wire values remain stable", () => {
  assert.deepEqual(TASK_DUE_FILTER_VALUES, [
    "all",
    "overdue",
    "due_today",
    "due_soon",
    "no_due_date",
  ]);
  assert.deepEqual(TASK_SORT_VALUES, ["updated_desc", "due_date_asc", "due_date_desc"]);
  assert.equal(DEFAULT_TASK_DUE_FILTER, "all");
  assert.equal(DEFAULT_TASK_SORT, "updated_desc");
  assert.equal(isTaskDueFilter("due_today"), true);
  assert.equal(isTaskDueFilter("today"), false);
  assert.equal(isTaskSortValue("updated_desc"), true);
});

test("agent internal error wire response remains stable", () => {
  assert.deepEqual(INTERNAL_ERROR_RESPONSE, {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
    },
  });
});
