import assert from "node:assert/strict";
import test from "node:test";

import {
  areTaskSavedViewFiltersEqual,
  BLOCKED_SAVED_VIEW_DEFINITION,
  DEEP_WORK_SAVED_VIEW_DEFINITION,
  DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
  QUICK_WINS_SAVED_VIEW_DEFINITION,
  buildTaskSavedViewDefinition,
  getTaskSavedViewColumnsFromDefinition,
  getTaskSavedViewNameError,
  getTaskSavedViewDefinitionFromFilters,
  getTaskSavedViewFiltersFromDefinition,
  normalizeTaskSavedViewDefinition,
  normalizeTaskSavedViewFilters,
  validateTaskSavedViewScope,
  type TaskSavedViewFilters,
} from "./task-saved-views";
import { parseTaskTableColumns } from "./task-table-columns";

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
        activeTasks: true,
        priorityValues: ["urgent", "high"],
        estimateMinMinutes: 30,
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
        activeTasks: true,
        estimateMaxMinutes: 15,
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
        activeTasks: true,
        status: "blocked",
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
        activeTasks: true,
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
        priority: ["medium"],
        estimateMinMinutes: 30,
      },
    },
    {
      version: 1,
      filters: {
        activeTasks: true,
        priority: ["urgent", "high"],
        estimateMinMinutes: 25,
      },
    },
    {
      version: 1,
      filters: {
        activeTasks: true,
        estimateMaxMinutes: 20,
      },
    },
    {
      version: 1,
      filters: {
        activeTasks: true,
        dueWithinDays: 5,
      },
    },
    {
      version: 1,
      filters: {
        activeTasks: true,
        status: "todo",
      },
    },
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
  assert.equal(
    getTaskSavedViewDefinitionFromFilters({
      ...BASE_FILTERS,
      activeTasks: true,
      estimateMaxMinutes: 20,
    }),
    null,
  );
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

test("EGA-792: v2 definitions round-trip the per-view column layout", () => {
  const columns = parseTaskTableColumns({
    cols: "task,project,priority,due,status",
    widths: "task:420",
  });
  const filters = normalizeTaskSavedViewFilters({
    activeTasks: true,
    status: "in_progress",
    priority: "high,urgent",
    estimateMin: 30,
    dueWithin: 7,
  });
  const definition = buildTaskSavedViewDefinition(filters, columns);
  const normalized = normalizeTaskSavedViewDefinition(definition);

  assert.equal(normalized?.version, 2);
  assert.deepEqual(getTaskSavedViewColumnsFromDefinition(normalized), columns);
  assert.deepEqual(getTaskSavedViewFiltersFromDefinition(normalized), {
    activeTasks: true,
    status: "in_progress",
    priorityValues: ["high", "urgent"],
    estimateMinMinutes: 30,
    dueWithinDays: 7,
  });
  assert.equal("projectId" in definition, false);
  assert.equal("dueFilter" in definition, false);
  assert.equal("sortValue" in definition, false);
});

test("EGA-792: v1 views read with the default table columns", () => {
  const columns = getTaskSavedViewColumnsFromDefinition(BLOCKED_SAVED_VIEW_DEFINITION);
  assert.deepEqual(
    columns.filter((column) => column.visible).map((column) => column.id),
    ["task", "priority", "due", "status"],
  );
  assert.deepEqual(
    columns.map((column) => column.id),
    ["task", "priority", "due", "status", "project", "estimate"],
  );
});

test("EGA-792: old custom v1 filters still load", () => {
  const definition = normalizeTaskSavedViewDefinition({
    version: 1,
    filters: { activeTasks: true, priority: ["high"], dueWithinDays: 3 },
  });

  assert.equal(definition?.version, 1);
  assert.deepEqual(getTaskSavedViewFiltersFromDefinition(definition), {
    activeTasks: true,
    priorityValues: ["high"],
    dueWithinDays: 3,
  });
});

test("EGA-792: malformed v2 columns fall back to validated defaults", () => {
  const definition = normalizeTaskSavedViewDefinition({
    version: 2,
    filters: {},
    columns: [
      { id: "task", width: 10_000, visible: false },
      { id: "not-a-column", width: 100, visible: true },
    ],
  });

  const columns = getTaskSavedViewColumnsFromDefinition(definition);
  assert.equal(columns[0]?.id, "task");
  assert.equal(columns[0]?.visible, true);
  assert.equal(columns[0]?.width, 480);
});
