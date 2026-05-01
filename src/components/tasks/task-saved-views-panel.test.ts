import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BLOCKED_SAVED_VIEW_DEFINITION,
  DEEP_WORK_SAVED_VIEW_DEFINITION,
  DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
  QUICK_WINS_SAVED_VIEW_DEFINITION,
} from "@/lib/task-saved-views";
import {
  buildTaskSavedViewCurrentReturnPath,
  canEditTaskSavedView,
  getTaskSavedViewGroups,
  getTaskSavedViewHref,
  getTaskSavedViewsAllTasksHref,
  TaskSavedViewsPanel,
} from "./task-saved-views-panel";

(globalThis as { React?: typeof React }).React = React;

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
  {
    id: "default:quick-wins",
    name: "Quick Wins",
    status: null,
    project_id: null,
    goal_id: null,
    due_filter: "all",
    sort_value: "updated_desc",
    definition_json: QUICK_WINS_SAVED_VIEW_DEFINITION,
    updated_at: "2026-04-30T00:00:01.000Z",
    is_default: true,
  },
  {
    id: "default:blocked",
    name: "Blocked",
    status: null,
    project_id: null,
    goal_id: null,
    due_filter: "all",
    sort_value: "updated_desc",
    definition_json: BLOCKED_SAVED_VIEW_DEFINITION,
    updated_at: "2026-04-30T00:00:02.000Z",
    is_default: true,
  },
  {
    id: "default:due-this-week",
    name: "Due This Week",
    status: null,
    project_id: null,
    goal_id: null,
    due_filter: "all",
    sort_value: "updated_desc",
    definition_json: DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
    updated_at: "2026-04-30T00:00:03.000Z",
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
  estimateMaxMinutes: null,
  dueWithinDays: null,
} as const;

function renderPanel(views = [...savedViews]) {
  return renderToStaticMarkup(
    React.createElement(TaskSavedViewsPanel, {
      currentFilters,
      savedViews: views,
      activeLayout: "kanban",
      projectOptions: [{ id: "project-1", name: "Content" }],
      goalOptions: [{ id: "goal-1", title: "Goal A" }],
    }),
  );
}

test("saved view current filters stay filter-only and omit layout persistence", () => {
  const persistedFields = {
    status: currentFilters.status,
    project: currentFilters.projectId,
    goal: currentFilters.goalId,
    due: currentFilters.dueFilter,
    sort: currentFilters.sortValue,
    priority: currentFilters.priorityValues.join(","),
    estimateMin: currentFilters.estimateMinMinutes,
    estimateMax: currentFilters.estimateMaxMinutes,
    dueWithin: currentFilters.dueWithinDays,
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
    "estimateMax",
    "dueWithin",
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
    "/tasks?tasks=active&priority=urgent%2Chigh&estimateMin=30",
  );
});

test("new default saved view links apply definition filters and preserve layout", () => {
  assert.equal(
    getTaskSavedViewHref(savedViews[2], "kanban"),
    "/tasks?tasks=active&estimateMax=15&layout=kanban",
  );
  assert.equal(
    getTaskSavedViewHref(savedViews[3], "kanban"),
    "/tasks?tasks=active&status=blocked&layout=kanban",
  );
  assert.equal(
    getTaskSavedViewHref(savedViews[4], "kanban"),
    "/tasks?tasks=active&dueWithin=7&layout=kanban",
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

test("default saved views hide update and delete controls while custom views keep them", () => {
  assert.equal(canEditTaskSavedView(savedViews[0]), true);
  assert.equal(canEditTaskSavedView(savedViews[1]), false);
  assert.equal(canEditTaskSavedView(savedViews[2]), false);
  assert.equal(canEditTaskSavedView(savedViews[3]), false);
  assert.equal(canEditTaskSavedView(savedViews[4]), false);
});

test("saved view groups keep default views above custom views without sorting within groups", () => {
  const { defaultViews, customViews } = getTaskSavedViewGroups(savedViews);

  assert.deepEqual(defaultViews.map((view) => view.name), [
    "Deep Work",
    "Quick Wins",
    "Blocked",
    "Due This Week",
  ]);
  assert.deepEqual(customViews.map((view) => view.name), ["Blocked Content"]);
});

test("saved view panel renders default section before custom section with built-in labels", () => {
  const markup = renderPanel();

  assert.ok(markup.includes("Default views"));
  assert.ok(markup.includes("Custom views"));
  assert.ok(markup.indexOf("Default views") < markup.indexOf("Custom views"));
  assert.ok(markup.indexOf("Deep Work") < markup.indexOf("Blocked Content"));
  assert.ok(markup.includes("Built-in"));
});

test("default saved view rows keep open links and omit update/delete controls", () => {
  const markup = renderPanel();
  const defaultSection = markup.slice(markup.indexOf("Default views"), markup.indexOf("Custom views"));

  assert.ok(defaultSection.includes("/tasks?tasks=active&amp;priority=urgent%2Chigh&amp;estimateMin=30&amp;layout=kanban"));
  assert.ok(defaultSection.includes("Open"));
  assert.equal(defaultSection.includes("Update to current filters"), false);
  assert.equal(defaultSection.includes("Delete"), false);
});

test("custom saved view rows keep descriptions, counts, links, update, and delete controls", () => {
  const markup = renderPanel();
  const customSection = markup.slice(markup.indexOf("Custom views"));

  assert.ok(customSection.includes("1 saved"));
  assert.ok(customSection.includes("Blocked Content"));
  assert.ok(customSection.includes("Blocked · Content · Goal A · Overdue · Due latest"));
  assert.ok(customSection.includes("/tasks?status=blocked&amp;project=project-1&amp;goal=goal-1&amp;due=overdue&amp;sort=due_date_desc&amp;layout=kanban"));
  assert.ok(customSection.includes("Update to current filters"));
  assert.ok(customSection.includes("Delete"));
});

test("saved view panel keeps custom empty state and save form when only defaults exist", () => {
  const markup = renderPanel(savedViews.filter((view) => "is_default" in view && view.is_default));

  assert.ok(markup.includes("Default views"));
  assert.ok(markup.includes("Custom views"));
  assert.ok(markup.includes("No custom views yet."));
  assert.ok(markup.includes("Save view"));
  assert.ok(markup.includes('name="name"'));
});
