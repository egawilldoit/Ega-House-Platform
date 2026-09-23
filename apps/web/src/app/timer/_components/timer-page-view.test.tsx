import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import { TimerPageView } from "./TimerPageView";
import type { TimerPageModel } from "../_lib/timer-page-model";

const completedSession = {
  id: "session-1",
  taskId: "task-1",
  taskTitle: "Ship the workspace refinement",
  projectName: "LIFE",
  startedAt: "2026-09-22T15:52:00.000Z",
  endedAt: "2026-09-22T17:55:00.000Z",
  durationSeconds: 3600 + 20 * 60 + 23,
};

const activeSession = {
  id: "session-open",
  task_id: "task-1",
  started_at: "2026-09-22T15:52:00.000Z",
  tasks: {
    id: "task-1",
    title: "Ship the workspace refinement",
    description: null,
    status: "in_progress",
    priority: "medium",
    goals: null,
    projects: { name: "LIFE", slug: "life" },
  },
};

const trackedTotalSeconds = 189 * 3600 + 9 * 60 + 25;

function buildModel(overrides: Partial<TimerPageModel> = {}): TimerPageModel {
  return {
    actionError: null,
    actionSuccess: null,
    stoppedTaskId: null,
    ownerUserId: "user-1",
    tasks: [
      {
        id: "task-1",
        title: "Ship the workspace refinement",
        status: "in_progress",
        projects: { name: "LIFE", slug: "life" },
      },
    ],
    openSessions: [],
    todayTaskBreakdown: [
      {
        taskId: "task-1",
        taskTitle: "Ship the workspace refinement",
        durationSeconds: 3600 + 20 * 60 + 23,
      },
    ],
    todayTotalDurationSeconds: 11 * 3600,
    sessionHistory: [completedSession],
    taskTotalDurations: { "task-1": trackedTotalSeconds },
    activeSession: null,
    trackedTotalSeconds,
    ...overrides,
  } as unknown as TimerPageModel;
}

test("TimerPageView renders totals at minute precision and session rows at second precision", () => {
  const markup = renderToStaticMarkup(<TimerPageView model={buildModel()} />);

  assert.match(markup, />189h 9m</);
  assert.ok(!markup.includes("189h 9m 25s"), "KPI total leaked second precision");
  assert.match(markup, />11h</);
  assert.ok(!markup.includes("11h 0m 0s"), "Today total leaked empty units");
  assert.match(markup, />1h 20m 23s</);
});

test("TimerPageView renders the dense recent-session evidence table", () => {
  const markup = renderToStaticMarkup(<TimerPageView model={buildModel()} />);

  assert.match(markup, /<table class="data-table/);
  assert.match(markup, />Task</);
  assert.match(markup, />Project</);
  assert.match(markup, />Date \/ Time</);
  assert.match(markup, />Duration</);
  assert.match(markup, />Actions</);
  assert.match(markup, /Ship the workspace refinement/);
  assert.match(markup, /LIFE/);
  assert.match(markup, /Sep 22/);
  assert.match(markup, /3:52 PM – 5:55 PM/);
  assert.match(markup, /Review recent sessions or correct their timing\./);
});

test("TimerPageView keeps timing correction behind a compact per-row disclosure", () => {
  const markup = renderToStaticMarkup(<TimerPageView model={buildModel()} />);

  assert.match(markup, /class="action-overflow"/);
  assert.match(markup, /aria-label="Correct session timing"/);
  assert.ok(!markup.includes("Correct timing"), "the full per-row button returned");
  assert.match(markup, /name="date"/);
  assert.match(markup, /name="startTime"/);
  assert.match(markup, /name="endTime"/);
  assert.match(markup, /name="sessionId"/);
  assert.match(markup, /name="returnTo"/);
});

test("TimerPageView keeps the idle start-session region as the hero", () => {
  const markup = renderToStaticMarkup(<TimerPageView model={buildModel()} />);

  assert.match(markup, /Start a focus session/);
  assert.match(markup, /Select a task, then start the timer\./);
  assert.match(markup, /text-\[length:var\(--text-page\)\]/);
  assert.match(markup, /name="taskId"/);
  assert.match(markup, /Start session/);

  const source = readFileSync(
    resolve(process.cwd(), "src/app/timer/_components/TimerPageView.tsx"),
    "utf8",
  );
  assert.match(source, /action=\{startTimerAction\}/);
  assert.match(source, /action=\{updateSessionTimingAction\}/);
});

test("TimerPageView gives the start and resolve submits a pending state", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/app/timer/_components/TimerPageView.tsx"),
    "utf8",
  );

  assert.match(
    source,
    /import \{ PendingSubmitButton \} from "@\/components\/ui\/pending-submit-button"/,
    "Timer submits should use the shared pending submit primitive",
  );
  assert.match(source, /pendingLabel="Starting…"/);
  assert.match(source, /pendingLabel="Resolving…"/);
});

test("TimerPageView compacts the empty Today's focus state", () => {
  const markup = renderToStaticMarkup(
    <TimerPageView
      model={buildModel({
        todayTaskBreakdown: [],
        todayTotalDurationSeconds: 0,
        sessionHistory: [],
        trackedTotalSeconds: 0,
      })}
    />,
  );

  assert.match(markup, /No time tracked today/);
  assert.ok(!markup.includes("progress-track"), "empty state kept chart height");
  assert.ok(!markup.includes("workspace-split-grid"), "empty state kept the chart grid");
  assert.match(markup, /No completed sessions yet/);
});

test("TimerPageView shows the active session with canonical date and minute totals", () => {
  const markup = renderToStaticMarkup(
    <TimerPageView
      model={buildModel({
        openSessions: [activeSession],
        activeSession,
      })}
    />,
  );

  assert.match(markup, /Focus in progress/);
  assert.match(markup, /Started/);
  assert.match(markup, /Sep 22, 3:52 PM/);
  assert.match(markup, />189h 9m</);
});
