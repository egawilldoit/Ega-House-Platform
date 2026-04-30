import assert from "node:assert/strict";
import test from "node:test";

import { buildTodayPlan } from "./today-plan-builder";
import type { NormalizedTaskRow } from "./task-read-service";

function createTaskRow(overrides: Partial<NormalizedTaskRow> = {}): NormalizedTaskRow {
  return {
    id: "task-1",
    title: "Task",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    estimate_minutes: null,
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
    ...overrides,
  };
}

const timerSummary = {
  trackedTodaySeconds: 0,
  trackedTodayLabel: "0m",
  trackedTotalSeconds: 0,
  trackedTotalLabel: "0m",
  sessionsTodayCount: 0,
  longestSessionSeconds: null,
  longestSessionLabel: null,
  longestSessionTaskTitle: null,
};

function createActiveTimer(taskId: string) {
  return {
    sessionId: "session-1",
    taskId,
    startedAt: "2026-04-20T09:00:00.000Z",
    elapsedLabel: "10m",
    taskTitle: "Active",
    taskStatus: "todo",
    taskPriority: "medium",
    projectName: "Project",
    projectSlug: "project",
    goalTitle: null,
  };
}

test("buildTodayPlan includes planned-today and due-today tasks in the selected Today set", () => {
  const plan = buildTodayPlan({
    today: "2026-04-20",
    selectedRows: [
      createTaskRow({ id: "planned", planned_for_date: "2026-04-20" }),
      createTaskRow({ id: "due", due_date: "2026-04-20" }),
    ],
    pinnedSuggestionRows: [],
    inProgressSuggestionRows: [],
    activeTimer: null,
    timerSummary,
  });

  assert.deepEqual(plan.planned.map((task) => task.id).sort(), ["due", "planned"]);
  assert.equal(plan.summary.selectedCount, 2);
});

test("buildTodayPlan deduplicates tasks that are both planned for Today and due Today", () => {
  const row = createTaskRow({
    id: "both",
    planned_for_date: "2026-04-20",
    due_date: "2026-04-20",
  });

  const plan = buildTodayPlan({
    today: "2026-04-20",
    selectedRows: [row, row],
    pinnedSuggestionRows: [],
    inProgressSuggestionRows: [],
    activeTimer: null,
    timerSummary,
  });

  assert.deepEqual(plan.planned.map((task) => task.id), ["both"]);
  assert.equal(plan.summary.selectedCount, 1);
});

test("buildTodayPlan groups selected tasks by status", () => {
  const plan = buildTodayPlan({
    today: "2026-04-20",
    selectedRows: [
      createTaskRow({ id: "todo", status: "todo", planned_for_date: "2026-04-20" }),
      createTaskRow({ id: "progress", status: "in_progress", planned_for_date: "2026-04-20" }),
      createTaskRow({ id: "blocked", status: "blocked", planned_for_date: "2026-04-20" }),
      createTaskRow({ id: "done", status: "done", planned_for_date: "2026-04-20" }),
      createTaskRow({ id: "completed", status: "completed", planned_for_date: "2026-04-20" }),
    ],
    pinnedSuggestionRows: [],
    inProgressSuggestionRows: [],
    activeTimer: null,
    timerSummary,
  });

  assert.deepEqual(plan.planned.map((task) => task.id), ["todo"]);
  assert.deepEqual(plan.inProgress.map((task) => task.id), ["progress"]);
  assert.deepEqual(plan.blocked.map((task) => task.id), ["blocked"]);
  assert.deepEqual(plan.completed.map((task) => task.id).sort(), ["completed", "done"]);
});

test("buildTodayPlan excludes Today-visible and completed tasks from suggestions", () => {
  const plan = buildTodayPlan({
    today: "2026-04-20",
    selectedRows: [
      createTaskRow({ id: "selected", planned_for_date: "2026-04-20" }),
    ],
    pinnedSuggestionRows: [
      createTaskRow({ id: "selected", focus_rank: 1 }),
      createTaskRow({ id: "pinned-completed", status: "done", focus_rank: 2 }),
      createTaskRow({ id: "pinned-extra", focus_rank: 3 }),
    ],
    inProgressSuggestionRows: [
      createTaskRow({ id: "selected", status: "in_progress" }),
      createTaskRow({ id: "progress-completed", status: "completed" }),
      createTaskRow({ id: "progress-extra", status: "in_progress" }),
    ],
    activeTimer: null,
    timerSummary,
  });

  assert.deepEqual(plan.suggestions.pinned.map((task) => task.id), ["pinned-extra"]);
  assert.deepEqual(plan.suggestions.inProgress.map((task) => task.id), ["progress-extra"]);
});

