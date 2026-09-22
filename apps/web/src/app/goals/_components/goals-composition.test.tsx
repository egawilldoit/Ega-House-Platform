import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GoalsPageView } from "./GoalsPageView";
import type { GoalsPageModel } from "../_lib/goals-page-model";

const focusedGoal = {
  id: "goal-1",
  title: "Ship the light workspace",
  description: "Replace the editorial surface with the workspace system.",
  nextStep: "Migrate the projects directory.",
  health: "on_track" as const,
  status: "active",
  updatedAt: "2026-09-20T10:00:00.000Z",
  projectName: "EGA House",
  linkedTasks: [
    { id: "task-1", title: "Recompose goals route", status: "in_progress", goalId: "goal-1" },
    { id: "task-2", title: "Recompose projects route", status: "done", goalId: "goal-1" },
  ],
  progressPercent: 50,
};

const model = {
  activeView: "active",
  projects: [{ id: "project-1", name: "EGA House" }],
  goals: [
    focusedGoal,
    {
      id: "goal-2",
      title: "Retire the editorial shell",
      description: null,
      nextStep: null,
      health: "at_risk" as const,
      status: "active",
      updatedAt: "2026-09-19T10:00:00.000Z",
      projectName: null,
      linkedTasks: [],
      progressPercent: 0,
    },
  ],
  summary: { total: 3, active: 2, completed: 1, archived: 1 },
  focusedGoal,
  goalUpdateError: null,
  goalUpdateGoalId: null,
  goalUpdateField: null,
} as unknown as GoalsPageModel;

test("GoalsPageView renders the summary strip, directory, and selected goal detail", () => {
  const markup = renderToStaticMarkup(<GoalsPageView model={model} />);

  assert.match(markup, /Active goals/);
  assert.match(markup, /At health risk/);
  assert.match(markup, /Completed/);
  assert.match(markup, /Overall progress/);
  assert.match(markup, /50%/);

  assert.match(markup, /Ship the light workspace/);
  assert.match(markup, /Retire the editorial shell/);
  assert.match(markup, /aria-current="true"/);
  assert.match(markup, /id="goal-goal-1"/);
  assert.match(markup, /href="\/goals\?view=active&amp;goal=goal-2"/);
});

test("GoalsPageView keeps linked task navigation and the create goal form wired", () => {
  const markup = renderToStaticMarkup(<GoalsPageView model={model} />);

  assert.match(markup, /href="\/tasks\?goal=goal-1#task-task-1"/);
  assert.match(markup, /name="goalId"/);
  assert.match(markup, /name="returnTo"/);
  assert.match(markup, /name="title"/);
  assert.match(markup, /name="projectId"/);
  assert.match(markup, /name="next_step"/);
  assert.match(markup, /Create goal/);
});

test("GoalsPageView keeps goal editing behind keyboard-reachable disclosures", () => {
  const markup = renderToStaticMarkup(<GoalsPageView model={model} />);

  assert.match(markup, /Health: On Track/);
  assert.match(markup, /Status: Active/);
  assert.match(markup, /Next step: set/);
  assert.match(markup, /Archive goal/);
  assert.match(markup, /<details/);
  assert.doesNotMatch(
    markup,
    /<details[^>]*\sopen/,
    "Editing disclosures stay closed until the user opens them",
  );
});

test("GoalsPageView renders an empty directory when the view has no goals", () => {
  const emptyModel = {
    ...model,
    goals: [],
    focusedGoal: null,
    summary: { total: 2, active: 0, completed: 1, archived: 1 },
  } as unknown as GoalsPageModel;

  const markup = renderToStaticMarkup(<GoalsPageView model={emptyModel} />);

  assert.match(markup, /No goals in this view/);
  assert.match(markup, /Archived or All/);
  assert.match(markup, /Create goal/);
  assert.doesNotMatch(markup, /aria-current="true"/);
});
