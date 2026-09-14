import assert from "node:assert/strict";
import test from "node:test";

import { buildTodayPlan, getDueBucket, type TodaySourceTask } from "@ega/application";
import { getLocalDateInTimezone } from "@ega/domain";

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

test("surfaces the unread notification count without disturbing task signals", () => {
  const metrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
    unreadNotificationCount: 3,
  });

  assert.equal(metrics.unreadNotificationCount, 3);
  assert.equal(metrics.highestPrioritySignal, "clear");
  assert.equal(metrics.totalActionCount, 0);

  const missing = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 0,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });

  assert.equal(missing.unreadNotificationCount, 0);
});

function dueTask(id: string, dueDate: string): TodaySourceTask {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate,
    estimateMinutes: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    focusRank: null,
    plannedForDate: null,
    updatedAt: "2026-09-13T10:00:00.000Z",
    completedAt: null,
    projectName: "EGA House",
    projectSlug: "ega-house",
    goalTitle: null,
  };
}

test("EGA-647: shell day boundary follows canonical Time Context, not the runtime/UTC date", () => {
  // 02:00Z on 2026-09-15 is still 2026-09-14 in America/Los_Angeles (UTC-7).
  const now = new Date("2026-09-15T02:00:00.000Z");
  const canonicalToday = getLocalDateInTimezone(now, "America/Los_Angeles");
  assert.equal(canonicalToday, "2026-09-14");

  // A task due on the canonical local day is "today" for the Today plan, not overdue.
  const plan = buildTodayPlan({
    today: canonicalToday,
    selectedRows: [dueTask("due-today", canonicalToday)],
    pinnedRows: [],
    inProgressRows: [],
    activeTimer: null,
    trackedTodaySeconds: 0,
  });
  assert.equal(plan.summary.overdueCount, 0);
  assert.equal(plan.sections.planned[0]?.dueBucket, "today");

  // The runtime/UTC day boundary would have classified the same task overdue,
  // which is the divergence the shell now avoids by reusing the canonical day.
  const utcToday = getLocalDateInTimezone(now, "UTC");
  assert.equal(utcToday, "2026-09-15");
  assert.equal(getDueBucket(canonicalToday, "todo", utcToday), "overdue");
});