test("buildTodayPlan ranks the active timer task first in Today focus", () => {
  const plan = buildTodayPlan({
    today: "2026-04-20",
    selectedRows: [
      createTaskRow({
        id: "normal",
        planned_for_date: "2026-04-20",
        focus_rank: 1,
        updated_at: "2026-04-20T11:00:00.000Z",
      }),
      createTaskRow({
        id: "active",
        planned_for_date: "2026-04-20",
        focus_rank: 9,
        updated_at: "2026-04-20T09:00:00.000Z",
      }),
    ],
    pinnedSuggestionRows: [],
    inProgressSuggestionRows: [],
    activeTimer: createActiveTimer("active"),
    timerSummary,
  });

  assert.equal(plan.planned[0]?.id, "active");
  assert.equal(plan.startHere?.id, "active");
  assert.equal(plan.focusQueue[0]?.id, "active");
});

test("buildTodayPlan builds focusQueue from selected tasks and suggestions", () => {
  const plan = buildTodayPlan({
    today: "2026-04-20",
    selectedRows: [
      createTaskRow({ id: "selected-1", planned_for_date: "2026-04-20", focus_rank: 1 }),
      createTaskRow({ id: "selected-blocked", status: "blocked", planned_for_date: "2026-04-20", focus_rank: 2 }),
      createTaskRow({ id: "selected-done", status: "done", planned_for_date: "2026-04-20", focus_rank: 3 }),
    ],
    pinnedSuggestionRows: [
      createTaskRow({ id: "pinned-1", focus_rank: 4 }),
      createTaskRow({ id: "pinned-2", focus_rank: 5 }),
      createTaskRow({ id: "pinned-3", focus_rank: 6 }),
      createTaskRow({ id: "pinned-4", focus_rank: 7 }),
      createTaskRow({ id: "pinned-5", focus_rank: 8 }),
      createTaskRow({ id: "pinned-6", focus_rank: 9 }),
    ],
    inProgressSuggestionRows: [
      createTaskRow({ id: "progress-1", status: "in_progress", focus_rank: 10 }),
    ],
    activeTimer: null,
    timerSummary,
  });

  assert.deepEqual(plan.focusQueue.map((task) => task.id), [
    "selected-1",
    "pinned-1",
    "pinned-2",
    "pinned-3",
    "pinned-4",
    "pinned-5",
    "pinned-6",
  ]);
  assert.equal(plan.startHere?.id, "selected-1");
});

test("buildTodayPlan builds plannedToday from manually planned tasks ordered by recommendation ranking", () => {
  const plan = buildTodayPlan({
    today: "2026-04-20",
    selectedRows: [
      createTaskRow({ id: "due-only", due_date: "2026-04-20", priority: "urgent" }),
      createTaskRow({ id: "low-planned", planned_for_date: "2026-04-20", priority: "low", focus_rank: 1 }),
      createTaskRow({ id: "urgent-planned", planned_for_date: "2026-04-20", priority: "urgent", focus_rank: 9 }),
      createTaskRow({ id: "active-planned", planned_for_date: "2026-04-20", priority: "low", focus_rank: 9 }),
    ],
    pinnedSuggestionRows: [],
    inProgressSuggestionRows: [],
    activeTimer: createActiveTimer("active-planned"),
    timerSummary,
  });

  assert.deepEqual(plan.plannedToday.map((task) => task.id), [
    "active-planned",
    "urgent-planned",
    "low-planned",
  ]);
});

test("buildTodayPlan summary preserves Today counts and timer totals", () => {
  const plan = buildTodayPlan({
    today: "2026-04-20",
    selectedRows: [
      createTaskRow({
        id: "planned",
        status: "todo",
        planned_for_date: "2026-04-20",
        estimate_minutes: 30,
      }),
      createTaskRow({
        id: "progress",
        status: "in_progress",
        due_date: "2026-04-20",
        estimate_minutes: 20,
      }),
      createTaskRow({
        id: "blocked",
        status: "blocked",
        due_date: "2026-04-19",
        estimate_minutes: null,
      }),
      createTaskRow({
        id: "done-planned",
        status: "done",
        planned_for_date: "2026-04-20",
        estimate_minutes: 10,
      }),
      createTaskRow({
        id: "done-due",
        status: "done",
        due_date: "2026-04-20",
        estimate_minutes: 5,
      }),
    ],
    pinnedSuggestionRows: [],
    inProgressSuggestionRows: [],
    activeTimer: null,
    timerSummary: {
      ...timerSummary,
      trackedTodaySeconds: 3660,
      trackedTodayLabel: "1h 1m",
    },
  });

  assert.deepEqual(plan.summary, {
    plannedCount: 1,
    inProgressCount: 1,
    blockedCount: 1,
    completedCount: 2,
    selectedCount: 5,
    clearableCompletedCount: 1,
    overdueCount: 1,
    dueTodayCount: 1,
    totalEstimateMinutes: 65,
    trackedTodaySeconds: 3660,
    trackedTodayLabel: "1h 1m",
  });
});
