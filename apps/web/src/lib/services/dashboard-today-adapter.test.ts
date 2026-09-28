import assert from "node:assert/strict";
import test from "node:test";

import { getDashboardTodayPlannerData, mapTodayPlannerDataToDashboardPlanner } from "./dashboard-today-adapter";
import type { TodayPlannerData, TodayPlannerTask } from "./today-planner-service";

function createPlannerTask(overrides: Partial<TodayPlannerTask> = {}): TodayPlannerTask {
  return {
    id: "task-1",
    title: "Task",
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    focusRank: null,
    plannedForDate: "2026-04-20",
    updatedAt: "2026-04-20T10:00:00.000Z",
    completedAt: null,
    projectName: "Project",
    projectSlug: "project",
    goalTitle: null,
    hasActiveTimer: false,
    isDueToday: false,
    isPlannedForToday: true,
    dueBucket: "none",
    ...overrides,
  };
}

function createPlannerData(overrides: Partial<TodayPlannerData> = {}): TodayPlannerData {
  return {
    date: "2026-04-20",
    startHere: null,
    focusQueue: [],
    plannedToday: [],
    scheduledBlocks: [],
    flexibleTasks: [],
    planned: [],
    inProgress: [],
    blocked: [],
    completed: [],
    suggestions: {
      pinned: [],
      inProgress: [],
    },
    summary: {
      plannedCount: 0,
      inProgressCount: 0,
      blockedCount: 0,
      completedCount: 0,
      selectedCount: 0,
      clearableCompletedCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      totalEstimateMinutes: 0,
      trackedTodaySeconds: 0,
      trackedTodayLabel: "0m",
    },
    activeTimer: null,
    ...overrides,
  };
}

test("maps canonical Today planner buckets into the dashboard Today planner shape", () => {
  const planned = createPlannerTask({
    id: "planned",
    blockedReason: "Waiting",
    focusRank: 2,
    dueDate: "2026-04-20",
    estimateMinutes: 45,
    goalTitle: "Goal",
  });
  const inProgress = createPlannerTask({ id: "progress", status: "in_progress" });
  const blocked = createPlannerTask({ id: "blocked", status: "blocked" });
  const completed = createPlannerTask({
    id: "done",
    status: "done",
    completedAt: "2026-04-20T12:00:00.000Z",
  });

  const dashboardPlanner = mapTodayPlannerDataToDashboardPlanner(
    createPlannerData({
      planned: [planned],
      inProgress: [inProgress],
      blocked: [blocked],
      completed: [completed],
    }),
  );

  assert.deepEqual(dashboardPlanner.planned, [
    {
      id: "planned",
      title: "Task",
      blockedReason: "Waiting",
      status: "todo",
      priority: "medium",
      focusRank: 2,
      dueDate: "2026-04-20",
      estimateMinutes: 45,
      updatedAt: "2026-04-20T10:00:00.000Z",
      completedAt: null,
      projectName: "Project",
      goalTitle: "Goal",
    },
  ]);
  assert.deepEqual(dashboardPlanner.all.map((task) => task.id), [
    "progress",
    "blocked",
    "planned",
    "done",
  ]);
  assert.deepEqual(dashboardPlanner.plannedToday, []);
  assert.deepEqual(dashboardPlanner.focusQueue, []);
  assert.equal(dashboardPlanner.activeTimer, null);
  assert.equal(dashboardPlanner.summary.selectedCount, 0);
  assert.deepEqual(dashboardPlanner.suggestions, { pinned: [], inProgress: [] });
});

test("preserves canonical activeTimer, focusQueue, plannedToday, summary, and suggestions", () => {
  const focusTask = createPlannerTask({ id: "focus", focusRank: 1 });
  const plannedTodayTask = createPlannerTask({ id: "planned-today", plannedForDate: "2026-04-20" });
  const pinnedSuggestion = createPlannerTask({
    id: "pinned-suggestion",
    focusRank: 2,
    plannedForDate: null,
    isPlannedForToday: false,
  });
  const inProgressSuggestion = createPlannerTask({
    id: "progress-suggestion",
    status: "in_progress",
    plannedForDate: null,
    isPlannedForToday: false,
  });
  const activeTimer = {
    sessionId: "session-1",
    taskId: "focus",
    startedAt: "2026-04-20T09:00:00.000Z",
    elapsedLabel: "1h 0m",
    taskTitle: "Focus",
    taskStatus: "todo",
    taskPriority: "high",
    projectName: "Project",
    projectSlug: "project",
    goalTitle: null,
  };
  const summary = {
    plannedCount: 1,
    inProgressCount: 2,
    blockedCount: 3,
    completedCount: 4,
    selectedCount: 5,
    clearableCompletedCount: 6,
    overdueCount: 7,
    dueTodayCount: 8,
    totalEstimateMinutes: 90,
    trackedTodaySeconds: 3600,
    trackedTodayLabel: "1h",
  };

  const dashboardPlanner = mapTodayPlannerDataToDashboardPlanner(
    createPlannerData({
      activeTimer,
      focusQueue: [focusTask],
      plannedToday: [plannedTodayTask],
      suggestions: {
        pinned: [pinnedSuggestion],
        inProgress: [inProgressSuggestion],
      },
      summary,
    }),
  );

  assert.deepEqual(dashboardPlanner.activeTimer, activeTimer);
  assert.deepEqual(dashboardPlanner.focusQueue.map((task) => task.id), ["focus"]);
  assert.deepEqual(dashboardPlanner.plannedToday.map((task) => task.id), ["planned-today"]);
  assert.deepEqual(dashboardPlanner.suggestions.pinned.map((task) => task.id), [
    "pinned-suggestion",
  ]);
  assert.deepEqual(dashboardPlanner.suggestions.inProgress.map((task) => task.id), [
    "progress-suggestion",
  ]);
  assert.deepEqual(dashboardPlanner.summary, summary);
});

