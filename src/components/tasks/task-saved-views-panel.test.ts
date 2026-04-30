import assert from "node:assert/strict";
import test from "node:test";

import { DEEP_WORK_SAVED_VIEW_DEFINITION } from "@/lib/task-saved-views";
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
    definition_json: null,
    updated_at: "2026-04-28T10:00:00.000Z",
  },
  {
    id: "default:deep-work",
    name: "Deep Work",
    status: null,
    project_id: null,
    goal_id: null,
    due_filter: "all",
    sort_value: "updated_desc",
    definition_json: DEEP_WORK_SAVED_VIEW_DEFINITION,
    updated_at: "2026-04-30T00:00:00.000Z",
    is_default: true,
  },
] as const;

const currentFilters = {
  status: "todo",
  projectId: "project-1",
  goalId: "goal-1",
  dueFilter: "due_today",
  sortValue: "due_date_asc",
  activeTasks: false,
  priorityValues: [],
  estimateMinMinutes: null,
} as const;

test("saved view current filters stay filter-only and omit layout persistence", () => {
  const persistedFields = {
    status: currentFilters.status,
    project: currentFilters.projectId,
    goal: currentFilters.goalId,
    due: currentFilters.dueFilter,
    sort: currentFilters.sortValue,
    priority: currentFilters.priorityValues.join(","),
    estimateMin: currentFilters.estimateMinMinutes,
    activeTasks: currentFilters.activeTasks,
  };

  assert.deepEqual(Object.keys(persistedFields), [
    "status",
    "project",
    "goal",
    "due",
    "sort",
    "priority",
    "estimateMin",
    "activeTasks",
  ]);
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

test("Deep Work saved view link applies definition filters", () => {
  assert.equal(
    getTaskSavedViewHref(savedViews[1], "list"),
    "/tasks?priority=urgent%2Chigh&estimateMin=30&tasks=active",
  );
});

test("saved view links do not force layout in list mode", () => {
  assert.equal(
    getTaskSavedViewHref(savedViews[0], "list"),
    "/tasks?status=blocked&project=project-1&goal=goal-1&due=overdue&sort=due_date_desc",
  );
  assert.equal(getTaskSavedViewHref(savedViews[0], "list").includes("layout=list"), false);
  assert.equal(getTaskSavedViewsAllTasksHref("list"), "/tasks");
});
