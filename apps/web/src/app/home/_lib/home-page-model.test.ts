import assert from "node:assert/strict";
import test from "node:test";

import type { OperatorSnapshot, OperatorTask } from "@ega/application";

import type { HomeAttention } from "./home-page-model";
import { buildHomeModel } from "./home-page-model";

const TODAY = "2026-09-14";

function task(overrides: Partial<OperatorTask> & { id: string }): OperatorTask {
  const { id, ...rest } = overrides;
  const base: OperatorTask = {
    id,
    title: `Task ${id}`,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    updatedAt: "2026-09-13T10:00:00.000Z",
    completedAt: null,
    focusRank: null,
    plannedForDate: TODAY,
    scheduledStartAt: null,
    scheduledEndAt: null,
    projectName: "EGA House",
    projectSlug: "ega-house",
    goalTitle: null,
    hasActiveTimer: false,
    isDueToday: false,
    isPlannedForToday: true,
    dueBucket: "none",
  };
  return { ...base, ...rest };
}

function snapshot(overrides: Partial<OperatorSnapshot> = {}): OperatorSnapshot {
  const base: OperatorSnapshot = {
    date: TODAY,
    timezone: "UTC",
    dayWindow: { startUtcIso: "", endUtcIso: "" },
    timeContextId: "ctx",
    sections: { planned: [], inProgress: [], blocked: [], completed: [] },
    focus: { startHere: null, queue: [] },
    schedule: { blocks: [], flexible: [] },
    plannedToday: [],
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
  return { ...base, ...overrides };
}

const ATTENTION: HomeAttention = { overdue: 4, dueToday: 2, reviewMissing: true };

test("EGA-653: with no timer, Start Here is the canonical focus.startHere", () => {
  const startHere = task({ id: "a" });
  const next = task({ id: "b" });
  const model = buildHomeModel({
    snapshot: snapshot({ focus: { startHere, queue: [startHere, next] } }),
    attention: ATTENTION,
  });

  assert.equal(model.activeTimer, null);
  assert.equal(model.startHere?.id, "a");
  assert.equal(model.nextUp?.id, "b");
  assert.equal(model.date, TODAY);
  assert.equal(model.timezone, "UTC");
  assert.equal(model.attention?.overdue, 4);
  assert.equal(model.attention?.dueToday, 2);
  assert.equal(model.attention?.reviewMissing, true);
  assert.deepEqual(model.availability, { operator: "available", attention: "available" });
});

test("EGA-653: active timer becomes the primary state and Next up stays distinct", () => {
  const startHere = task({ id: "a" });
  const next = task({ id: "b" });
  const activeTask = task({ id: "active", title: "Running work" });
  const model = buildHomeModel({
    snapshot: snapshot({
      focus: { startHere, queue: [activeTask, startHere, next] },
      activeTimer: { sessionId: "s1", taskId: "active" },
      plannedToday: [activeTask],
    }),
    attention: ATTENTION,
    activeTimerStartedAt: "2026-09-14T10:00:00.000Z",
  });

  assert.equal(model.activeTimer?.taskId, "active");
  assert.equal(model.activeTimer?.task?.title, "Running work");
  // startedAt comes from the bounded canonical active-session read.
  assert.equal(model.activeTimer?.startedAt, "2026-09-14T10:00:00.000Z");
  // Next up is at most one and never duplicates Start Here or the active timer task.
  assert.equal(model.nextUp?.id, "b");
});

test("EGA-653: active timer without a resolved session exposes no elapsed time", () => {
  const model = buildHomeModel({
    snapshot: snapshot({
      focus: { startHere: null, queue: [] },
      activeTimer: { sessionId: "s1", taskId: "active" },
    }),
    attention: ATTENTION,
  });

  assert.equal(model.activeTimer?.taskId, "active");
  assert.equal(model.activeTimer?.startedAt, null);
});

test("EGA-653: Next up skips blocked/completed and never exceeds one item", () => {
  const startHere = task({ id: "a" });
  const blocked = task({ id: "blocked", status: "blocked" });
  const done = task({ id: "done", status: "done" });
  const actionable = task({ id: "c" });
  const model = buildHomeModel({
    snapshot: snapshot({ focus: { startHere, queue: [startHere, blocked, done, actionable] } }),
    attention: ATTENTION,
  });

  assert.equal(model.nextUp?.id, "c");
});

test("EGA-653: degraded snapshot keeps canonical attention and invents no work", () => {
  const model = buildHomeModel({ snapshot: null, attention: ATTENTION });

  assert.equal(model.availability.operator, "unavailable");
  assert.equal(model.date, "");
  assert.equal(model.timezone, "");
  assert.equal(model.startHere, null);
  assert.equal(model.nextUp, null);
  assert.equal(model.activeTimer, null);
  assert.equal(model.todayProgress, null);
  // Attention still comes from the canonical shell metrics, not fabricated zeros.
  assert.equal(model.attention?.overdue, 4);
  assert.equal(model.attention?.reviewMissing, true);
});

test("EGA-663: unavailable shell attention is distinguished from a verified zero", () => {
  const model = buildHomeModel({
    snapshot: snapshot({ focus: { startHere: task({ id: "a" }), queue: [] } }),
    attention: null,
  });

  assert.equal(model.attention, null);
  assert.equal(model.availability.attention, "unavailable");
  // A verified zero keeps the clear-state truth available.
  const verified = buildHomeModel({
    snapshot: snapshot({ focus: { startHere: task({ id: "a" }), queue: [] } }),
    attention: { overdue: 0, dueToday: 0, reviewMissing: false },
  });
  assert.deepEqual(verified.attention, { overdue: 0, dueToday: 0, reviewMissing: false });
  assert.equal(verified.availability.attention, "available");
});

test("EGA-663: Today progress is scoped to the Today projection, not universal counts", () => {
  const model = buildHomeModel({
    snapshot: snapshot({
      summary: {
        plannedCount: 3,
        inProgressCount: 1,
        blockedCount: 9,
        completedCount: 0,
        selectedCount: 4,
        clearableCompletedCount: 0,
        overdueCount: 7,
        dueTodayCount: 2,
        totalEstimateMinutes: 90,
        trackedTodaySeconds: 0,
        trackedTodayLabel: "0m",
      },
    }),
    attention: ATTENTION,
  });

  assert.equal(model.todayProgress?.totalCount, 4);
  assert.equal(model.todayProgress?.completedCount, 0);
  assert.equal(model.todayProgress?.plannedCount, 3);
  assert.equal(model.todayProgress?.inProgressCount, 1);
  assert.equal(model.todayProgress?.ratio, 0);
  assert.equal(model.todayProgress?.totalEstimateMinutes, 90);
});

test("EGA-663: Today progress ratio is null when nothing is planned", () => {
  const model = buildHomeModel({ snapshot: snapshot(), attention: ATTENTION });

  assert.equal(model.todayProgress?.totalCount, 0);
  assert.equal(model.todayProgress?.ratio, null);
});

test("EGA-663: the Home contract carries no full sections or focus queue", () => {
  const queued = task({ id: "queued" });
  const model = buildHomeModel({
    snapshot: snapshot({
      sections: { planned: [task({ id: "p" })], inProgress: [], blocked: [], completed: [] },
      focus: { startHere: task({ id: "a" }), queue: [task({ id: "a" }), queued, task({ id: "q2" })] },
    }),
    attention: ATTENTION,
  });

  assert.equal(model.startHere?.id, "a");
  assert.equal(model.nextUp?.id, "queued");
  assert.equal("sections" in model, false);
  assert.equal("focusQueue" in model, false);
  assert.equal("summary" in model, false);
});
