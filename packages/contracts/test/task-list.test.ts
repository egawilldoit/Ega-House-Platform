import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TASK_VIEW_DEFINITION,
  TASK_VIEW_DEFINITION_MAX_CHARS,
  canExactlyCountTaskViewFilters,
  normalizeTaskViewDefinition,
  parseTaskViewDefinitionJson,
  parseTaskViewSearchParams,
  serializeTaskViewDefinition,
  toTaskViewSearchPairs,
  type TaskViewDefinition,
} from "../src/common/task-list";

function roundTrip(view: TaskViewDefinition) {
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of toTaskViewSearchPairs(view)) {
    const existing = params[key];
    params[key] = existing
      ? Array.isArray(existing)
        ? [...existing, value]
        : [existing, value]
      : value;
  }
  return parseTaskViewSearchParams(params);
}

test("EGA-791: v2 definition round-trips through the URL codec", () => {
  const view = normalizeTaskViewDefinition({
    version: 2,
    filters: [
      { field: "status", operator: "is_not", values: ["done"] },
      { field: "priority", operator: "is_any_of", values: ["urgent", "high"] },
      { field: "project", operator: "is", values: ["project-1"] },
      { field: "goal", operator: "is_none_of", values: ["goal-1"] },
      { field: "due_bucket", operator: "is", values: ["next_7_days"] },
      { field: "estimate", operator: "between", values: ["15", "120"] },
    ],
    groupBy: "priority",
    sort: { key: "title", direction: "desc" },
    search: "  launch  ",
    activeOnly: true,
  });

  assert.ok(view);
  assert.equal(view.search, "launch");
  assert.deepEqual(roundTrip(view), view);
});

test("EGA-791: legacy URL aliases still parse into the same definition", () => {
  const view = parseTaskViewSearchParams({
    status: "in_progress",
    priority: "urgent,high",
    project: "project-1",
    goal: "goal-1",
    due: "due_soon",
    dueWithin: "7",
    estimateMin: "30",
    estimateMax: "120",
    tasks: "active",
    sort: "due_date_asc",
  });

  assert.deepEqual(view.filters, [
    { field: "status", operator: "is", values: ["in_progress"] },
    { field: "priority", operator: "is_any_of", values: ["urgent", "high"] },
    { field: "project", operator: "is", values: ["project-1"] },
    { field: "goal", operator: "is", values: ["goal-1"] },
    { field: "due_bucket", operator: "is", values: ["next_7_days"] },
    { field: "due_within_days", operator: "is", values: ["7"] },
    { field: "estimate", operator: "between", values: ["30", "120"] },
  ]);
  assert.equal(view.activeOnly, true);
  assert.deepEqual(view.sort, { key: "due", direction: "asc" });
});

test("EGA-791: version 1 saved definitions migrate on read", () => {
  const migrated = normalizeTaskViewDefinition({
    version: 1,
    filters: {
      activeTasks: true,
      status: "blocked",
      priority: ["urgent", "high"],
      estimateMinMinutes: 30,
      dueWithinDays: 7,
    },
  });

  assert.ok(migrated);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.activeOnly, true);
  assert.deepEqual(migrated.filters, [
    { field: "status", operator: "is", values: ["blocked"] },
    { field: "priority", operator: "is_any_of", values: ["urgent", "high"] },
    { field: "due_within_days", operator: "is", values: ["7"] },
    { field: "estimate", operator: "between", values: ["30", ""] },
  ]);
});

test("EGA-791: unknown versions, unknown keys and invalid operators are rejected", () => {
  assert.equal(normalizeTaskViewDefinition({ version: 3, filters: [] }), null);
  assert.equal(
    normalizeTaskViewDefinition({ version: 2, filters: [], unexpected: true }),
    null,
  );
  assert.equal(
    normalizeTaskViewDefinition({
      version: 2,
      filters: [{ field: "status", operator: "equals", values: ["todo"] }],
    }),
    null,
  );
  assert.equal(
    normalizeTaskViewDefinition({
      version: 2,
      filters: [{ field: "title; drop table tasks", operator: "is", values: ["x"] }],
    }),
    null,
  );
  assert.equal(
    normalizeTaskViewDefinition({
      version: 2,
      filters: [{ field: "project", operator: "is", values: ["'; drop table tasks; --"] }],
    }),
    null,
  );
});

test("EGA-791: definition sizes and value counts are bounded", () => {
  const tooManyFilters = {
    version: 2,
    filters: Array.from({ length: 9 }, () => ({
      field: "status",
      operator: "is",
      values: ["todo"],
    })),
  };
  assert.equal(normalizeTaskViewDefinition(tooManyFilters), null);

  const tooManyValues = {
    version: 2,
    filters: [
      {
        field: "priority",
        operator: "is_any_of",
        values: Array.from({ length: 25 }, () => "high"),
      },
    ],
  };
  assert.equal(normalizeTaskViewDefinition(tooManyValues), null);

  const oversizedSearch = {
    version: 2,
    filters: [],
    search: "x".repeat(121),
  };
  assert.equal(normalizeTaskViewDefinition(oversizedSearch), null);

  assert.equal(
    parseTaskViewDefinitionJson("x".repeat(TASK_VIEW_DEFINITION_MAX_CHARS + 1)),
    null,
  );
});

test("EGA-791: invalid URL entries are dropped without failing the page", () => {
  const view = parseTaskViewSearchParams({
    status: "todo,not-a-status",
    priority: "urgent",
    group: "not-a-group",
    sort: "not-a-sort",
    filter: ["status:between:todo", "goal:is:goal-1", "unknown:is:x"],
    q: "  ",
  });

  assert.deepEqual(view.filters, [
    { field: "status", operator: "is", values: ["todo"] },
    { field: "priority", operator: "is", values: ["urgent"] },
    { field: "goal", operator: "is", values: ["goal-1"] },
  ]);
  assert.equal(view.groupBy, "none");
  assert.deepEqual(view.sort, DEFAULT_TASK_VIEW_DEFINITION.sort);
  assert.equal(view.search, "");
});

test("EGA-791: serializable definitions stay under the contract bound", () => {
  const view = normalizeTaskViewDefinition(DEFAULT_TASK_VIEW_DEFINITION);
  assert.ok(view);
  assert.ok(serializeTaskViewDefinition(view).length <= TASK_VIEW_DEFINITION_MAX_CHARS);
});


test("EGA-791: only exactly pushable filters can drive a precise count", () => {
  assert.equal(
    canExactlyCountTaskViewFilters([
      { field: "status", operator: "is_not", values: ["done"] },
      { field: "project", operator: "is_any_of", values: ["project-1"] },
      { field: "due_bucket", operator: "is", values: ["today"] },
      { field: "estimate", operator: "between", values: ["15", "120"] },
    ]),
    true,
  );
  assert.equal(
    canExactlyCountTaskViewFilters([
      { field: "due_bucket", operator: "is", values: ["later"] },
    ]),
    false,
  );
  assert.equal(
    canExactlyCountTaskViewFilters([
      { field: "goal", operator: "is_not", values: ["goal-1"] },
    ]),
    false,
  );
});
