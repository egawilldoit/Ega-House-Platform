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

const ATTENTION: HomeAttention = { overdue: 1, dueToday: 2, reviewMissing: false };

test("EGA-663: active timer takes precedence over startHere as primary focus", () => {
  const timerTask = task({ id: "t1", title: "Active timer task" });
  const startHere = task({ id: "s1", title: "Start here candidate" });

  const model = buildHomeModel({
    snapshot: snapshot({
      activeTimer: { sessionId: "sess-1", taskId: "t1" },
      sections: {
        planned: [],
        inProgress: [timerTask],
        blocked: [],
        completed: [],
      },
      focus: { startHere, queue: [startHere] },
    }),
    attention: ATTENTION,
    activeTimerStartedAt: "2026-09-14T08:00:00.000Z",
  });

  assert.equal(model.activeTimer?.sessionId, "sess-1");
  assert.equal(model.activeTimer?.taskId, "t1");
  assert.equal(model.activeTimer?.task?.title, "Active timer task");
  assert.equal(model.activeTimer?.startedAt, "2026-09-14T08:00:00.000Z");
  assert.equal(model.startHere?.id, "s1");
});

test("EGA-663: nextUp is at most one actionable task distinct from startHere", () => {
  const first = task({ id: "t1" });
  const second = task({ id: "t2" });
  const third = task({ id: "t3" });

  const model = buildHomeModel({
    snapshot: snapshot({
      focus: { startHere: first, queue: [first, second, third] },
    }),
    attention: ATTENTION,
  });

  assert.equal(model.startHere?.id, "t1");
  assert.equal(model.nextUp?.id, "t2");
});

test("EGA-663: nextUp skips blocked and completed items in the focus queue", () => {
  const first = task({ id: "t1" });
  const blocked = task({ id: "t2", status: "blocked" });
  const done = task({ id: "t3", status: "done" });
  const actionable = task({ id: "t4" });

  const model = buildHomeModel({
    snapshot: snapshot({
      focus: { startHere: first, queue: [first, blocked, done, actionable] },
    }),
    attention: ATTENTION,
  });

  assert.equal(model.nextUp?.id, "t4");
});

test("EGA-663: nextUp never duplicates the active timer task", () => {
  const running = task({ id: "running" });
  const next = task({ id: "next" });

  const model = buildHomeModel({
    snapshot: snapshot({
      activeTimer: { sessionId: "sess-1", taskId: "running" },
      focus: { startHere: null, queue: [running, next] },
    }),
    attention: ATTENTION,
  });

  assert.equal(model.nextUp?.id, "next");
});

test("EGA-663: missing snapshot yields degraded availability without crashing", () => {
  const model = buildHomeModel({
    snapshot: null,
    attention: { overdue: 4, dueToday: 0, reviewMissing: true },
  });

  assert.equal(model.availability.operator, "unavailable");
  assert.equal(model.date, "");
  assert.equal(model.timezone, "");
  assert.equal(model.startHere, null);
  assert.equal(model.nextUp, null);
  assert.equal(model.activeTimer, null);
  assert.equal(model.todayProgress, null);
  assert.equal(model.todayTasks.length, 0);
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

test("EGA-663: gathers up to 5 unique tasks for todayTasks", () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task({ id: `task-${i}`, title: `Task ${i}` }));
  const model = buildHomeModel({
    snapshot: snapshot({
      plannedToday: [tasks[0], tasks[1]],
      sections: {
        planned: [tasks[1], tasks[2], tasks[3]],
        inProgress: [tasks[4], tasks[5]],
        blocked: [],
        completed: [],
      },
    }),
    attention: ATTENTION,
  });

  assert.equal(model.todayTasks.length, 5);
  // No duplicates
  const ids = model.todayTasks.map((t) => t.id);
  assert.equal(new Set(ids).size, 5);
});
