import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TASK_VIEW_DEFINITION,
  type TaskViewDefinition,
  type TaskViewFilter,
  type TaskViewGroupBy,
  type TaskViewSort,
} from "@ega/contracts/common/task-list";

import {
  applyTaskView,
  filterTaskViewRecords,
  groupTaskViewRecords,
  sortTaskViewRecords,
  type TaskViewRecord,
} from "../src/tasks/view";

function record(overrides: Partial<TaskViewRecord> = {}): TaskViewRecord {
  return {
    id: "task-a",
    title: "Alpha",
    description: null,
    status: "todo",
    priority: "medium",
    projectId: "project-1",
    projectName: "Project One",
    goalId: null,
    goalTitle: null,
    dueDate: null,
    plannedForDate: null,
    estimateMinutes: null,
    focusRank: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function view(
  filters: TaskViewFilter[] = [],
  overrides: Partial<TaskViewDefinition> = {},
): TaskViewDefinition {
  return {
    ...DEFAULT_TASK_VIEW_DEFINITION,
    filters,
    ...overrides,
  };
}

function ids(records: readonly TaskViewRecord[]) {
  return records.map((entry) => entry.id);
}

const TODAY = "2026-11-01";

test("EGA-791: every scalar filter operator has complement semantics", () => {
  const records = [
    record({ id: "todo", status: "todo" }),
    record({ id: "doing", status: "in_progress" }),
    record({ id: "done", status: "done" }),
  ];

  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "status", operator: "is", values: ["todo"] }]),
        { today: TODAY },
      ),
    ),
    ["todo"],
  );
  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "status", operator: "is_not", values: ["todo"] }]),
        { today: TODAY },
      ),
    ),
    ["doing", "done"],
  );
  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "status", operator: "is_any_of", values: ["todo", "done"] }]),
        { today: TODAY },
      ),
    ),
    ["todo", "done"],
  );
  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "status", operator: "is_none_of", values: ["todo", "done"] }]),
        { today: TODAY },
      ),
    ),
    ["doing"],
  );
});

test("EGA-791: null handling is explicit for nullable references", () => {
  const records = [
    record({ id: "no-goal", goalId: null }),
    record({ id: "goal-1", goalId: "goal-1", goalTitle: "Goal One" }),
    record({ id: "goal-2", goalId: "goal-2", goalTitle: "Goal Two" }),
  ];

  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "goal", operator: "is_not", values: ["goal-1"] }]),
        { today: TODAY },
      ),
    ),
    ["no-goal", "goal-2"],
  );
  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "goal", operator: "is_any_of", values: ["goal-1"] }]),
        { today: TODAY },
      ),
    ),
    ["goal-1"],
  );
  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "goal", operator: "is_none_of", values: ["goal-1"] }]),
        { today: TODAY },
      ),
    ),
    ["no-goal", "goal-2"],
  );
});

test("EGA-791: due buckets partition the set and keep completed work out of overdue", () => {
  const records = [
    record({ id: "overdue", dueDate: "2026-10-31" }),
    record({ id: "today", dueDate: "2026-11-01" }),
    record({ id: "soon", dueDate: "2026-11-08" }),
    record({ id: "later", dueDate: "2026-11-09" }),
    record({ id: "none", dueDate: null }),
    record({ id: "done-past", dueDate: "2026-10-31", status: "done" }),
  ];

  const byBucket = (bucket: string) =>
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "due_bucket", operator: "is", values: [bucket] }]),
        { today: TODAY },
      ),
    );

  assert.deepEqual(byBucket("overdue"), ["overdue"]);
  assert.deepEqual(byBucket("today"), ["today"]);
  // The legacy due-soon window includes today, so it intentionally overlaps
  // the `today` group bucket (grouping remains disjoint).
  assert.deepEqual(byBucket("next_7_days"), ["today", "soon"]);
  assert.deepEqual(byBucket("later"), ["later", "done-past"]);
  assert.deepEqual(byBucket("none"), ["none"]);
});

