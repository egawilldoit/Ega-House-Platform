import assert from "node:assert/strict";
import test from "node:test";

import { buildMostTrackedInsights } from "./review-most-tracked";

test("aggregates tracked rankings across tasks, projects, and goals inside the selected window", () => {
  const insights = buildMostTrackedInsights(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-14T09:00:00.000Z",
        ended_at: "2026-04-14T10:00:00.000Z",
        duration_seconds: null,
        tasks: {
          id: "task-1",
          title: "Ship review insights",
          projects: { id: "project-1", name: "EGA House", slug: "ega-house" },
          goals: { id: "goal-1", title: "Tighten weekly reviews" },
        },
      },
      {
        task_id: "task-1",
        started_at: "2026-04-15T09:00:00.000Z",
        ended_at: "2026-04-15T09:30:00.000Z",
        duration_seconds: 1800,
        tasks: {
          id: "task-1",
          title: "Ship review insights",
          projects: { id: "project-1", name: "EGA House", slug: "ega-house" },
          goals: { id: "goal-1", title: "Tighten weekly reviews" },
        },
      },
      {
        task_id: "task-2",
        started_at: "2026-04-15T11:00:00.000Z",
        ended_at: "2026-04-15T12:00:00.000Z",
        duration_seconds: null,
        tasks: {
          id: "task-2",
          title: "Refine task forms",
          projects: { id: "project-1", name: "EGA House", slug: "ega-house" },
          goals: null,
        },
      },
      {
        task_id: "task-3",
        started_at: "2026-04-12T23:30:00.000Z",
        ended_at: "2026-04-13T00:30:00.000Z",
        duration_seconds: null,
        tasks: {
          id: "task-3",
          title: "Boundary session",
          projects: { id: "project-2", name: "Ops", slug: "ops" },
          goals: { id: "goal-2", title: "Keep cadence" },
        },
      },
    ],
    {
      startIso: "2026-04-13T00:00:00.000Z",
      endIso: "2026-04-20T00:00:00.000Z",
    },
    "2026-04-20T00:00:00.000Z",
  );

  assert.deepEqual(insights.tasks.map((entry) => [entry.label, entry.trackedSeconds]), [
    ["Ship review insights", 5400],
    ["Refine task forms", 3600],
    ["Boundary session", 1800],
  ]);
  assert.equal(insights.tasks[0]?.href, "/tasks/projects/ega-house#task-task-1");
  assert.equal(insights.tasks[0]?.detail, "EGA House • Tighten weekly reviews");

  assert.deepEqual(insights.projects.map((entry) => [entry.label, entry.trackedSeconds]), [
    ["EGA House", 9000],
    ["Ops", 1800],
  ]);
  assert.equal(insights.projects[0]?.href, "/tasks/projects/ega-house");

  assert.deepEqual(insights.goals.map((entry) => [entry.label, entry.trackedSeconds]), [
    ["Tighten weekly reviews", 5400],
    ["Keep cadence", 1800],
  ]);
  assert.equal(insights.goals[0]?.href, "/goals?view=all&goal=goal-1#goal-goal-1");
});

test("ignores zero-overlap sessions and rows without linked task metadata", () => {
  const insights = buildMostTrackedInsights(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-10T09:00:00.000Z",
        ended_at: "2026-04-10T10:00:00.000Z",
        duration_seconds: null,
        tasks: {
          id: "task-1",
          title: "Old work",
          projects: { id: "project-1", name: "Archive", slug: "archive" },
          goals: null,
        },
      },
      {
        task_id: "task-2",
        started_at: "2026-04-14T09:00:00.000Z",
        ended_at: "2026-04-14T09:30:00.000Z",
        duration_seconds: null,
        tasks: null,
      },
    ],
    {
      startIso: "2026-04-13T00:00:00.000Z",
      endIso: "2026-04-20T00:00:00.000Z",
    },
  );

  assert.deepEqual(insights, {
    tasks: [],
    projects: [],
    goals: [],
  });
});
