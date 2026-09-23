import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TodayPlannerTask } from "@/lib/services/today-planner-service";

import { TodayLanePanel } from "./today-lane-panel";

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

function render(overrides: Partial<Parameters<typeof TodayLanePanel>[0]> = {}) {
  return renderToStaticMarkup(
    <TodayLanePanel
      scheduledBlocks={[]}
      dueTodayCarryover={[]}
      flexibleTasks={[]}
      returnTo="/today"
      activeTimerSessionId={null}
      {...overrides}
    />,
  );
}

test("EGA-648: every lane row can start its own focus session with the canonical action", () => {
  const markup = render({
    scheduledBlocks: [task({ id: "sched", title: "Scheduled block" })],
    dueTodayCarryover: [task({ id: "carry", title: "Carryover" })],
    flexibleTasks: [task({ id: "flex", title: "Flexible" })],
  });

  // Three rows, three start-timer forms with the right task ids.
  for (const id of ["sched", "carry", "flex"]) {
    assert.match(
      markup,
      new RegExp(`name="taskId" value="${id}"`),
      `${id} should be startable from the lane`,
    );
  }
  assert.equal((markup.match(/name="returnTo" value="\/today"/g) ?? []).length, 3);
  assert.match(markup, /scheduled/);
  assert.match(markup, /due today/);
  assert.match(markup, /flexible/);
});

test("EGA-648: lane Focus submits use the canonical pending control", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "./today-lane-panel.tsx"),
    "utf-8",
  );

  assert.match(
    source,
    /import \{ PendingSubmitButton \} from "@\/components\/ui\/pending-submit-button"/,
    "Focus should use the shared pending submit primitive",
  );
  assert.match(source, /pendingLabel="Starting…"/);
});

test("EGA-648: a running task shows Stop instead of a second start action", () => {
  const markup = render({
    scheduledBlocks: [task({ id: "running", hasActiveTimer: true, status: "in_progress" })],
    activeTimerSessionId: "session-1",
  });

  assert.match(markup, /name="sessionId" value="session-1"/);
  assert.match(markup, /Stop/);
  assert.doesNotMatch(markup, /name="taskId"/);
});

test("EGA-648: completed lane rows expose no timer action", () => {
  const markup = render({
    flexibleTasks: [
      task({ id: "done", status: "done", completedAt: "2026-09-14T10:00:00.000Z" }),
    ],
  });

  assert.match(markup, /Task done/);
  assert.doesNotMatch(markup, /name="taskId"/);
  assert.doesNotMatch(markup, /name="sessionId"/);
});

test("EGA-648: an empty lane states that nothing is scheduled", () => {
  const markup = render();
  assert.match(markup, /Nothing scheduled/);
  assert.doesNotMatch(markup, /Scheduled blocks and today's flexible work appear here/);
});
