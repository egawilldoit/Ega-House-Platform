import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TodayPlannerTask } from "@/lib/services/today-planner-service";

import {
  canShowTodayTaskStartTimer,
  getTodayTaskScheduledRange,
  getTodayTaskCardMeta,
  getTodayTaskStartTimerActionMeta,
  getTodayTaskStatusOptions,
  TodayTaskStartTimerForm,
} from "./today-task-card";

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
    scheduledStartAt: null,
    scheduledEndAt: null,
    focusRank: null,
    plannedForDate: "2026-04-20",
    updatedAt: "2026-04-20T10:00:00.000Z",
    completedAt: null,
    projectName: "Project",
    projectSlug: "project",
    goalTitle: null,
    hasActiveTimer: false,
    isDueToday: false,
    isPlannedForToday: true,
    dueBucket: "none",
    ...overrides,
  };
}

function renderTodayTaskCard(
  task: TodayPlannerTask,
  options: {
    label?: string;
    returnTo?: string;
    fallbackReturnTo?: string;
  } = {},
) {
  const actionMeta = getTodayTaskStartTimerActionMeta(task, {
    fallbackReturnTo: options.fallbackReturnTo ?? "/today",
    label: options.label,
    returnTo: options.returnTo,
  });

  if (!actionMeta) {
    return "";
  }

  return renderToStaticMarkup(
    React.createElement(TodayTaskStartTimerForm, {
      taskId: task.id,
      actionMeta,
    }),
  );
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

test("completed Today cards do not expose start timer eligibility", () => {
  assert.equal(canShowTodayTaskStartTimer(createTask({ status: "done" })), false);
  assert.equal(
    canShowTodayTaskStartTimer(createTask({ status: "completed" as never })),
    false,
  );
  assert.equal(canShowTodayTaskStartTimer(createTask({ status: "todo" })), true);
});

test("canceled Today cards do not expose start timer eligibility", () => {
  assert.equal(canShowTodayTaskStartTimer(createTask({ status: "canceled" as never })), false);
  assert.equal(canShowTodayTaskStartTimer(createTask({ status: "cancelled" as never })), false);
});

test("scheduled Today timeline start action opens timer with task context", () => {
  const actionMeta = getTodayTaskStartTimerActionMeta(createTask(), {
    fallbackReturnTo: "/today",
    label: "Start Focus Session",
    returnTo: "/timer",
  });

  assert.deepEqual(actionMeta, {
    label: "Start Focus Session",
    returnTo: "/timer",
  });

  const markup = renderTodayTaskCard(
    createTask({
      scheduledStartAt: "2026-04-20T09:00:00.000Z",
      scheduledEndAt: "2026-04-20T09:30:00.000Z",
    }),
    {
      label: "Start Focus Session",
      returnTo: "/timer",
    },
  );

  assert.match(markup, /Start Focus Session/);
  assert.match(markup, /name="taskId" value="task-1"/);
  assert.match(markup, /name="returnTo" value="\/timer"/);
});

test("completed and canceled scheduled blocks hide invalid focus start path", () => {
  for (const status of ["done", "canceled", "cancelled"]) {
    const markup = renderTodayTaskCard(
      createTask({
        status: status as never,
        scheduledStartAt: "2026-04-20T09:00:00.000Z",
        scheduledEndAt: "2026-04-20T09:30:00.000Z",
      }),
      {
        label: "Start Focus Session",
        returnTo: "/timer",
      },
    );

    assert.doesNotMatch(markup, /Start Focus Session/);
    assert.doesNotMatch(markup, /name="returnTo" value="\/timer"/);
  }
});

test("unscheduled Today task keeps existing timer handoff", () => {
  const markup = renderTodayTaskCard(createTask());

  assert.match(markup, /Start timer/);
  assert.doesNotMatch(markup, /Start Focus Session/);
  assert.match(markup, /name="taskId" value="task-1"/);
  assert.match(markup, /name="returnTo" value="\/today"/);
});

test("scheduled range only returns when both start and end exist", () => {
  assert.equal(getTodayTaskScheduledRange(createTask()), null);
  assert.equal(
    getTodayTaskScheduledRange(
      createTask({
        scheduledStartAt: "2026-04-20T09:00:00.000Z",
        scheduledEndAt: null,
      }),
    ),
    null,
  );
  assert.equal(
    getTodayTaskScheduledRange(
      createTask({
        scheduledStartAt: "2026-04-20T09:30:00.000Z",
        scheduledEndAt: "2026-04-20T09:00:00.000Z",
      }),
    ),
    null,
  );
  assert.deepEqual(
    getTodayTaskScheduledRange(
      createTask({
        scheduledStartAt: "2026-04-20T09:00:00.000Z",
        scheduledEndAt: "2026-04-20T09:30:00.000Z",
      }),
    ),
    {
      startAt: "2026-04-20T09:00:00.000Z",
      endAt: "2026-04-20T09:30:00.000Z",
    },
  );
});
