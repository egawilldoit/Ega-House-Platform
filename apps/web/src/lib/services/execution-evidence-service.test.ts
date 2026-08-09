import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateExecutionEvidenceForWindow,
  getExecutionEvidenceSessionOverlapSeconds,
} from "./execution-evidence-service";

const window = {
  startIso: "2026-04-20T00:00:00.000Z",
  endIso: "2026-04-27T00:00:00.000Z",
};

test("clips sessions to the requested evidence window", () => {
  const seconds = getExecutionEvidenceSessionOverlapSeconds(
    {
      task_id: "task-1",
      started_at: "2026-04-19T23:30:00.000Z",
      ended_at: "2026-04-20T00:45:00.000Z",
      duration_seconds: null,
    },
    window,
    { nowIso: "2026-04-21T12:00:00.000Z" },
  );

  assert.equal(seconds, 2700);
});

test("does not count sessions that only touch a window boundary", () => {
  const summary = calculateExecutionEvidenceForWindow(
    [
      {
        task_id: "task-before",
        started_at: "2026-04-19T23:00:00.000Z",
        ended_at: "2026-04-20T00:00:00.000Z",
        duration_seconds: null,
      },
      {
        task_id: "task-after",
        started_at: "2026-04-27T00:00:00.000Z",
        ended_at: "2026-04-27T00:30:00.000Z",
        duration_seconds: null,
      },
    ],
    window,
    { nowIso: "2026-04-21T12:00:00.000Z" },
  );

  assert.equal(summary.totalTrackedSeconds, 0);
  assert.equal(summary.sessionCount, 0);
  assert.deepEqual(summary.taskTimeBuckets, []);
});

test("aggregates tracked seconds, buckets, touched projects, and touched goals", () => {
  const summary = calculateExecutionEvidenceForWindow(
    [
      {
        task_id: "task-1",
        started_at: "2026-04-20T09:00:00.000Z",
        ended_at: "2026-04-20T10:00:00.000Z",
        duration_seconds: 60,
        tasks: {
          id: "task-1",
          title: "Draft review",
          projects: { id: "project-1", name: "Ops" },
          goals: { id: "goal-1", title: "Tighter review loop" },
        },
      },
      {
        task_id: "task-1",
        started_at: "2026-04-21T09:00:00.000Z",
        ended_at: "2026-04-21T09:30:00.000Z",
        duration_seconds: 1800,
        tasks: {
          id: "task-1",
          title: "Draft review",
          projects: { id: "project-1", name: "Ops" },
          goals: { id: "goal-1", title: "Tighter review loop" },
        },
      },
      {
        task_id: "task-2",
        started_at: "2026-04-22T11:00:00.000Z",
        ended_at: "2026-04-22T11:15:00.000Z",
        duration_seconds: 900,
        tasks: {
          id: "task-2",
          title: "Clear queue",
          projects: { id: "project-2", name: "Inbox" },
          goals: null,
        },
      },
    ],
    window,
    { nowIso: "2026-04-22T12:00:00.000Z" },
  );

  assert.equal(summary.totalTrackedSeconds, 6300);
  assert.equal(summary.sessionCount, 3);
  assert.equal(summary.trackedSecondsByTask.get("task-1"), 5400);
  assert.equal(summary.trackedSecondsByTask.get("task-2"), 900);
  assert.deepEqual(summary.taskTimeBuckets, [
    {
      id: "task-1",
      label: "Draft review",
      trackedSeconds: 5400,
      sessionCount: 2,
    },
    {
      id: "task-2",
      label: "Clear queue",
      trackedSeconds: 900,
      sessionCount: 1,
    },
  ]);
  assert.deepEqual(summary.projectTimeBuckets, [
    {
      id: "project-1",
      label: "Ops",
      trackedSeconds: 5400,
      sessionCount: 2,
    },
    {
      id: "project-2",
      label: "Inbox",
      trackedSeconds: 900,
      sessionCount: 1,
    },
  ]);
  assert.deepEqual(summary.touchedProjectNames, ["Ops", "Inbox"]);
  assert.deepEqual(summary.touchedGoalTitles, ["Tighter review loop"]);
});

test("includes open sessions by default and can exclude them for completed-only evidence", () => {
  const session = {
    task_id: "task-open",
    started_at: "2026-04-22T11:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
    tasks: { title: "Active task" },
  };

  const included = calculateExecutionEvidenceForWindow([session], window, {
    nowIso: "2026-04-22T11:20:00.000Z",
  });
  const excluded = calculateExecutionEvidenceForWindow([session], window, {
    nowIso: "2026-04-22T11:20:00.000Z",
    includeOpenSessions: false,
  });

  assert.equal(included.totalTrackedSeconds, 1200);
  assert.equal(included.sessionCount, 1);
  assert.equal(excluded.totalTrackedSeconds, 0);
  assert.equal(excluded.sessionCount, 0);
});
