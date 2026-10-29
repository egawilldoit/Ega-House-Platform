import assert from "node:assert/strict";
import test from "node:test";

import {
  areTaskSavedViewFiltersEqual,
  BLOCKED_SAVED_VIEW_DEFINITION,
  DEEP_WORK_SAVED_VIEW_DEFINITION,
  DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
  QUICK_WINS_SAVED_VIEW_DEFINITION,
  getTaskSavedViewNameError,
  getTaskSavedViewDefinitionFromFilters,
  getTaskSavedViewFiltersFromDefinition,
  normalizeTaskSavedViewDefinition,
  normalizeTaskSavedViewFilters,
  validateTaskSavedViewScope,
  type TaskSavedViewFilters,
} from "./task-saved-views";

const BASE_FILTERS: TaskSavedViewFilters = {
  status: null,
  projectId: null,
  goalId: null,
  dueFilter: "all",
  sortValue: "updated_desc",
  activeTasks: false,
  priorityValues: [],
  estimateMinMinutes: null,
  estimateMaxMinutes: null,
  dueWithinDays: null,
};

test("normalizes invalid saved-view values to safe defaults", () => {
  const filters = normalizeTaskSavedViewFilters({
    status: "invalid",
    projectId: "  ",
    goalId: "",
    dueFilter: "soon",
    sortValue: "latest",
    estimateMaxMinutes: "none",
    dueWithinDays: "soon",
  });

  assert.deepEqual(filters, BASE_FILTERS);
});

test("normalizes valid saved-view filters", () => {
  const filters = normalizeTaskSavedViewFilters({
    status: "todo",
    projectId: " project-1 ",
    goalId: " goal-1 ",
    dueFilter: "due_today",
    sortValue: "due_date_asc",
    estimateMaxMinutes: "15",
    dueWithinDays: "7",
  });

  assert.deepEqual(filters, {
    ...BASE_FILTERS,
    status: "todo",
    projectId: "project-1",
    goalId: "goal-1",
    dueFilter: "due_today",
    sortValue: "due_date_asc",
    estimateMaxMinutes: 15,
    dueWithinDays: 7,
  });
});

test("normalizes all system saved-view definitions", () => {
  const cases = [
    [
      {
        version: 1,
        filters: {
          activeTasks: true,
          priority: ["urgent", "high"],
          estimateMinMinutes: 30,
        },
      },
      DEEP_WORK_SAVED_VIEW_DEFINITION,
      {
        status: null,
        projectId: null,
        goalId: null,
        dueFilter: "all",
        sortValue: "updated_desc",
        activeTasks: true,
        priorityValues: ["urgent", "high"],
        estimateMinMinutes: 30,
        estimateMaxMinutes: null,
        dueWithinDays: null,
      },
    ],
    [
      {
        version: 1,
        filters: {
          activeTasks: true,
          estimateMaxMinutes: 15,
        },
      },
      QUICK_WINS_SAVED_VIEW_DEFINITION,
      {
        status: null,
        projectId: null,
        goalId: null,
        dueFilter: "all",
        sortValue: "updated_desc",
        activeTasks: true,
        priorityValues: [],
        estimateMinMinutes: null,
        estimateMaxMinutes: 15,
        dueWithinDays: null,
      },
    ],
    [
      {
        version: 1,
        filters: {
          activeTasks: true,
          status: "blocked",
        },
      },
      BLOCKED_SAVED_VIEW_DEFINITION,
      {
        status: "blocked",
        projectId: null,
        goalId: null,
        dueFilter: "all",
        sortValue: "updated_desc",
        activeTasks: true,
        priorityValues: [],
        estimateMinMinutes: null,
        estimateMaxMinutes: null,
        dueWithinDays: null,
      },
    ],
    [
      {
        version: 1,
        filters: {
          activeTasks: true,
          dueWithinDays: 7,
        },
      },
      DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
      {
        status: null,
        projectId: null,
        goalId: null,
        dueFilter: "all",
        sortValue: "updated_desc",
        activeTasks: true,
        priorityValues: [],
        estimateMinMinutes: null,
        estimateMaxMinutes: null,
        dueWithinDays: 7,
      },
    ],
  ] as const;

  for (const [raw, expectedDefinition, expectedFilters] of cases) {
    const definition = normalizeTaskSavedViewDefinition(raw);

    assert.deepEqual(definition, expectedDefinition);
    assert.deepEqual(getTaskSavedViewFiltersFromDefinition(definition), expectedFilters);
  }
});

test("rejects unsupported saved-view definition filters", () => {
  const unsupportedDefinitions = [
    {
      version: 1,
      filters: {
        activeTasks: true,
        estimateMaxMinutes: 15,
        ownerUserId: "attacker",
      },
    },
    {
      version: 1,
      filters: {
        activeTasks: true,
        status: "blocked",
        priority: ["urgent", "invalid"],
      },
    },
    {
      version: 1,
      filters: {
        activeTasks: true,
        estimateMaxMinutes: "15",
      },
    },
    {
      version: 1,
      filters: {
        activeTasks: true,
        dueWithinDays: "7",
      },
    },
    null,
  ];

  for (const definition of unsupportedDefinitions) {
    assert.equal(normalizeTaskSavedViewDefinition(definition), null);
  }
});

