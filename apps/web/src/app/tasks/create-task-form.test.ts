import assert from "node:assert/strict";


import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";
vi.mock("./actions", () => ({ createTaskAction: vi.fn() }));

import { CreateTaskForm, buildCreateTaskFormInitialState } from "./create-task-form";

const projects = [
  { id: "project-1", name: "Execution OS" },
  { id: "project-2", name: "Content Engine" },
];

test("create task form preserves project context and kanban return path", () => {
  const state = buildCreateTaskFormInitialState({
    projects,
    projectId: "project-2",
    returnTo:
      "/tasks?status=blocked&project=project-2&goal=goal-2&due=overdue&sort=due_date_desc&archive=all&layout=kanban",
  });

  assert.equal(state.isProjectScoped, true);
  assert.equal(state.initialState.values.projectId, "project-2");
  assert.equal(state.initialState.values.workedTimeStartedAt, "");
  assert.equal(state.initialState.values.workedTimeEndedAt, "");
  assert.equal(state.initialState.values.scheduledStartAt, "");
  assert.equal(state.initialState.values.scheduledEndAt, "");
  assert.equal(state.initialState.values.calendarSyncEnabled, "");
  assert.equal(state.initialState.values.calendarReminderMinutes, "10");
  assert.equal(
    state.initialState.values.returnTo,
    "/tasks?status=blocked&project=project-2&goal=goal-2&due=overdue&sort=due_date_desc&archive=all&layout=kanban",
  );
});

test("create task form uses Calendar settings for scheduling defaults", () => {
  const state = buildCreateTaskFormInitialState({
    projects,
    calendarDefaults: {
      calendarSyncEnabled: true,
      calendarReminderMinutes: 25,
    },
  });

  assert.equal(state.initialState.values.calendarSyncEnabled, "on");
  assert.equal(state.initialState.values.calendarReminderMinutes, "25");
});

test("create task form keeps list mode return path free of layout=list", () => {
  const state = buildCreateTaskFormInitialState({
    projects,
    projectId: "project-1",
    returnTo: "/tasks?status=todo&project=project-1",
  });

  assert.equal(state.initialState.values.returnTo, "/tasks?status=todo&project=project-1");
  assert.equal(state.initialState.values.returnTo.includes("layout=list"), false);
});

test("title input enforces the schema limit and describes its counter", () => {
  const markup = renderToStaticMarkup(React.createElement(CreateTaskForm, { projects, goals: [] }));
  const container = document.createElement("div");
  container.innerHTML = markup;
  const title = container.querySelector<HTMLInputElement>('input[name="title"]');
  assert.equal(title?.maxLength, 256);
  assert.equal(container.querySelector("#task-title-count")?.textContent, "0/256");
  assert.ok(title?.getAttribute("aria-describedby")?.includes("task-title-count"));
});
