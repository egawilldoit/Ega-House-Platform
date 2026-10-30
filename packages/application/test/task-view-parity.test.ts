import assert from "node:assert/strict";
import test from "node:test";

import type { TaskRecord } from "../src/tasks/ports";
import { buildMobileTaskListView } from "../src/tasks/list-view";
import { parseMobileTaskListQuery } from "../src/tasks/read-model";
import { applyTaskView, type TaskViewRecord } from "../src/tasks/view";

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, "id" | "title">): TaskRecord {
  return {
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    projectId: "project-1",
    goalId: null,
    plannedForDate: null,
    focusRank: null,
    archivedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    reminders: [],
    recurrence: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    projectName: "Project One",
    goalTitle: null,
    ...overrides,
  };
}

function toViewRecord(record: TaskRecord): TaskViewRecord {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    status: record.status,
    priority: record.priority,
    projectId: record.projectId,
    projectName: record.projectName,
    goalId: record.goalId,
    goalTitle: record.goalTitle,
    dueDate: record.dueDate,
    plannedForDate: record.plannedForDate,
    estimateMinutes: record.estimateMinutes,
    focusRank: record.focusRank,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const view = {
  version: 2 as const,
  filters: [
    { field: "status" as const, operator: "is_any_of" as const, values: ["todo", "in_progress"] },
  ],
  groupBy: "status" as const,
  sort: { key: "title" as const, direction: "asc" as const },
  search: "",
  activeOnly: false,
};

test("EGA-791: api read model applies the same view as the shared engine", () => {
  const records = [
    task({ id: "b", title: "Beta", status: "in_progress" }),
    task({ id: "a", title: "Alpha", status: "todo" }),
    task({ id: "c", title: "Gamma", status: "done" }),
  ];

  const result = buildMobileTaskListView({
    records,
    projects: [{ id: "project-1", name: "Project One", slug: null }],
    goals: [],
    query: { view, limit: 1, totalCount: 2 },
    today: "2026-11-01",
  });

  const shared = applyTaskView(records.map(toViewRecord), view, {
    today: "2026-11-01",
    limit: 1,
    totalCount: 2,
  });

  assert.deepEqual(result.items.map((item) => item.id), shared.items.map((item) => item.id));
  assert.deepEqual(result.items.map((item) => item.id), ["a"]);
  assert.equal(result.counters.total, 2);
  assert.equal(result.counters.loaded, 1);
  assert.equal(result.counters.truncated, true);
  assert.deepEqual(result.groups, [
    { key: "todo", label: "Todo", count: 1 },
    { key: "in_progress", label: "In Progress", count: 1 },
    { key: "review", label: "In Review", count: 0 },
    { key: "blocked", label: "Blocked", count: 0 },
    { key: "done", label: "Done", count: 0 },
  ]);
  assert.equal(result.filters.groupBy, "status");
  assert.equal(result.filters.sortKey, "title");
});

test("EGA-791: api query parser accepts repeated canonical filters and group/sort", () => {
  const values: Record<string, string[]> = {
    filter: [
      "status:is_not:done",
      "priority:is_any_of:urgent,high",
    ],
    group: ["priority"],
    sort: ["title"],
    dir: ["desc"],
    q: ["launch"],
  };

  const parsed = parseMobileTaskListQuery(
    (name) => values[name]?.[0] ?? null,
    (name) => values[name],
  );

  assert.ok(parsed.ok);
  assert.equal(parsed.data.view.groupBy, "priority");
  assert.deepEqual(parsed.data.view.sort, { key: "title", direction: "desc" });
  assert.equal(parsed.data.view.search, "launch");
  assert.deepEqual(parsed.data.view.filters, [
    { field: "status", operator: "is_not", values: ["done"] },
    { field: "priority", operator: "is_any_of", values: ["urgent", "high"] },
  ]);
});

test("EGA-791: api query parser rejects unknown group/sort values", () => {
  assert.equal(
    parseMobileTaskListQuery((name) => (name === "group" ? "assignee" : null)).ok,
    false,
  );
  assert.equal(
    parseMobileTaskListQuery((name) => (name === "sort" ? "nope" : null)).ok,
    false,
  );
});
