import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildTodayPlan, type TodaySourceTask } from "@ega/application";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

import { TodayOperatorBriefing } from "./today-operator-briefing";

const TODAY = "2026-09-14";

function sourceTask(overrides: Partial<TodaySourceTask> & { id: string }): TodaySourceTask {
  const { id, ...rest } = overrides;
  const base: TodaySourceTask = {
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
    plannedForDate: null,
    updatedAt: "2026-09-13T10:00:00.000Z",
    completedAt: null,
    projectName: "EGA House",
    projectSlug: "ega-house",
    goalTitle: null,
  };
  return { ...base, ...rest };
}

test("EGA-647: Today briefing shows canonical global overdue, not the selected-lane count", () => {
  // Task A is overdue and selected into Today.
  const taskA = sourceTask({ id: "task-a", dueDate: "2026-09-10", plannedForDate: TODAY });

  const plan = buildTodayPlan({
    today: TODAY,
    selectedRows: [taskA],
    pinnedRows: [],
    inProgressRows: [],
    activeTimer: null,
    trackedTodaySeconds: 0,
  });

  // Task B is overdue but NOT selected for Today; Task C is done/archived with an
  // old due date. The global shell metric counts A + B only.
  const shellMetrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 2,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });

  const markup = renderToStaticMarkup(
    <TodayOperatorBriefing
      summary={plan.summary}
      hasActiveTimer={false}
      globalOverdueCount={shellMetrics.overdueTaskCount}
    />,
  );

  // Canonical Today-lane semantics are preserved: only the selected overdue task.
  assert.equal(plan.summary.overdueCount, 1);
  // Both visible "overdue" surfaces derive from the same global shell metric.
  assert.equal(shellMetrics.overdueTaskCount, 2);
  assert.match(markup, /<strong>2<\/strong> overdue/);
  assert.doesNotMatch(markup, /<strong>1<\/strong> overdue/);
});

test("EGA-647: Today briefing keeps remaining strip metrics from the Today summary", () => {
  const plan = buildTodayPlan({
    today: TODAY,
    selectedRows: [
      sourceTask({ id: "todo", plannedForDate: TODAY, estimateMinutes: 30 }),
      sourceTask({ id: "in-progress", status: "in_progress", plannedForDate: TODAY }),
      sourceTask({ id: "done", status: "done", plannedForDate: TODAY, completedAt: "2026-09-14T09:00:00.000Z" }),
    ],
    pinnedRows: [],
    inProgressRows: [],
    activeTimer: null,
    trackedTodaySeconds: 0,
  });

  const markup = renderToStaticMarkup(
    <TodayOperatorBriefing summary={plan.summary} hasActiveTimer globalOverdueCount={0} />,
  );

  assert.match(markup, /<strong>30m<\/strong> planned load/);
  assert.match(markup, /<strong>2<\/strong> active lane/);
  assert.match(markup, /<strong>0<\/strong> overdue/);
  assert.match(markup, /<strong>Live<\/strong> timer/);
  assert.match(markup, /<strong>1<\/strong> completed/);
});
