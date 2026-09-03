import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  INTERNAL_ERROR_RESPONSE,
  type CreateGoalResponse,
  type CreateProjectResponse,
  type MobileTodayResponse,
  type ProjectsReadModel,
  type GoalsReadModel,
  TASK_DUE_FILTER_VALUES,
  TASK_SORT_VALUES,
  isTaskDueFilter,
  isTaskSortValue,
  type MobileTaskCounters,
  type MobileTaskListItem,
  type MobileTaskListResponse,
} from "../src/index";

test("mobile task list query wire values remain stable", () => {
  assert.deepEqual(TASK_DUE_FILTER_VALUES, [
    "all",
    "overdue",
    "due_today",
    "due_soon",
    "no_due_date",
  ]);
  assert.deepEqual(TASK_SORT_VALUES, ["updated_desc", "due_date_asc", "due_date_desc"]);
  assert.equal(DEFAULT_TASK_DUE_FILTER, "all");
  assert.equal(DEFAULT_TASK_SORT, "updated_desc");
  assert.equal(isTaskDueFilter("due_today"), true);
  assert.equal(isTaskDueFilter("today"), false);
  assert.equal(isTaskSortValue("updated_desc"), true);
});

test("enriched mobile task list item exposes canonical project and goal projections", () => {
  const item: MobileTaskListItem = {
    id: "task-1",
    title: "Ship enrichment",
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "urgent",
    dueDate: "2026-08-22",
    estimateMinutes: 30,
    updatedAt: "2026-08-22T00:00:00.000Z",
    focusRank: null,
    trackedDurationSeconds: 0,
    project: { id: "project-1", name: "Launch", slug: "launch" },
    goal: { id: "goal-1", title: "Ship v1" },
    reminders: [],
    recurrence: null,
  };

  assert.deepEqual(Object.keys(item.project).sort(), ["id", "name", "slug"]);
  assert.equal(item.project.slug, "launch");
  assert.deepEqual(item.goal, { id: "goal-1", title: "Ship v1" });
});

test("enriched mobile task counters include per-priority counts over the filtered scope", () => {
  const counters: MobileTaskCounters = {
    total: 3,
    byStatus: { todo: 2, in_progress: 1, done: 0, blocked: 0 },
    byPriority: { low: 0, medium: 1, high: 1, urgent: 1 },
    pinned: 1,
    overdue: 1,
    dueToday: 2,
  };

  assert.equal(counters.total, counters.byStatus.todo + counters.byStatus.in_progress + counters.byStatus.done + counters.byStatus.blocked);
  assert.deepEqual(Object.keys(counters.byPriority), ["low", "medium", "high", "urgent"]);
});

test("mobile task list response carries enriched filters echo including priority", () => {
  const response: MobileTaskListResponse = {
    ok: true,
    tasks: [],
    counters: {
      total: 0,
      byStatus: { todo: 0, in_progress: 0, done: 0, blocked: 0 },
      byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
      pinned: 0,
      overdue: 0,
      dueToday: 0,
    },
    filters: {
      status: null,
      projectId: null,
      goalId: null,
      priority: "urgent",
      due: "all",
      sort: "updated_desc",
      limit: null,
    },
    projects: [{ id: "project-1", name: "Launch", slug: "launch" }],
    goals: [],
  };

  assert.equal(response.ok, true);
  assert.equal(response.filters.priority, "urgent");
});

test("agent internal error wire response remains stable", () => {
  assert.deepEqual(INTERNAL_ERROR_RESPONSE, {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
    },
  });
});

test("project and goal response DTOs describe the existing transport envelopes", () => {
  const projectResponse: CreateProjectResponse = {
    ok: true,
    values: { name: "Launch", slug: "launch", description: "" },
  };
  const projects: ProjectsReadModel = {
    projects: [],
    summary: { total: 0, active: 0, completed: 0, archived: 0 },
  };
  const goalResponse: CreateGoalResponse = {
    ok: true,
    values: {
      title: "Ship beta",
      projectId: "project-1",
      description: "",
      nextStep: "",
      health: "on_track",
      status: "active",
      slug: "ship-beta",
    },
  };
  const goals: GoalsReadModel = {
    projects: [],
    goals: [],
    summary: { total: 0, active: 0, completed: 0, archived: 0 },
  };

  assert.equal(projectResponse.ok, true);
  assert.equal(projects.summary.total, 0);
  assert.equal(goalResponse.values.status, "active");
  assert.equal(goals.summary.total, 0);
});

test("Today response uses the complete Operator snapshot contract", () => {
  const today: MobileTodayResponse = {
    ok: true,
    date: "2026-09-03",
    timezone: "UTC",
    timeContextId: "context-1",
    dayWindow: {
      startUtcIso: "2026-09-03T00:00:00.000Z",
      endUtcIso: "2026-09-04T00:00:00.000Z",
    },
    plannedToday: [],
    sections: { planned: [], inProgress: [], blocked: [], completed: [] },
    focus: { startHere: null, queue: [] },
    schedule: { blocks: [], flexible: [] },
    suggestions: { pinned: [], inProgress: [] },
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
    signals: { health: null, friction: null, inbox: null, weeklyObjective: null },
  };

  assert.equal(today.timezone, "UTC");
  assert.equal(today.timeContextId, "context-1");
  assert.deepEqual(today.focus.queue, []);
  assert.deepEqual(today.signals, {
    health: null,
    friction: null,
    inbox: null,
    weeklyObjective: null,
  });
});