test("adds dashboard-visible pinned, active, tracked, overdue, and completed-today tasks to all", () => {
  const canonicalPlanned = createPlannerTask({
    id: "planned",
    plannedForDate: "2026-04-20",
    isPlannedForToday: true,
  });
  const active = createPlannerTask({
    id: "active",
    hasActiveTimer: true,
    plannedForDate: null,
    isPlannedForToday: false,
  });
  const pinned = createPlannerTask({
    id: "pinned",
    focusRank: 1,
    plannedForDate: null,
    isPlannedForToday: false,
  });
  const overdue = createPlannerTask({
    id: "overdue",
    dueDate: "2026-04-19",
    dueBucket: "overdue",
    plannedForDate: null,
    isPlannedForToday: false,
  });
  const tracked = createPlannerTask({
    id: "tracked",
    plannedForDate: null,
    isPlannedForToday: false,
  });
  const completedToday = createPlannerTask({
    id: "completed-today",
    status: "done",
    completedAt: "2026-04-20T12:00:00.000Z",
    plannedForDate: null,
    isPlannedForToday: false,
  });
  const future = createPlannerTask({
    id: "future",
    dueDate: "2026-04-25",
    dueBucket: "scheduled",
    plannedForDate: null,
    isPlannedForToday: false,
  });

  const dashboardPlanner = mapTodayPlannerDataToDashboardPlanner(
    createPlannerData({
      planned: [canonicalPlanned],
    }),
    [active, pinned, overdue, tracked, completedToday, future],
    {
      trackedTodaySecondsByTask: new Map([["tracked", 1800]]),
    },
  );

  assert.deepEqual(dashboardPlanner.all.map((task) => task.id), [
    "active",
    "planned",
    "pinned",
    "overdue",
    "tracked",
    "completed-today",
  ]);
});

test("dedupes dashboard all with stable precedence", () => {
  const sameTaskPlanned = createPlannerTask({
    id: "same",
    plannedForDate: "2026-04-20",
    isPlannedForToday: true,
    updatedAt: "2026-04-20T10:00:00.000Z",
  });
  const sameTaskActive = createPlannerTask({
    id: "same",
    hasActiveTimer: true,
    plannedForDate: null,
    isPlannedForToday: false,
    updatedAt: "2026-04-20T11:00:00.000Z",
  });

  const dashboardPlanner = mapTodayPlannerDataToDashboardPlanner(
    createPlannerData({
      planned: [sameTaskPlanned],
    }),
    [sameTaskActive],
  );

  assert.deepEqual(dashboardPlanner.all.map((task) => task.id), ["same"]);
  assert.equal(dashboardPlanner.all[0]?.updatedAt, sameTaskActive.updatedAt);
});

test("ega-661: getDashboardTodayPlannerData uses the account local date for supplemental due-today tasks", async () => {
  const supplementalRow = {
    id: "supplemental-due",
    title: "Supplemental due task",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "medium",
    due_date: "2026-04-21",
    estimate_minutes: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    updated_at: "2026-04-20T10:00:00.000Z",
    completed_at: null,
    project_id: "project-1",
    goal_id: null,
    focus_rank: null,
    planned_for_date: null,
    archived_at: null,
    archived_by: null,
    projects: { name: "Project", slug: "project" },
    goals: null,
  };

  const taskResults = [
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: [supplementalRow], error: null },
  ];
  let taskQueryIndex = 0;
  const sessionResults = [
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  ];
  let sessionQueryIndex = 0;

  const supabase = {
    from(table: string) {
      if (table === "tasks") {
        return {
          select() {
            const chain = {
              or() {
                return chain;
              },
              not() {
                return chain;
              },
              neq() {
                return chain;
              },
              eq() {
                return chain;
              },
              is() {
                return chain;
              },
              order() {
                return chain;
              },
              limit() {
                const result = taskResults[taskQueryIndex];
                taskQueryIndex += 1;
                assert.ok(result, "Unexpected task query invocation.");
                return Promise.resolve(result);
              },
              maybeSingle() {
                return Promise.resolve({ data: null, error: null });
              },
            };
            return chain;
          },
        };
      }

      if (table === "task_sessions") {
        return {
          select() {
            const chain = {
              or() {
                const result = sessionResults[sessionQueryIndex];
                sessionQueryIndex += 1;
                assert.ok(result, "Unexpected task_sessions query invocation.");
                return Promise.resolve(result);
              },
              is() {
                return chain;
              },
              lt() {
                return chain;
              },
              order() {
                return chain;
              },
              limit() {
                const result = sessionResults[sessionQueryIndex];
                sessionQueryIndex += 1;
                assert.ok(result, "Unexpected task_sessions query invocation.");
                return Promise.resolve(result);
              },
            };
            return chain;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const result = await getDashboardTodayPlannerData({
    supabase: supabase as never,
    now: new Date("2026-04-20T05:00:00.000Z"),
    localDate: "2026-04-21",
  });

  assert.equal(result.errorMessage, null);
  assert.equal(result.data?.date, "2026-04-21");
  assert.deepEqual(
    result.data?.all.map((task) => task.id),
    ["supplemental-due"],
  );
  assert.equal(taskQueryIndex, 4);
  assert.equal(sessionQueryIndex, 3);
});
