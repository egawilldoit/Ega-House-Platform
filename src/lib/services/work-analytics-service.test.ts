import assert from "node:assert/strict";
import test from "node:test";

import { calculateWorkAnalytics } from "./work-analytics-service";

const window = {
  startIso: "2026-04-20T00:00:00.000Z",
  endIso: "2026-04-27T00:00:00.000Z",
};

test("returns zero totals for empty session list", () => {
  const result = calculateWorkAnalytics([], window);
  assert.deepEqual(result, {
    totalWorkedMinutes: 0,
    sessionCount: 0,
    completedTaskCount: undefined,
  });
});

test("aggregates completed sessions within window", () => {
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T10:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-1",
        title: "Task 1",
        // project and goal are optional for this test
      },
    },
    {
      task_id: "task-2",
      started_at: "2026-04-21T09:00:00.000Z",
      ended_at: "2026-04-21T09:30:00.000Z",
      duration_seconds: 1800, // 30 minutes
      tasks: {
        id: "task-2",
        title: "Task 2",
      },
    },
  ];

  const result = calculateWorkAnalytics(sessions, window);
  assert.deepEqual(result, {
    totalWorkedMinutes: 90, // 60 + 30
    sessionCount: 2,
    completedTaskCount: undefined,
  });
});

test("excludes sessions outside the window", () => {
  const sessions = [
    {
      task_id: "task-outside",
      started_at: "2026-04-19T23:00:00.000Z",
      ended_at: "2026-04-20T00:00:00.000Z", // exactly at start, but note: the function clips and requires >0
      duration_seconds: 3600,
      tasks: {
        id: "task-outside",
        title: "Outside",
      },
    },
    {
      task_id: "task-inside",
      started_at: "2026-04-20T01:00:00.000Z",
      ended_at: "2026-04-20T02:00:00.000Z",
      duration_seconds: 3600,
      tasks: {
        id: "task-inside",
        title: "Inside",
      },
    },
  ];

  const result = calculateWorkAnalytics(sessions, window);
  // The outside session touches the boundary but the overlap is 0? Let's see:
  // The window starts at 2026-04-20T00:00:00Z, the session ends at that time.
  // The function getSessionDurationWithinWindowSeconds returns 0 when overlapEnd <= overlapStart.
  // So the outside session contributes 0.
  assert.deepEqual(result, {
    totalWorkedMinutes: 60, // only the inside session
    sessionCount: 1,
    completedTaskCount: undefined,
  });
});

test("handles sessions with missing task title (uses fallback)", () => {
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T10:00:00.000Z",
      duration_seconds: 3600,
      tasks: {
        id: "task-1",
        // title is missing, should fall back to "Untitled task" in the underlying function? 
        // Actually, the underlying function uses task?.title ?? "Untitled task" for the label.
        // But for the analytics, we don't use the label, we only use the time.
        // So missing title doesn't affect the analytics.
      },
    },
  ];

  const result = calculateWorkAnalytics(sessions, window);
  assert.deepEqual(result, {
    totalWorkedMinutes: 60,
    sessionCount: 1,
    completedTaskCount: undefined,
  });
});

test("respects includeOpenSessions option", () => {
  const sessions = [
    {
      task_id: "open-task",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: null, // open session
      duration_seconds: null,
      tasks: {
        id: "open-task",
        title: "Open Task",
      },
    },
  ];

  // By default, includeOpenSessions is false -> should not count
  let result = calculateWorkAnalytics(sessions, window);
  assert.deepEqual(result, {
    totalWorkedMinutes: 0,
    sessionCount: 0,
    completedTaskCount: undefined,
  });

  // With includeOpenSessions: true -> should count the open session up to nowIso
  result = calculateWorkAnalytics(sessions, window, { includeOpenSessions: true, nowIso: "2026-04-20T10:00:00.000Z" });
  assert.deepEqual(result, {
    totalWorkedMinutes: 60, // 1 hour from 09:00 to 10:00
    sessionCount: 1,
    completedTaskCount: undefined,
  });
});

test("handles negative or zero duration seconds safely", () => {
  const sessions = [
    {
      task_id: "zero-duration",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T09:00:00.000Z",
      duration_seconds: 0,
      tasks: {
        id: "zero-duration",
        title: "Zero",
      },
    },
    {
      task_id: "negative-duration",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T08:00:00.000Z", // end before start
      duration_seconds: -3600,
      tasks: {
        id: "negative-duration",
        title: "Negative",
      },
    },
  ];

  const result = calculateWorkAnalytics(sessions, window);
  assert.deepEqual(result, {
    totalWorkedMinutes: 0,
    sessionCount: 0,
    completedTaskCount: undefined,
  });
});