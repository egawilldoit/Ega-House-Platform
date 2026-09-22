import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildTodayPlan, type TodaySourceTask } from "@ega/application";

import { buildWorkspaceShellMetrics } from "@/lib/workspace-shell";

import { TodayKpiRow } from "./today-kpi-row";

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

function buildPlan(selectedRows: TodaySourceTask[]) {
  return buildTodayPlan({
    today: TODAY,
    selectedRows,
    pinnedRows: [],
    inProgressRows: [],
    activeTimer: null,
    trackedTodaySeconds: 0,
  });
}

function renderKpi({
  plan,
  hasActiveTimer = false,
  globalOverdueCount,
}: {
  plan: ReturnType<typeof buildTodayPlan>;
  hasActiveTimer?: boolean;
  globalOverdueCount: number;
}) {
  return renderToStaticMarkup(
    <TodayKpiRow
      summary={plan.summary}
      hasActiveTimer={hasActiveTimer}
      globalOverdueCount={globalOverdueCount}
    />,
  );
}

test("EGA-647: Today KPI row shows canonical global overdue, not the selected-lane count", () => {
  // Task A is overdue and selected into Today.
  const plan = buildPlan([
    sourceTask({ id: "task-a", dueDate: "2026-09-10", plannedForDate: TODAY }),
  ]);

  // Task B is overdue but NOT selected for Today, so the global shell metric is 2.
  const shellMetrics = buildWorkspaceShellMetrics({
    hasActiveTimer: false,
    blockedTaskCount: 0,
    overdueTaskCount: 2,
    dueTodayTaskCount: 0,
    hasCurrentWeekReview: true,
  });

  // Canonical Today-lane semantics are preserved: only the selected overdue task.
  assert.equal(plan.summary.overdueCount, 1);
  assert.equal(shellMetrics.overdueTaskCount, 2);

  const markup = renderKpi({ plan, globalOverdueCount: shellMetrics.overdueTaskCount });
  const overdueCard = markup.slice(markup.indexOf('data-testid="today-kpi-overdue"'));
  assert.match(overdueCard, />2</);
  assert.doesNotMatch(overdueCard, />1</);
});

test("EGA-647: Today KPI row keeps planned, in-progress and completed counts from the Today summary", () => {
  const plan = buildPlan([
    sourceTask({ id: "todo", plannedForDate: TODAY, estimateMinutes: 30 }),
    sourceTask({ id: "in-progress", status: "in_progress", plannedForDate: TODAY }),
    sourceTask({
      id: "done",
      status: "done",
      plannedForDate: TODAY,
      completedAt: "2026-09-14T09:00:00.000Z",
    }),
  ]);

  const markup = renderKpi({ plan, globalOverdueCount: 0 });

  const card = (testId: string) => {
    const start = markup.indexOf(`data-testid="${testId}"`);
    return markup.slice(start, markup.indexOf("</div>", markup.indexOf("tabular-nums", start)));
  };

  assert.match(card("today-kpi-planned"), />1</);
  assert.match(markup, /30m/);
  assert.match(card("today-kpi-in-progress"), />1</);
  assert.match(card("today-kpi-completed"), />1</);
  assert.ok(markup.includes('data-testid="today-kpi-tracked"'));
});

test("EGA-647: active timer is surfaced in the tracked metric instead of a fake duration", () => {
  const plan = buildPlan([sourceTask({ id: "todo", plannedForDate: TODAY })]);

  const idle = renderKpi({ plan, globalOverdueCount: 0 });
  const live = renderKpi({ plan, hasActiveTimer: true, globalOverdueCount: 0 });

  assert.doesNotMatch(idle, /live/);
  assert.match(live, /live/);
});
