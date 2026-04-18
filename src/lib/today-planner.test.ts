import assert from "node:assert/strict";
import test from "node:test";

import { buildTodayPlanner } from "./today-planner";

test("builds derived today planner buckets from focus, due date, status, and timer signals", () => {
  const planner = buildTodayPlanner([
    {
      id: "planned-pinned",
      title: "Pinned plan",
      status: "todo",
      priority: "medium",
      focus_rank: 1,
      due_date: null,
      estimate_minutes: null,
      updated_at: "2026-04-18T08:00:00.000Z",
      projectName: "Alpha",
      goalTitle: null,
      trackedTodaySeconds: 0,
    },
    {
      id: "planned-due-today",
      title: "Due today",
      status: "todo",
      priority: "high",
      focus_rank: null,
      due_date: "2026-04-18",
      estimate_minutes: null,
      updated_at: "2026-04-18T07:00:00.000Z",
      projectName: "Alpha",
      goalTitle: null,
      trackedTodaySeconds: 0,
    },
    {
      id: "active-session",
      title: "Active task",
      status: "todo",
      priority: "medium",
      focus_rank: null,
      due_date: null,
      estimate_minutes: null,
      updated_at: "2026-04-18T09:00:00.000Z",
      projectName: "Alpha",
      goalTitle: null,
      hasActiveSession: true,
      trackedTodaySeconds: 1800,
    },
    {
      id: "blocked-task",
      title: "Blocked",
      status: "blocked",
      priority: "urgent",
      focus_rank: null,
      due_date: "2026-04-17",
      estimate_minutes: null,
      updated_at: "2026-04-18T06:00:00.000Z",
      projectName: "Alpha",
      goalTitle: null,
      trackedTodaySeconds: 0,
    },
    {
      id: "completed-today",
      title: "Done",
      status: "done",
      priority: "low",
      focus_rank: null,
      due_date: null,
      estimate_minutes: null,
      updated_at: "2026-04-18T10:00:00.000Z",
      projectName: "Alpha",
      goalTitle: null,
      completedToday: true,
    },
    {
      id: "not-today",
      title: "Later",
      status: "todo",
      priority: "low",
      focus_rank: null,
      due_date: "2026-04-25",
      estimate_minutes: null,
      updated_at: "2026-04-17T10:00:00.000Z",
      projectName: "Alpha",
      goalTitle: null,
      trackedTodaySeconds: 0,
    },
  ]);

  assert.deepEqual(planner.planned.map((task) => task.id), ["planned-pinned", "planned-due-today"]);
  assert.deepEqual(planner.inProgress.map((task) => task.id), ["active-session"]);
  assert.deepEqual(planner.blocked.map((task) => task.id), ["blocked-task"]);
  assert.deepEqual(planner.completed.map((task) => task.id), ["completed-today"]);
  assert.equal(planner.all.some((task) => task.id === "not-today"), false);
});

test("keeps explicitly in-progress tasks in progress even without active timer data", () => {
  const planner = buildTodayPlanner([
    {
      id: "in-progress",
      title: "Ship it",
      status: "in_progress",
      priority: "medium",
      focus_rank: null,
      due_date: null,
      estimate_minutes: null,
      updated_at: "2026-04-18T09:00:00.000Z",
      projectName: "Alpha",
      goalTitle: null,
      trackedTodaySeconds: 0,
    },
  ]);

  assert.deepEqual(planner.inProgress.map((task) => task.id), ["in-progress"]);
});
