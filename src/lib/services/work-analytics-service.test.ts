import assert from "node:assert/strict";
import test from "node:test";

import { 
  calculateWorkAnalytics,
  calculateWorkAnalyticsDailySeries,
  calculateWorkAnalyticsProjectBreakdown,
} from "./work-analytics-service";

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

test("returns empty series for no sessions", () => {
  const result = calculateWorkAnalyticsDailySeries([], "2026-04-20", "2026-04-22");
  assert.deepEqual(result, [
    { date: "2026-04-20", workedMinutes: 0, sessionCount: 0, completedTaskCount: undefined },
    { date: "2026-04-21", workedMinutes: 0, sessionCount: 0, completedTaskCount: undefined },
    { date: "2026-04-22", workedMinutes: 0, sessionCount: 0, completedTaskCount: undefined },
  ]);
});

test("aggregates sessions within single day", () => {
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T10:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-1",
        title: "Task 1",
      },
    },
    {
      task_id: "task-2",
      started_at: "2026-04-20T14:00:00.000Z",
      ended_at: "2026-04-20T14:30:00.000Z",
      duration_seconds: 1800, // 30 minutes
      tasks: {
        id: "task-2",
        title: "Task 2",
      },
    },
  ];

  const result = calculateWorkAnalyticsDailySeries(sessions, "2026-04-20", "2026-04-20");
  assert.deepEqual(result, [
    { date: "2026-04-20", workedMinutes: 90, sessionCount: 2, completedTaskCount: undefined },
  ]);
});

test("distributes multi-day session across days", () => {
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-20T22:00:00.000Z", // 10 PM
      ended_at: "2026-04-21T02:00:00.000Z", // 2 AM next day (4 hours total)
      duration_seconds: 14400, // 4 hours
      tasks: {
        id: "task-1",
        title: "Overnight task",
      },
    },
  ];

  const result = calculateWorkAnalyticsDailySeries(sessions, "2026-04-20", "2026-04-21");
  // 2 hours on 20th (22:00-00:00), 2 hours on 21st (00:00-02:00)
  assert.deepEqual(result, [
    { date: "2026-04-20", workedMinutes: 120, sessionCount: 1, completedTaskCount: undefined },
    { date: "2026-04-21", workedMinutes: 120, sessionCount: 1, completedTaskCount: undefined },
  ]);
});

test("fills missing days with zero values", () => {
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T10:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-1",
        title: "Task 1",
      },
    },
    {
      task_id: "task-2",
      started_at: "2026-04-22T09:00:00.000Z",
      ended_at: "2026-04-22T10:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-2",
        title: "Task 2",
      },
    },
  ];

  const result = calculateWorkAnalyticsDailySeries(sessions, "2026-04-20", "2026-04-22");
  assert.deepEqual(result, [
    { date: "2026-04-20", workedMinutes: 60, sessionCount: 1, completedTaskCount: undefined },
    { date: "2026-04-21", workedMinutes: 0, sessionCount: 0, completedTaskCount: undefined },
    { date: "2026-04-22", workedMinutes: 60, sessionCount: 1, completedTaskCount: undefined },
  ]);
});

test("respects includeOpenSessions option for daily series", () => {
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
  let result = calculateWorkAnalyticsDailySeries(sessions, "2026-04-20", "2026-04-20");
  assert.deepEqual(result, [
    { date: "2026-04-20", workedMinutes: 0, sessionCount: 0, completedTaskCount: undefined },
  ]);

  // With includeOpenSessions: true -> should count the open session up to nowIso
  result = calculateWorkAnalyticsDailySeries(sessions, "2026-04-20", "2026-04-20", {
    includeOpenSessions: true,
    nowIso: "2026-04-20T10:00:00.000Z"
  });
  assert.deepEqual(result, [
    { date: "2026-04-20", workedMinutes: 60, sessionCount: 1, completedTaskCount: undefined },
  ]);
});

test("returns empty project breakdown for no sessions", () => {
  const result = calculateWorkAnalyticsProjectBreakdown([], {
    startIso: "2026-04-20T00:00:00.000Z",
    endIso: "2026-04-27T00:00:00.000Z"
  });
  assert.deepEqual(result, []);
});

