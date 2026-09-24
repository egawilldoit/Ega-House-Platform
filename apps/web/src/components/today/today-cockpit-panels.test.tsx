import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TodayPlannerTask } from "@/lib/services/today-planner-service";

import { FocusQueuePanel, StartHerePanel } from "./today-cockpit-panels";

function task(overrides: Partial<TodayPlannerTask> & { id: string }): TodayPlannerTask {
  const { id, ...rest } = overrides;
  return {
    id,
    title: `Task ${id}`,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    focusRank: null,
    plannedForDate: "2026-09-14",
    updatedAt: "2026-09-14T09:00:00.000Z",
    completedAt: null,
    projectName: "EGA House",
    projectSlug: "ega-house",
    goalTitle: null,
    hasActiveTimer: false,
    isDueToday: false,
    isPlannedForToday: true,
    dueBucket: "none",
    ...rest,
  };
}

test("Up next hides the Start Here task and keeps the canonical queue order", () => {
  const startHere = task({ id: "start", title: "Start here work" });
  const markup = renderToStaticMarkup(
    <FocusQueuePanel
      tasks={[startHere, task({ id: "first", title: "First queued" }), task({ id: "second", title: "Second queued" })]}
      returnTo="/today"
      activeTimerSessionId={null}
      excludeTaskId={startHere.id}
    />,
  );

  // The queue is a suggestion lane, not the planned-today lane.
  assert.match(markup, /Suggested next/);
  assert.doesNotMatch(markup, /Up next/);
  assert.doesNotMatch(markup, /Start here work/);
  assert.ok(markup.indexOf("First queued") < markup.indexOf("Second queued"));
  assert.match(markup, /name="taskId" value="first"/);
  assert.match(markup, /name="taskId" value="second"/);
});

test("Up next badge equals the number of rows the panel actually renders", () => {
  const markup = renderToStaticMarkup(
    <FocusQueuePanel
      tasks={[
        task({ id: "start", title: "Start here work" }),
        task({ id: "first", title: "First queued" }),
        task({ id: "second", title: "Second queued" }),
        task({ id: "third", title: "Third queued" }),
      ]}
      returnTo="/today"
      activeTimerSessionId={null}
      excludeTaskId="start"
    />,
  );

  const badge = markup.match(/data-testid="today-focus-queue-count"[^>]*>(\d+)</);
  const renderedRows = (markup.match(/<li/g) ?? []).length;

  assert.equal(Number(badge?.[1]), 3);
  assert.equal(renderedRows, 3);
  assert.equal(Number(badge?.[1]), renderedRows);
});

test("Up next badge reads zero when only Start Here is queued", () => {
  const markup = renderToStaticMarkup(
    <FocusQueuePanel
      tasks={[task({ id: "start", title: "Start here work" })]}
      returnTo="/today"
      activeTimerSessionId={null}
      excludeTaskId="start"
    />,
  );

  assert.match(markup, /Queue is empty/);
  assert.match(markup, /data-testid="today-focus-queue-count"[^>]*>0</);
  assert.equal((markup.match(/<li/g) ?? []).length, 0);
});

test("Up next keeps the per-row stop wiring when a queued task is running", () => {
  const markup = renderToStaticMarkup(
    <FocusQueuePanel
      tasks={[
        task({ id: "start", title: "Start here work" }),
        task({ id: "running", hasActiveTimer: true, status: "in_progress" }),
      ]}
      returnTo="/today"
      activeTimerSessionId="session-1"
      excludeTaskId="start"
    />,
  );

  assert.match(markup, /name="sessionId" value="session-1"/);
  assert.match(markup, /Stop/);
  assert.doesNotMatch(markup, /name="taskId"/);
});

test("Up next shows the queue empty state when only Start Here is queued", () => {
  const markup = renderToStaticMarkup(
    <FocusQueuePanel
      tasks={[task({ id: "start", title: "Start here work" })]}
      returnTo="/today"
      activeTimerSessionId={null}
      excludeTaskId="start"
    />,
  );

  assert.match(markup, /Queue is empty/);
  assert.doesNotMatch(markup, /Start here work/);
});

test("Up next still renders every canonical task when no exclusion is supplied", () => {
  const markup = renderToStaticMarkup(
    <FocusQueuePanel
      tasks={[task({ id: "first", title: "First queued" })]}
      returnTo="/today"
      activeTimerSessionId={null}
    />,
  );

  assert.match(markup, /First queued/);
  assert.match(markup, /name="taskId" value="first"/);
  assert.match(markup, /data-testid="today-focus-queue-count"[^>]*>1</);
});

test("Start Here keeps its own timer action when it is hidden from Up next", () => {
  const markup = renderToStaticMarkup(
    <StartHerePanel
      task={task({ id: "start", title: "Start here work" })}
      returnTo="/today"
      activeTimerSessionId={null}
    />,
  );

  assert.match(markup, /data-testid="today-start-here"/);
  assert.match(markup, /name="taskId" value="start"/);
  assert.match(markup, /name="returnTo" value="\/today"/);
  assert.match(markup, /Start timer/);
});

test("Start Here keeps its stop action when its task is the running session", () => {
  const markup = renderToStaticMarkup(
    <StartHerePanel
      task={task({ id: "start", status: "in_progress", hasActiveTimer: true })}
      returnTo="/today"
      activeTimerSessionId="session-1"
    />,
  );

  assert.match(markup, /name="sessionId" value="session-1"/);
  assert.match(markup, /Stop timer/);
});
