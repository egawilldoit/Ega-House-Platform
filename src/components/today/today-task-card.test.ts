import assert from "node:assert/strict";
import test from "node:test";

import type { TodayPlannerTask } from "@/lib/services/today-planner-service";

import { getTodayTaskCardMeta, getTodayTaskStatusOptions } from "./today-task-card";

function createTask(overrides: Partial<TodayPlannerTask> = {}): TodayPlannerTask {
  return {
    id: "task-1",
    title: "Task",
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    focusRank: null,
    plannedForDate: "2026-04-20",
    updatedAt: "2026-04-20T10:00:00.000Z",
    projectName: "Project",
    projectSlug: "project",
    goalTitle: null,
    hasActiveTimer: false,
    isDueToday: false,
    isPlannedForToday: true,
    ...overrides,
  };
}

test("keeps remove-from-today action for manually planned-only tasks", () => {
  const cardMeta = getTodayTaskCardMeta(createTask());

  assert.equal(cardMeta.showDueTodayBadge, false);
  assert.equal(cardMeta.canRemoveFromToday, true);
  assert.equal(cardMeta.removeLabel, "Remove from Today");
});

test("hides remove action for due-today-only tasks", () => {
  const cardMeta = getTodayTaskCardMeta(
    createTask({
      plannedForDate: null,
      dueDate: "2026-04-20",
      isDueToday: true,
      isPlannedForToday: false,
    }),
  );

  assert.equal(cardMeta.showDueTodayBadge, true);
  assert.equal(cardMeta.canRemoveFromToday, false);
  assert.equal(cardMeta.removeLabel, "Remove from Today");
});

test("shows manual-plan removal label when a task is due today and manually planned", () => {
  const cardMeta = getTodayTaskCardMeta(
    createTask({
      dueDate: "2026-04-20",
      isDueToday: true,
      isPlannedForToday: true,
    }),
  );

  assert.equal(cardMeta.showDueTodayBadge, true);
  assert.equal(cardMeta.canRemoveFromToday, true);
  assert.equal(cardMeta.removeLabel, "Remove manual plan");
});

test("today status options exclude blocked for non-blocked tasks", () => {
  const options = getTodayTaskStatusOptions(createTask({ status: "todo" }));

  assert.equal(options.includes("blocked"), false);
});

test("today status options include blocked for blocked tasks", () => {
  const options = getTodayTaskStatusOptions(
    createTask({ status: "blocked", blockedReason: "Waiting on release approval" }),
  );

  assert.equal(options.includes("blocked"), true);
});
