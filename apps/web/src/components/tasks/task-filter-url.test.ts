import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActiveTaskFilterChips,
  buildClearTaskFiltersUrl,
  buildTaskViewFilterChips,
  mergeTaskFilterUrl,
  type TaskFilterState,
} from "./task-filter-url";
import { buildTaskListUrl, parseTaskListView } from "@/lib/task-list";
import type { TaskViewDefinition } from "@ega/contracts/common/task-list";

const fullState: TaskFilterState = {
  status: "in_progress",
  priority: "high,medium",
  estimateMin: 30,
  estimateMax: 120,
  dueWithin: 7,
  activeTasks: true,
  project: "project-1",
  goal: "goal-1",
  due: "overdue",
  sort: "due_date_asc",
  view: "archived",
  layout: "kanban",
};

function params(url: string) {
  return new URL(url, "https://egawilldoit.online").searchParams;
}

test("EGA-650: changing one filter preserves every unrelated advanced filter", () => {
  const url = mergeTaskFilterUrl("/tasks", fullState, { status: "todo" });
  const search = params(url);

  assert.equal(search.get("status"), "todo");
  assert.equal(search.get("priority"), "high,medium");
  assert.equal(search.get("estimateMin"), "30");
  assert.equal(search.get("estimateMax"), "120");
  assert.equal(search.get("dueWithin"), "7");
  assert.equal(search.get("tasks"), "active");
  assert.equal(search.get("project"), "project-1");
  assert.equal(search.get("goal"), "goal-1");
  assert.equal(search.get("due"), "overdue");
  assert.equal(search.get("sort"), "due");
  assert.equal(search.get("archive"), "archived");
  assert.equal(search.get("layout"), "kanban");
});

test("EGA-650: list/kanban and active/archive state survive a sort change", () => {
  const url = mergeTaskFilterUrl("/tasks", fullState, { sort: "updated_desc" });
  const search = params(url);

  assert.equal(search.get("layout"), "kanban");
  assert.equal(search.get("archive"), "archived");
  assert.equal(search.get("status"), "in_progress");
  // Default sort is not encoded.
  assert.equal(search.get("sort"), null);
});

test("EGA-650: removing one chip clears only that filter", () => {
  const chips = buildActiveTaskFilterChips("/tasks", fullState, {
    projectName: "EGA House",
    goalTitle: "Launch",
  });
  const byKey = new Map(chips.map((chip) => [chip.key, chip]));

  assert.ok(byKey.has("status"));
  assert.ok(byKey.has("priority"));
  assert.ok(byKey.has("estimate"));
  assert.ok(byKey.has("dueWithin"));
  assert.ok(byKey.has("activeTasks"));
  assert.ok(byKey.has("project"));
  assert.ok(byKey.has("goal"));
  assert.ok(byKey.has("due"));

  const dueWithinSearch = params(byKey.get("dueWithin")!.removeHref);
  assert.equal(dueWithinSearch.get("dueWithin"), null);
  assert.equal(dueWithinSearch.get("estimateMin"), "30");
  assert.equal(dueWithinSearch.get("tasks"), "active");
  assert.equal(dueWithinSearch.get("status"), "in_progress");

  const estimateSearch = params(byKey.get("estimate")!.removeHref);
  assert.equal(estimateSearch.get("estimateMin"), null);
  assert.equal(estimateSearch.get("estimateMax"), null);
  assert.equal(estimateSearch.get("dueWithin"), "7");
});

test("EGA-650: clear removes filter semantics but preserves view and layout", () => {
  const url = buildClearTaskFiltersUrl("/tasks", fullState);
  const search = params(url);

  assert.equal(search.get("archive"), "archived");
  assert.equal(search.get("layout"), "kanban");
  for (const key of [
    "status",
    "priority",
    "estimateMin",
    "estimateMax",
    "dueWithin",
    "tasks",
    "project",
    "goal",
    "due",
  ]) {
    assert.equal(search.get(key), null, `expected ${key} to be cleared`);
  }
});

test("EGA-793: calendar range, anchor and date field survive a filter change", () => {
  const calendarState: TaskFilterState = {
    ...fullState,
    layout: "calendar",
    cal: "week",
    date: "2026-05-06",
    dateField: "planned",
  };

  const url = mergeTaskFilterUrl("/tasks", calendarState, { status: "todo" });
  const search = params(url);

  assert.equal(search.get("layout"), "calendar");
  assert.equal(search.get("cal"), "week");
  assert.equal(search.get("date"), "2026-05-06");
  assert.equal(search.get("dateField"), "planned");
  assert.equal(search.get("status"), "todo");
});

