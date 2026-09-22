import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

import {
  getSidebarTaskSignalBadge,
  getTopBarAttentionSignal,
  getTopBarShellSignals,
  getTopBarTimerSignal,
} from "./shell-signals";

test("shell signals stay actionable, ordered, and canonical", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: true,
    blockedTaskCount: 1,
    overdueTaskCount: 2,
    dueTodayTaskCount: 3,
    hasCurrentWeekReview: false,
  });

  const signals = getTopBarShellSignals(metrics);
  assert.deepEqual(
    signals.map((signal) => signal.href),
    ["/timer", "/tasks?due=overdue", "/tasks?due=due_today", "/tasks?status=blocked", "/review"],
  );
  assert.equal(getTopBarTimerSignal(metrics)?.label, "Timer active");
  assert.equal(getTopBarAttentionSignal(metrics)?.label, "2 overdue");
});

test("keeps shell signal semantics clean when there is nothing actionable", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });

  assert.equal(getTopBarShellSignals(metrics).length, 0);
  assert.equal(getTopBarAttentionSignal(metrics), null);
  assert.equal(getTopBarTimerSignal(metrics), null);
  assert.equal(getSidebarTaskSignalBadge(metrics), null);
});

test("sidebar task badge prioritizes overdue over due-today over blocked", () => {
  assert.equal(
    getSidebarTaskSignalBadge(
      buildWorkspaceShellMetrics({
        hasActiveTimer: false,
        blockedTaskCount: 4,
        overdueTaskCount: 0,
        dueTodayTaskCount: 2,
        hasCurrentWeekReview: true,
      }),
    )?.tone,
    "warn",
  );

  assert.equal(
    getSidebarTaskSignalBadge(
      buildWorkspaceShellMetrics({
        hasActiveTimer: false,
        blockedTaskCount: 4,
        overdueTaskCount: 1,
        dueTodayTaskCount: 2,
        hasCurrentWeekReview: true,
      }),
    )?.tone,
    "error",
  );
});
