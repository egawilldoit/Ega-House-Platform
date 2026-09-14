import assert from "node:assert/strict";
import test from "node:test";

import type { OperatorSnapshot, OperatorTask } from "@ega/application";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

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

function snapshot(overrides: Partial<OperatorSnapshot>): OperatorSnapshot {
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

const metrics = buildWorkspaceShellMetrics({
  hasActiveTimer: false,
  blockedTaskCount: 0,
  overdueTaskCount: 4,
  dueTodayTaskCount: 2,
  hasCurrentWeekReview: false,
});

test("EGA-653: with no timer, Start Here is the canonical focus.startHere", () => {
  const startHere = task({ id: "a" });
  const next = task({ id: "b" });
  const model = buildHomeModel({
    snapshot: snapshot({ focus: { startHere, queue: [startHere, next] } }),
    metrics,
  });

  assert.equal(model.activeTimer, null);
  assert.equal(model.startHere?.id, "a");
  assert.equal(model.nextUp?.id, "b");
  assert.equal(model.attention.overdue, 4);
  assert.equal(model.attention.dueToday, 2);
  assert.equal(model.attention.reviewMissing, true);
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
    metrics: buildWorkspaceShellMetrics({
      hasActiveTimer: true,
      blockedTaskCount: 0,
      overdueTaskCount: 4,
      dueTodayTaskCount: 2,
      hasCurrentWeekReview: false,
    }),
  });

  assert.equal(model.activeTimer?.taskId, "active");
  assert.equal(model.activeTimer?.task?.title, "Running work");
  // Next up is at most one and never duplicates Start Here or the active timer task.
  assert.equal(model.nextUp?.id, "b");
});

test("EGA-653: Next up skips blocked/completed and never exceeds one item", () => {
  const startHere = task({ id: "a" });
  const blocked = task({ id: "blocked", status: "blocked" });
  const done = task({ id: "done", status: "done" });
  const actionable = task({ id: "c" });
  const model = buildHomeModel({
    snapshot: snapshot({ focus: { startHere, queue: [startHere, blocked, done, actionable] } }),
    metrics,
  });

  assert.equal(model.nextUp?.id, "c");
});

test("EGA-653: degraded snapshot keeps attention counts and invents no work", () => {
  const model = buildHomeModel({ snapshot: null, metrics });

  assert.equal(model.snapshotUnavailable, true);
  assert.equal(model.startHere, null);
  assert.equal(model.nextUp, null);
  assert.equal(model.activeTimer, null);
  // Attention still comes from the canonical shell metrics, not fabricated zeros.
  assert.equal(model.attention.overdue, 4);
  assert.equal(model.attention.reviewMissing, true);
});