test("EGA-791: estimate between excludes nulls and honours open bounds", () => {
  const records = [
    record({ id: "none", estimateMinutes: null }),
    record({ id: "short", estimateMinutes: 10 }),
    record({ id: "mid", estimateMinutes: 60 }),
    record({ id: "long", estimateMinutes: 180 }),
  ];

  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "estimate", operator: "between", values: ["15", "120"] }]),
        { today: TODAY },
      ),
    ),
    ["mid"],
  );
  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "estimate", operator: "between", values: ["15", ""] }]),
        { today: TODAY },
      ),
    ),
    ["mid", "long"],
  );
  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view([{ field: "estimate", operator: "between", values: ["", "60"] }]),
        { today: TODAY },
      ),
    ),
    ["short", "mid"],
  );
});

test("EGA-791: active scope and title search compose with filters", () => {
  const records = [
    record({ id: "done", status: "done", title: "Launch checklist" }),
    record({ id: "live", status: "in_progress", title: "Launch checklist" }),
    record({ id: "other", status: "todo", title: "Errands" }),
  ];

  assert.deepEqual(
    ids(
      filterTaskViewRecords(
        records,
        view(
          [{ field: "status", operator: "is_none_of", values: ["done"] }],
          { activeOnly: true, search: "  LAUNCH " },
        ),
        { today: TODAY },
      ),
    ),
    ["live"],
  );
});

