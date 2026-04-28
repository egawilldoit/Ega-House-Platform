import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTaskSavedViewCurrentReturnPath,
  getTaskSavedViewHref,
  getTaskSavedViewsAllTasksHref,
} from "./task-saved-views-panel";

const savedViews = [
  {
    id: "view-1",
    name: "Blocked Content",
    status: "blocked",
    project_id: "project-1",
    goal_id: "goal-1",
    due_filter: "overdue",
    sort_value: "due_date_desc",
    updated_at: "2026-04-28T10:00:00.000Z",
  },
] as const;

const currentFilters = {
  status: "todo",
  projectId: "project-1",
  goalId: "goal-1",
  dueFilter: "due_today",
  sortValue: "due_date_asc",
} as const;

test("saved view current filters stay filter-only and omit layout persistence", () => {
  const persistedFields = {
    status: currentFilters.status,
    project: currentFilters.projectId,
    goal: currentFilters.goalId,
    due: currentFilters.dueFilter,
    sort: currentFilters.sortValue,
  };

  assert.deepEqual(Object.keys(persistedFields), ["status", "project", "goal", "due", "sort"]);
  assert.equal("layout" in persistedFields, false);
});

test("saved view return paths preserve current kanban layout without storing it", () => {
  assert.equal(
    buildTaskSavedViewCurrentReturnPath(currentFilters, "kanban"),
    "/tasks?status=todo&project=project-1&goal=goal-1&due=due_today&sort=due_date_asc&layout=kanban",
  );
  assert.equal(
    getTaskSavedViewHref(savedViews[0], "kanban"),
    "/tasks?status=blocked&project=project-1&goal=goal-1&due=overdue&sort=due_date_desc&layout=kanban",
  );
  assert.equal(getTaskSavedViewsAllTasksHref("kanban"), "/tasks?layout=kanban");
});

test("saved view links do not force layout in list mode", () => {
  assert.equal(
    getTaskSavedViewHref(savedViews[0], "list"),
    "/tasks?status=blocked&project=project-1&goal=goal-1&due=overdue&sort=due_date_desc",
  );
  assert.equal(getTaskSavedViewHref(savedViews[0], "list").includes("layout=list"), false);
  assert.equal(getTaskSavedViewsAllTasksHref("list"), "/tasks");
});
