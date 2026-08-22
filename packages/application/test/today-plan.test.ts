import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTodayPlan,
  createAuthenticatedActor,
  getTodayPlan,
  type AuthenticatedActor,
  type RepositoryResult,
  type TodayReadPort,
  type TodaySourceTask,
} from "../src/index";

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value };
}

function task(overrides: Partial<TodaySourceTask> & { id: string }): TodaySourceTask {
  return {
    title: `Task ${overrides.id}`,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    focusRank: null,
    plannedForDate: "2026-08-10",
    updatedAt: "2026-08-10T08:00:00.000Z",
    completedAt: null,
    projectName: "Apollo",
    projectSlug: "apollo",
    goalTitle: null,
    ...overrides,
  };
}

const TODAY = "2026-08-10";

const SELECTED: TodaySourceTask[] = [
  task({ id: "planned-1", plannedForDate: TODAY }),
  task({
    id: "inprogress-1",
    status: "in_progress",
    focusRank: 2,
    plannedForDate: TODAY,
    updatedAt: "2026-08-10T09:00:00.000Z",
  }),
  task({
    id: "blocked-1",
    status: "blocked",
    blockedReason: "Waiting on API",
    plannedForDate: TODAY,
    updatedAt: "2026-08-10T07:00:00.000Z",
  }),
  task({
    id: "completed-1",
    status: "done",
    completedAt: "2026-08-10T06:00:00.000Z",
    plannedForDate: TODAY,
    estimateMinutes: 30,
  }),
  task({ id: "overdue-1", dueDate: "2026-08-01", estimateMinutes: 15 }),
];

class FakeTodayPort implements TodayReadPort {
  actorIds: string[] = [];

  constructor(
    private readonly selected: TodaySourceTask[],
    private readonly pinned: TodaySourceTask[] = [],
    private readonly inProgress: TodaySourceTask[] = [],
    private readonly snapshot: { activeTimer: { sessionId: string; taskId: string } | null; trackedTodaySeconds: number } = {
      activeTimer: null,
      trackedTodaySeconds: 0,
    },
  ) {}

  async listSelectedTasks(actor: AuthenticatedActor) {
    this.actorIds.push(actor.userId);
    return ok(this.selected);
  }

  async listPinnedSuggestions(actor: AuthenticatedActor) {
    this.actorIds.push(actor.userId);
    return ok(this.pinned);
  }

  async listInProgressSuggestions(actor: AuthenticatedActor) {
    this.actorIds.push(actor.userId);
    return ok(this.inProgress);
  }

  async getTodayTimerSnapshot(actor: AuthenticatedActor) {
    this.actorIds.push(actor.userId);
    return ok(this.snapshot);
  }
}

test("Today plan sections, suggestions, summary, and active timer match the mobile contract", async () => {
  const pinnedSuggestion = task({ id: "pinned-sug", focusRank: 1 });
  const inProgressSuggestion = task({ id: "inprog-sug", status: "in_progress" });
  const port = new FakeTodayPort(SELECTED, [pinnedSuggestion], [inProgressSuggestion], {
    activeTimer: { sessionId: "session-1", taskId: "inprogress-1" },
    trackedTodaySeconds: 1500,
  });

  const result = await getTodayPlan(createAuthenticatedActor("user-today"), port, {
    date: TODAY,
    now: new Date("2026-08-10T12:00:00"),
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const plan = result.data;

  assert.deepEqual(
    plan.sections.planned.map((item) => item.id),
    ["planned-1", "overdue-1"],
  );
  assert.deepEqual(plan.sections.inProgress.map((item) => item.id), ["inprogress-1"]);
  assert.deepEqual(plan.sections.blocked.map((item) => item.id), ["blocked-1"]);
  assert.deepEqual(plan.sections.completed.map((item) => item.id), ["completed-1"]);

  assert.equal(plan.sections.inProgress[0].hasActiveTimer, true);
  assert.equal(plan.sections.completed[0].projectName, "Apollo");
  assert.equal(plan.sections.blocked[0].blockedReason, "Waiting on API");
  assert.equal(plan.sections.planned[0].dueBucket, "none");

  assert.deepEqual(
    plan.suggestions.pinned.map((item) => item.id),
    ["pinned-sug"],
  );
  assert.deepEqual(plan.suggestions.inProgress.map((item) => item.id), ["inprog-sug"]);

  assert.deepEqual(plan.activeTimer, { sessionId: "session-1", taskId: "inprogress-1" });

  assert.deepEqual(plan.summary, {
    plannedCount: 2,
    inProgressCount: 1,
    blockedCount: 1,
    completedCount: 1,
    selectedCount: 5,
    clearableCompletedCount: 1,
    overdueCount: 1,
    dueTodayCount: 0,
    totalEstimateMinutes: 45,
    trackedTodaySeconds: 1500,
    trackedTodayLabel: "25m 0s",
  });

  assert.deepEqual(port.actorIds, ["user-today", "user-today", "user-today", "user-today"]);
});

test("buildTodayPlan excludes selected and completed tasks from suggestions and caps suggestion size", () => {
  const pinnedRows = [
    task({ id: "sug-1", focusRank: 1 }),
    task({ id: "selected-dup", focusRank: 2 }),
    task({ id: "done-sug", focusRank: 3, status: "done" }),
    ...Array.from({ length: 8 }, (_, index) =>
      task({ id: `filler-${index}`, focusRank: 10 + index }),
    ),
  ];

  const plan = buildTodayPlan({
    today: TODAY,
    selectedRows: [task({ id: "selected-dup" })],
    pinnedRows,
    inProgressRows: [],
    activeTimer: { sessionId: "s", taskId: "selected-dup" },
    trackedTodaySeconds: 0,
  });

  assert.equal(plan.suggestions.pinned.length, 6);
  assert.ok(!plan.suggestions.pinned.some((item) => item.id === "selected-dup"));
  assert.ok(!plan.suggestions.pinned.some((item) => item.id === "done-sug"));
  assert.deepEqual(plan.suggestions.pinned.map((item) => item.id).slice(0, 3), [
    "sug-1",
    "filler-0",
    "filler-1",
  ]);
});
