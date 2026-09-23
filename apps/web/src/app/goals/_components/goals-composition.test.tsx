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

test("GoalsPageView renders truthful summary labels, directory, and selected goal detail", () => {
  const markup = renderToStaticMarkup(<GoalsPageView model={model} />);

  // Workspace-wide status counts, the non-archived "Current" count, the
  // view-scoped health count, and linked-task completion — each label matches
  // what the read model actually counts.
  assert.match(markup, /Current goals/);
  assert.match(markup, /Active status/);
  assert.match(markup, /Archived/);
  assert.match(markup, /At health risk/);
  assert.match(markup, /Linked task completion/);
  assert.match(markup, /50%/);
  assert.doesNotMatch(markup, /Active goals/);
  assert.doesNotMatch(markup, /Overall progress/);
  assert.doesNotMatch(markup, /Completed/);

  assert.match(markup, /Ship the light workspace/);
  assert.match(markup, /Retire the editorial shell/);
  assert.match(markup, /aria-current="true"/);
  assert.match(markup, /id="goal-goal-1"/);
  assert.match(markup, /href="\/goals\?view=active&amp;goal=goal-2"/);
});

test("GoalsPageView keeps linked task navigation and the create goal form wired behind a disclosure", () => {
  const markup = renderToStaticMarkup(<GoalsPageView model={model} />);

  assert.match(markup, /href="\/tasks\?goal=goal-1#task-task-1"/);
  assert.match(markup, /name="goalId"/);
  assert.match(markup, /name="returnTo"/);
  assert.match(markup, /name="title"/);
  assert.match(markup, /name="projectId"/);
  assert.match(markup, /name="next_step"/);
  assert.match(markup, /Create goal/);
  // The create form is revealed by a control, not always open.
  assert.match(markup, /New goal/);
  assert.match(markup, /<summary[^>]*>[\s\S]*New goal/);
});

test("GoalsPageView keeps goal editing behind one primary Edit goal disclosure", () => {
  const markup = renderToStaticMarkup(<GoalsPageView model={model} />);

  assert.match(markup, /Edit goal/);
  assert.match(markup, /name="health"/);
  assert.match(markup, /name="status"/);
  assert.match(markup, /name="next_step"/);
  assert.match(markup, /Archive goal/);
  assert.match(markup, /<details/);
  assert.doesNotMatch(
    markup,
    /<details[^>]*\sopen/,
    "Editing disclosures stay closed until the user opens them",
  );
});

test("GoalsPageView reopens the edit disclosure when a mutation fails", () => {
  const erroredModel = {
    ...model,
    goalUpdateError: "Could not save goal",
    goalUpdateGoalId: "goal-1",
    goalUpdateField: "health",
  } as unknown as GoalsPageModel;

  const markup = renderToStaticMarkup(<GoalsPageView model={erroredModel} />);

  assert.match(markup, /<details[^>]*\sopen/);
  assert.match(markup, /Could not save goal/);
});

test("GoalsPageView reopens the archive disclosure when the archive mutation fails", () => {
  const erroredModel = {
    ...model,
    goalUpdateError: "Could not archive goal",
    goalUpdateGoalId: "goal-1",
    goalUpdateField: "archive",
  } as unknown as GoalsPageModel;

  const markup = renderToStaticMarkup(<GoalsPageView model={erroredModel} />);

  assert.match(markup, /<details[^>]*\sopen/);
  assert.match(markup, /Could not archive goal/);
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
