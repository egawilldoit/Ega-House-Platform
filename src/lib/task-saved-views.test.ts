import assert from "node:assert/strict";
import test from "node:test";

import {
  areTaskSavedViewFiltersEqual,
  DEEP_WORK_SAVED_VIEW_DEFINITION,
  getTaskSavedViewNameError,
  getTaskSavedViewDefinitionFromFilters,
  getTaskSavedViewFiltersFromDefinition,
  normalizeTaskSavedViewDefinition,
  normalizeTaskSavedViewFilters,
  validateTaskSavedViewScope,
} from "./task-saved-views";

test("normalizes invalid saved-view values to safe defaults", () => {
  const filters = normalizeTaskSavedViewFilters({
    status: "invalid",
    projectId: "  ",
    goalId: "",
    dueFilter: "soon",
    sortValue: "latest",
  });

  assert.deepEqual(filters, {
    status: null,
    projectId: null,
    goalId: null,
    dueFilter: "all",
    sortValue: "updated_desc",
    activeTasks: false,
    priorityValues: [],
    estimateMinMinutes: null,
  });
});

test("normalizes valid saved-view filters", () => {
  const filters = normalizeTaskSavedViewFilters({
    status: "todo",
    projectId: " project-1 ",
    goalId: " goal-1 ",
    dueFilter: "due_today",
    sortValue: "due_date_asc",
  });

  assert.deepEqual(filters, {
    status: "todo",
    projectId: "project-1",
    goalId: "goal-1",
    dueFilter: "due_today",
    sortValue: "due_date_asc",
    activeTasks: false,
    priorityValues: [],
    estimateMinMinutes: null,
  });
});

test("normalizes Deep Work saved-view definition", () => {
  const definition = normalizeTaskSavedViewDefinition({
    version: 1,
    filters: {
      activeTasks: true,
      priority: ["urgent", "high"],
      estimateMinMinutes: 30,
      ownerUserId: "attacker",
    },
  });

  assert.deepEqual(definition, DEEP_WORK_SAVED_VIEW_DEFINITION);
  assert.deepEqual(getTaskSavedViewFiltersFromDefinition(definition), {
    activeTasks: true,
    priorityValues: ["urgent", "high"],
    estimateMinMinutes: 30,
  });
});

test("rejects unsupported saved-view definition filters", () => {
  assert.equal(
    normalizeTaskSavedViewDefinition({
      version: 1,
      filters: {
        activeTasks: true,
        priority: ["medium"],
        estimateMinMinutes: 30,
      },
    }),
    null,
  );
  assert.equal(
    normalizeTaskSavedViewDefinition({
      filters: {
        activeTasks: true,
        priority: ["urgent", "high"],
        estimateMinMinutes: 25,
      },
    }),
    null,
  );
  assert.equal(normalizeTaskSavedViewDefinition(null), null);
});

test("builds definition only for Deep Work filters", () => {
  const deepWorkFilters = normalizeTaskSavedViewFilters({
    activeTasks: true,
    priority: "urgent,high,invalid",
    estimateMinMinutes: "30",
  });

  assert.deepEqual(
    getTaskSavedViewDefinitionFromFilters(deepWorkFilters),
    DEEP_WORK_SAVED_VIEW_DEFINITION,
  );

  assert.equal(
    getTaskSavedViewDefinitionFromFilters({
      ...deepWorkFilters,
      estimateMinMinutes: 45,
    }),
    null,
  );
});

test("compares filter equality across all filter fields", () => {
  const base = {
    status: "blocked",
    projectId: "project-1",
    goalId: "goal-1",
    dueFilter: "overdue",
    sortValue: "due_date_desc",
    activeTasks: true,
    priorityValues: ["urgent", "high"],
    estimateMinMinutes: 30,
  } as const;

  assert.equal(areTaskSavedViewFiltersEqual(base, { ...base }), true);
  assert.equal(
    areTaskSavedViewFiltersEqual(base, {
      ...base,
      sortValue: "updated_desc",
    }),
    false,
  );
});

test("validates goal-to-project compatibility in scope", () => {
  const scope = {
    projectIds: new Set(["project-1"]),
    goalsById: new Map([
      ["goal-1", { id: "goal-1", projectId: "project-1" }],
      ["goal-2", { id: "goal-2", projectId: "project-2" }],
    ]),
  };

  assert.equal(
    validateTaskSavedViewScope(
      {
        status: null,
        projectId: "project-1",
        goalId: "goal-2",
        dueFilter: "all",
        sortValue: "updated_desc",
        activeTasks: false,
        priorityValues: [],
        estimateMinMinutes: null,
      },
      scope,
    ),
    "Selected goal does not belong to the chosen project.",
  );

  assert.equal(
    validateTaskSavedViewScope(
      {
        status: null,
        projectId: "project-1",
        goalId: "goal-1",
        dueFilter: "all",
        sortValue: "updated_desc",
        activeTasks: false,
        priorityValues: [],
        estimateMinMinutes: null,
      },
      scope,
    ),
    null,
  );
});

test("validates saved-view names", () => {
  assert.equal(getTaskSavedViewNameError(""), "Saved view name is required.");
  assert.match(getTaskSavedViewNameError("x".repeat(81)) ?? "", /80 characters or fewer/);
  assert.equal(getTaskSavedViewNameError("Today"), null);
});