test("EGA-793: switching away from calendar drops stale calendar parameters", () => {
  const calendarState: TaskFilterState = {
    ...fullState,
    layout: "calendar",
    cal: "week",
    date: "2026-05-06",
    dateField: "planned",
  };

  const url = mergeTaskFilterUrl("/tasks", calendarState, { layout: "list" });
  const search = params(url);

  assert.equal(search.get("layout"), null);
  assert.equal(search.get("cal"), null);
  assert.equal(search.get("date"), null);
  assert.equal(search.get("dateField"), null);
});

test("EGA-650: no chips when no filters are active", () => {
  const chips = buildActiveTaskFilterChips("/tasks", {
    status: null,
    priority: null,
    due: "all",
    sort: "updated_desc",
    view: "active",
    layout: "list",
  });
  assert.equal(chips.length, 0);
});


function searchParamsRecord(url: string) {
  const params = new URL(url, "https://egawilldoit.online").searchParams;
  const record: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
}

test("EGA-791: a complex view round-trips through the URL with group, sort and search", () => {
  const view: TaskViewDefinition = {
    version: 2,
    filters: [
      { field: "status", operator: "is_not", values: ["done"] },
      { field: "priority", operator: "is_any_of", values: ["urgent", "high"] },
      { field: "goal", operator: "is_none_of", values: ["goal-1"] },
      { field: "due_bucket", operator: "is", values: ["next_7_days"] },
      { field: "estimate", operator: "between", values: ["30", "120"] },
    ],
    groupBy: "priority",
    sort: { key: "title", direction: "desc" },
    search: "launch",
    activeOnly: true,
  };

  const url = buildTaskListUrl("/tasks", {
    filters: view.filters,
    group: view.groupBy,
    q: view.search,
    sortKey: view.sort.key,
    sortDirection: view.sort.direction,
    activeTasks: view.activeOnly,
    layout: "kanban",
  });

  assert.deepEqual(parseTaskListView(searchParamsRecord(url)), view);
  assert.equal(params(url).get("layout"), "kanban");
});

test("EGA-791: chips describe stackable filters and remove only their own filter", () => {
  const view: TaskViewDefinition = {
    version: 2,
    filters: [
      { field: "status", operator: "is", values: ["in_progress"] },
      { field: "priority", operator: "is", values: ["urgent"] },
      { field: "project", operator: "is", values: ["project-1"] },
    ],
    groupBy: "status",
    sort: { key: "manual", direction: "asc" },
    search: "launch",
    activeOnly: false,
  };
  const state: TaskFilterState = {
    filters: view.filters,
    group: view.groupBy,
    q: view.search,
    sortKey: view.sort.key,
    sortDirection: view.sort.direction,
    layout: "list",
  };

  const chips = buildTaskViewFilterChips("/tasks", view, state, {
    projectOptions: [{ id: "project-1", name: "EGA House" }],
  });

  assert.deepEqual(
    chips.map((chip) => chip.label),
    ["Search: launch", "Status is In Progress", "Priority is Urgent", "Project is EGA House"],
  );

  const statusChip = chips.find((chip) => chip.filterIndex === 0)!;
  const statusRemoval = parseTaskListView(searchParamsRecord(statusChip.removeHref));
  assert.deepEqual(statusRemoval.filters, [
    { field: "priority", operator: "is", values: ["urgent"] },
    { field: "project", operator: "is", values: ["project-1"] },
  ]);
  assert.equal(statusRemoval.groupBy, "status");
  assert.deepEqual(statusRemoval.sort, { key: "manual", direction: "asc" });

  const searchChip = chips.find((chip) => chip.key === "search")!;
  assert.equal(parseTaskListView(searchParamsRecord(searchChip.removeHref)).search, "");
});

test("EGA-792: table column layout survives filter and sort changes", () => {
  const columns = parseTaskListView({
    cols: "task,project,status",
    widths: "task:420",
  }).columns;
  const withColumns: TaskFilterState = { ...fullState, columns };

  const filtered = params(mergeTaskFilterUrl("/tasks", withColumns, { status: "todo" }));
  assert.equal(filtered.get("cols"), "task,project,status");
  assert.equal(filtered.get("widths"), "task:420");

  const sorted = params(
    mergeTaskFilterUrl("/tasks", withColumns, { sortKey: "priority", sortDirection: "desc" }),
  );
  assert.equal(sorted.get("cols"), "task,project,status");
  assert.equal(sorted.get("sort"), "priority");
  assert.equal(sorted.get("dir"), "desc");

  const cleared = params(buildClearTaskFiltersUrl("/tasks", withColumns));
  assert.equal(cleared.get("cols"), "task,project,status");
  assert.equal(cleared.get("widths"), "task:420");
});
