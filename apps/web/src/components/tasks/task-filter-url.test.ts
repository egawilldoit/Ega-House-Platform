import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActiveTaskFilterChips,
  buildClearTaskFiltersUrl,
  mergeTaskFilterUrl,
  type TaskFilterState,
} from "./task-filter-url";

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
  assert.equal(search.get("sort"), "due_date_asc");
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
