import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkspaceShellMetrics } from "./workspace-shell";

test("prioritizes active timer over all other shell signals", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: true,
    blockedTaskCount: 2,
    overdueTaskCount: 3,
    dueTodayTaskCount: 4,
    hasCurrentWeekReview: false,
  });

  assert.equal(metrics.timerState, "active");
  assert.equal(metrics.reviewMissing, true);
  assert.equal(metrics.highestPrioritySignal, "active_timer");
  assert.equal(metrics.totalActionCount, 11);
});

test("derives overdue, due-today, blocked, and review-missing in priority order", () => {
  const overdueMetrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 4,
    overdueTaskCount: 2,
    dueTodayTaskCount: 5,
    hasCurrentWeekReview: true,
  });
  assert.equal(overdueMetrics.highestPrioritySignal, "overdue");

  const dueTodayMetrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 4,
    overdueTaskCount: 0,
    dueTodayTaskCount: 5,
    hasCurrentWeekReview: true,
  });
  assert.equal(dueTodayMetrics.highestPrioritySignal, "due_today");

  const blockedMetrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 4,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });
  assert.equal(blockedMetrics.highestPrioritySignal, "blocked");

  const reviewMissingMetrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: false,
  });
  assert.equal(reviewMissingMetrics.reviewSignal, "missing");
  assert.equal(reviewMissingMetrics.highestPrioritySignal, "review_missing");
});

test("stays clean when there are no shell actions", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });

  assert.equal(metrics.taskActionCount, 0);
  assert.equal(metrics.totalActionCount, 0);
  assert.equal(metrics.highestPrioritySignal, "clear");
  assert.equal(metrics.reviewMissing, false);
});