test("EGA-791: every sort key orders deterministically with a task-id tie-breaker", () => {
  const records = [
    record({ id: "b", title: "Beta", priority: "urgent", status: "done", estimateMinutes: 30, focusRank: 2 }),
    record({ id: "a", title: "Alpha", priority: "high", status: "blocked", estimateMinutes: 60, focusRank: 1 }),
    record({ id: "c", title: "Gamma", priority: "low", status: "todo", estimateMinutes: 10, focusRank: null }),
  ];

  const cases: Array<[TaskViewSort, string[]]> = [
    [{ key: "title", direction: "asc" }, ["a", "b", "c"]],
    [{ key: "title", direction: "desc" }, ["c", "b", "a"]],
    [{ key: "priority", direction: "asc" }, ["b", "a", "c"]],
    [{ key: "priority", direction: "desc" }, ["c", "a", "b"]],
    [{ key: "status", direction: "asc" }, ["c", "a", "b"]],
    [{ key: "estimate", direction: "asc" }, ["c", "b", "a"]],
    [{ key: "manual", direction: "asc" }, ["a", "b", "c"]],
  ];

  for (const [sort, expected] of cases) {
    assert.deepEqual(ids(sortTaskViewRecords(records, sort)), expected, JSON.stringify(sort));
  }

  // 785 manual rank is the canonical manual order; ties fall back to the id.
  const ranked = [
    record({ id: "rank-c", boardRank: "0m" }),
    record({ id: "rank-a", boardRank: "0a" }),
    record({ id: "rank-b", boardRank: "0f" }),
  ];
  assert.deepEqual(
    ids(sortTaskViewRecords(ranked, { key: "manual", direction: "asc" })),
    ["rank-a", "rank-b", "rank-c"],
  );

  // Equal primary keys fall back to the task id, in both directions.
  const tied = [
    record({ id: "task-2", title: "Same", updatedAt: "2026-01-01T00:00:00.000Z" }),
    record({ id: "task-1", title: "Same", updatedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(ids(sortTaskViewRecords(tied, { key: "title", direction: "desc" })), [
    "task-1",
    "task-2",
  ]);
});

test("EGA-791: null sort values stay last in both directions", () => {
  const records = [
    record({ id: "none", dueDate: null, plannedForDate: null, estimateMinutes: null }),
    record({ id: "early", dueDate: "2026-10-01", plannedForDate: "2026-10-01", estimateMinutes: 5 }),
    record({ id: "late", dueDate: "2026-12-01", plannedForDate: "2026-12-01", estimateMinutes: 90 }),
  ];

  assert.deepEqual(ids(sortTaskViewRecords(records, { key: "due", direction: "asc" })), [
    "early",
    "late",
    "none",
  ]);
  assert.deepEqual(ids(sortTaskViewRecords(records, { key: "due", direction: "desc" })), [
    "late",
    "early",
    "none",
  ]);
  assert.deepEqual(ids(sortTaskViewRecords(records, { key: "planned", direction: "asc" })), [
    "early",
    "late",
    "none",
  ]);
  assert.deepEqual(ids(sortTaskViewRecords(records, { key: "estimate", direction: "desc" })), [
    "late",
    "early",
    "none",
  ]);
});

test("EGA-791: status, priority and due groups include empty buckets", () => {
  const records = [record({ id: "todo", status: "todo", priority: "low" })];

  const statusGroups = groupTaskViewRecords(records, "status", { today: TODAY });
  assert.deepEqual(statusGroups.map((group) => group.key), [
    "todo",
    "in_progress",
    "review",
    "blocked",
    "done",
  ]);
  assert.deepEqual(statusGroups.map((group) => group.count), [1, 0, 0, 0, 0]);

  const priorityGroups = groupTaskViewRecords(records, "priority", { today: TODAY });
  assert.deepEqual(priorityGroups.map((group) => group.key), [
    "urgent",
    "high",
    "medium",
    "low",
  ]);
  assert.deepEqual(priorityGroups.map((group) => group.count), [0, 0, 0, 1]);

  const dueGroups = groupTaskViewRecords(records, "due_bucket", { today: TODAY });
  assert.deepEqual(dueGroups.map((group) => group.key), [
    "overdue",
    "today",
    "next_7_days",
    "later",
    "none",
  ]);
});

test("EGA-791: project and goal groups are present-only and label null goals", () => {
  const records = [
    record({ id: "p1", projectId: "p1", projectName: "Alpha", goalId: "g1", goalTitle: "Goal One" }),
    record({ id: "p2", projectId: "p2", projectName: "Beta", goalId: null }),
  ];

  const projectGroups = groupTaskViewRecords(records, "project", { today: TODAY });
  assert.deepEqual(projectGroups.map((group) => group.label), ["Alpha", "Beta"]);

  const goalGroups = groupTaskViewRecords(records, "goal", { today: TODAY });
  assert.deepEqual(goalGroups.map((group) => group.label), ["Goal One", "No goal"]);
});

test("EGA-791: counts cover more than the historical 500-row cap", () => {
  const records = Array.from({ length: 620 }, (_, index) =>
    record({
      id: `task-${String(index).padStart(4, "0")}`,
      priority: index % 2 === 0 ? "high" : "low",
    }),
  );

  const limited = applyTaskView(
    records,
    view([{ field: "priority", operator: "is", values: ["high"] }], {
      sort: { key: "manual", direction: "asc" },
    }),
    { today: TODAY, limit: 100, totalCount: 700 },
  );

  assert.equal(limited.matchedCount, 310);
  assert.equal(limited.loadedCount, 100);
  assert.equal(limited.totalCount, 700);
  assert.equal(limited.truncated, true);

  const all = applyTaskView(
    records,
    view([{ field: "priority", operator: "is", values: ["high"] }]),
    { today: TODAY, totalCount: 310 },
  );
  assert.equal(all.loadedCount, 310);
  assert.equal(all.truncated, false);
});

test("EGA-791: group counts describe the full filtered set while items respect the limit", () => {
  const records = Array.from({ length: 30 }, (_, index) =>
    record({ id: `task-${index}`, priority: index < 20 ? "high" : "low" }),
  );

  const result = applyTaskView(
    records,
    view([], { groupBy: "priority" }),
    { today: TODAY, limit: 10 },
  );
  const high = result.groups.find((group) => group.key === "high");
  const low = result.groups.find((group) => group.key === "low");
  assert.equal(high?.count, 20);
  assert.equal(low?.count, 10);
  assert.ok(result.groups.every((group) => group.items.length <= 10));
});

test("EGA-791: grouping can be requested by every supported value", () => {
  const records = [record({ id: "one" })];
  for (const groupBy of ["none", "status", "priority", "project", "goal", "due_bucket"] as const) {
    const groups = groupTaskViewRecords(records, groupBy as TaskViewGroupBy, { today: TODAY });
    assert.ok(groups.length > 0, groupBy);
  }
});