test("builds definitions for all system presets", () => {
  assert.deepEqual(
    getTaskSavedViewDefinitionFromFilters(
      normalizeTaskSavedViewFilters({
        activeTasks: true,
        priority: "urgent,high,invalid",
        estimateMinMinutes: "30",
      }),
    ),
    DEEP_WORK_SAVED_VIEW_DEFINITION,
  );
  assert.deepEqual(
    getTaskSavedViewDefinitionFromFilters(
      normalizeTaskSavedViewFilters({
        activeTasks: true,
        estimateMaxMinutes: "15",
      }),
    ),
    QUICK_WINS_SAVED_VIEW_DEFINITION,
  );
  assert.deepEqual(
    getTaskSavedViewDefinitionFromFilters(
      normalizeTaskSavedViewFilters({
        activeTasks: true,
        status: "blocked",
      }),
    ),
    BLOCKED_SAVED_VIEW_DEFINITION,
  );
  assert.deepEqual(
    getTaskSavedViewDefinitionFromFilters(
      normalizeTaskSavedViewFilters({
        activeTasks: true,
        dueWithinDays: "7",
      }),
    ),
    DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
  );
  const nonPreset = getTaskSavedViewDefinitionFromFilters({
    ...BASE_FILTERS,
    activeTasks: true,
    estimateMaxMinutes: 20,
  });
  assert.equal(nonPreset.version, 2);
  assert.deepEqual(nonPreset.filters, [
    { field: "estimate", operator: "between", values: ["", "20"] },
  ]);
});

test("compares filter equality across all filter fields", () => {
  const base = {
    ...BASE_FILTERS,
    status: "blocked",
    projectId: "project-1",
    goalId: "goal-1",
    dueFilter: "overdue",
    sortValue: "due_date_desc",
    activeTasks: true,
    priorityValues: ["urgent", "high"],
    estimateMinMinutes: 30,
    estimateMaxMinutes: 15,
    dueWithinDays: 7,
  } as const;

  assert.equal(areTaskSavedViewFiltersEqual(base, { ...base }), true);
  assert.equal(areTaskSavedViewFiltersEqual(base, { ...base, estimateMaxMinutes: null }), false);
  assert.equal(areTaskSavedViewFiltersEqual(base, { ...base, dueWithinDays: null }), false);
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
        ...BASE_FILTERS,
        projectId: "project-1",
        goalId: "goal-2",
      },
      scope,
    ),
    "Selected goal does not belong to the chosen project.",
  );

  assert.equal(
    validateTaskSavedViewScope(
      {
        ...BASE_FILTERS,
        projectId: "project-1",
        goalId: "goal-1",
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

test("EGA-792: v2 saved-view definitions round-trip the per-view column layout", () => {
  const columns = [
    { id: "task", width: 420, visible: true },
    { id: "project", width: 240, visible: true },
    { id: "priority", width: 112, visible: true },
    { id: "status", width: 144, visible: true },
    { id: "due", width: 152, visible: false },
    { id: "estimate", width: 112, visible: false },
  ];
  const normalized = normalizeTaskSavedViewDefinition({
    version: 2,
    filters: [
      { field: "status", operator: "is", values: ["in_progress"] },
      { field: "priority", operator: "is_any_of", values: ["high", "urgent"] },
      { field: "estimate", operator: "between", values: ["30", ""] },
      { field: "due_within_days", operator: "is", values: ["7"] },
    ],
    groupBy: "none",
    sort: { key: "updated", direction: "desc" },
    search: "",
    activeOnly: true,
    columns,
  });

  assert.equal(normalized?.version, 2);
  assert.deepEqual(normalized?.columns, columns);
  assert.deepEqual(getTaskSavedViewFiltersFromDefinition(normalized), {
    activeTasks: true,
    status: "in_progress",
    priorityValues: ["high", "urgent"],
    estimateMinMinutes: 30,
    dueWithinDays: 7,
  });
});

test("EGA-792: v1 views read without an explicit column layout", () => {
  const definition = normalizeTaskSavedViewDefinition(BLOCKED_SAVED_VIEW_DEFINITION);
  assert.ok(definition);
  assert.equal(definition!.columns, undefined);
});

test("EGA-792: malformed v2 columns fall back to validated defaults", () => {
  const definition = normalizeTaskSavedViewDefinition({
    version: 2,
    filters: [],
    groupBy: "none",
    sort: { key: "updated", direction: "desc" },
    search: "",
    activeOnly: false,
    columns: [
      { id: "task", width: 10_000, visible: false },
      { id: "not-a-column", width: 100, visible: true },
    ],
  });

  const columns = definition?.columns ?? [];
  assert.equal(columns[0]?.id, "task");
  assert.equal(columns[0]?.visible, true);
  assert.equal(columns[0]?.width, 480);
});
