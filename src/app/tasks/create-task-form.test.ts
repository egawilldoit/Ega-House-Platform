import assert from "node:assert/strict";
import test from "node:test";

import { buildCreateTaskFormInitialState } from "./create-task-form";

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
  assert.equal(
    state.initialState.values.returnTo,
    "/tasks?status=blocked&project=project-2&goal=goal-2&due=overdue&sort=due_date_desc&archive=all&layout=kanban",
  );
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