test("groups sessions by project", () => {
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T10:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-1",
        title: "Task 1",
        projects: { id: "project-1", name: "Project Alpha" },
      },
    },
    {
      task_id: "task-2",
      started_at: "2026-04-20T10:00:00.000Z",
      ended_at: "2026-04-20T12:00:00.000Z",
      duration_seconds: 7200, // 2 hours
      tasks: {
        id: "task-2",
        title: "Task 2",
        projects: { id: "project-1", name: "Project Alpha" }, // Same project
      },
    },
    {
      task_id: "task-3",
      started_at: "2026-04-20T12:00:00.000Z",
      ended_at: "2026-04-20T13:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-3",
        title: "Task 3",
        projects: { id: "project-2", name: "Project Beta" },
      },
    },
  ];

  const result = calculateWorkAnalyticsProjectBreakdown(sessions, {
    startIso: "2026-04-20T00:00:00.000Z",
    endIso: "2026-04-21T00:00:00.000Z"
  });
  
  // Should have 2 projects: Project Alpha (3 hours), Project Beta (1 hour)
  // Sorted by worked minutes descending
  assert.deepEqual(result, [
    {
      projectId: "project-1",
      projectName: "Project Alpha",
      workedMinutes: 180, // 3 hours
      sessionCount: 2
    },
    {
      projectId: "project-2",
      projectName: "Project Beta",
      workedMinutes: 60, // 1 hour
      sessionCount: 1
    }
  ]);
});

test("handles unknown/missing projects", () => {
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T10:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-1",
        title: "Task 1",
        // No projects relation
      },
    },
    {
      task_id: "task-2",
      started_at: "2026-04-20T10:00:00.000Z",
      ended_at: "2026-04-20T11:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-2",
        title: "Task 2",
        projects: null, // Explicitly null
      },
    },
    {
      task_id: "task-3",
      started_at: "2026-04-20T11:00:00.000Z",
      ended_at: "2026-04-20T12:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-3",
        title: "Task 3",
        projects: { name: "Named Project" }, // Has name but no id
      },
    },
  ];

  const result = calculateWorkAnalyticsProjectBreakdown(sessions, {
    startIso: "2026-04-20T00:00:00.000Z",
    endIso: "2026-04-21T00:00:00.000Z"
  });
  
  // All should go to "Unknown project" bucket with 3 hours total and 3 sessions
  assert.deepEqual(result, [
    {
      projectId: null,
      projectName: "Unknown project",
      workedMinutes: 180, // 3 hours
      sessionCount: 3
    }
  ]);
});

test("sorts project breakdown correctly", () => {
  const sessions = [
    {
      task_id: "task-1",
      started_at: "2026-04-20T09:00:00.000Z",
      ended_at: "2026-04-20T10:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-1",
        title: "Task 1",
        projects: { id: "project-a", name: "AAA Project" },
      },
    },
    {
      task_id: "task-2",
      started_at: "2026-04-20T10:00:00.000Z",
      ended_at: "2026-04-20T11:00:00.000Z",
      duration_seconds: 3600, // 1 hour
      tasks: {
        id: "task-2",
        title: "Task 2",
        projects: { id: "project-b", name: "BBB Project" },
      },
    },
    {
      task_id: "task-3",
      started_at: "2026-04-20T11:00:00.000Z",
      ended_at: "2026-04-20T12:00:00.000Z",
      duration_seconds: 3600, // 1 hour (same as task-2)
      tasks: {
        id: "task-3",
        title: "Task 3",
        projects: { id: "project-c", name: "CCC Project" },
      },
    },
  ];

  const result = calculateWorkAnalyticsProjectBreakdown(sessions, {
    startIso: "2026-04-20T00:00:00.000Z",
    endIso: "2026-04-21T00:00:00.000Z"
  });
  
  // All projects have 60 minutes, should be sorted by name (AAA, BBB, CCC)
  assert.deepEqual(result, [
    {
      projectId: "project-a",
      projectName: "AAA Project",
      workedMinutes: 60,
      sessionCount: 1
    },
    {
      projectId: "project-b",
      projectName: "BBB Project",
      workedMinutes: 60,
      sessionCount: 1
    },
    {
      projectId: "project-c",
      projectName: "CCC Project",
      workedMinutes: 60,
      sessionCount: 1
    }
  ]);
});