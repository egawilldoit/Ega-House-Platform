import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectTimeSummary,
  getGoalHealthColor,
  getProjectStatusBarColor,
  selectProjectComingUpTasks,
  type ProjectComingUpTask,
} from "./project-overview";

function task(overrides: Partial<ProjectComingUpTask> & Pick<ProjectComingUpTask, "id">) {
  return {
    title: `Task ${overrides.id}`,
    status: "todo",
    due_date: null,
    planned_for_date: null,
    scheduled_start_at: null,
    archived_at: null,
    ...overrides,
  } satisfies ProjectComingUpTask;
}

test("coming up orders by the next relevant due, planned or scheduled date", () => {
  const items = selectProjectComingUpTasks(
    [
      task({ id: "due-later", due_date: "2026-12-20" }),
      task({ id: "planned-soon", planned_for_date: "2026-12-08" }),
      task({ id: "scheduled-next", scheduled_start_at: "2026-12-07T09:00:00.000Z" }),
      task({ id: "today", due_date: "2026-12-07" }),
    ],
    { today: "2026-12-07", timezone: "UTC" },
  );

  assert.deepEqual(
    items.map((item) => [item.task.id, item.date, item.source]),
    [
      ["scheduled-next", "2026-12-07", "scheduled"],
      ["today", "2026-12-07", "due"],
      ["planned-soon", "2026-12-08", "planned"],
      ["due-later", "2026-12-20", "due"],
    ],
  );
});

test("coming up prefers a future scheduled date over an overdue due date", () => {
  const items = selectProjectComingUpTasks(
    [task({ id: "mixed", due_date: "2026-12-01", scheduled_start_at: "2026-12-09T15:00:00.000Z" })],
    { today: "2026-12-07", timezone: "UTC" },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.source, "scheduled");
  assert.equal(items[0]?.date, "2026-12-09");
});

test("coming up excludes completed, archived and undated tasks and respects the limit", () => {
  const tasks = [
    task({ id: "done", status: "done", due_date: "2026-12-08" }),
    task({ id: "archived", archived_at: "2026-12-01T00:00:00.000Z", due_date: "2026-12-08" }),
    task({ id: "undated" }),
    ...Array.from({ length: 8 }, (_, index) =>
      task({ id: `future-${index}`, due_date: `2026-12-${String(10 + index).padStart(2, "0")}` }),
    ),
  ];

  const items = selectProjectComingUpTasks(tasks, {
    today: "2026-12-07",
    timezone: "UTC",
    limit: 6,
  });

  assert.equal(items.length, 6);
  assert.deepEqual(
    items.map((item) => item.task.id),
    ["future-0", "future-1", "future-2", "future-3", "future-4", "future-5"],
  );
  assert.equal(
    selectProjectComingUpTasks(tasks, { today: "2026-12-07", timezone: "UTC", limit: 0 }).length,
    0,
  );
});

test("coming up resolves scheduled instants in the account timezone", () => {
  const items = selectProjectComingUpTasks(
    [task({ id: "late", scheduled_start_at: "2026-12-08T01:00:00.000Z" })],
    { today: "2026-12-07", timezone: "America/Los_Angeles" },
  );

  // 01:00Z is still 2026-12-07 in Los Angeles.
  assert.equal(items[0]?.date, "2026-12-07");
});

test("project time summary separates this week from retained lifetime time", () => {
  const summary = buildProjectTimeSummary(
    [
      { estimate_minutes: 60 },
      { estimate_minutes: null },
      { estimate_minutes: 0 },
      { estimate_minutes: 30 },
    ],
    [
      {
        task_id: "task-1",
        started_at: "2026-12-07T09:00:00.000Z",
        ended_at: "2026-12-07T09:30:00.000Z",
        duration_seconds: null,
      },
      {
        task_id: "task-2",
        started_at: "2026-11-01T09:00:00.000Z",
        ended_at: "2026-11-01T10:00:00.000Z",
        duration_seconds: null,
      },
      {
        task_id: "task-3",
        started_at: "2026-12-07T23:30:00.000Z",
        ended_at: null,
        duration_seconds: null,
      },
    ],
    {
      startIso: "2026-12-07T00:00:00.000Z",
      endIso: "2026-12-14T00:00:00.000Z",
    },
    "2026-12-08T00:00:00.000Z",
  );

  assert.equal(summary.estimatedMinutes, 90);
  assert.equal(summary.estimatedTaskCount, 2);
  assert.equal(summary.weekTrackedSeconds, 1800 + 1800);
  assert.equal(summary.weekSessionCount, 2);
  assert.equal(summary.totalTrackedSeconds, 1800 + 3600 + 1800);
});

test("project time summary is an honest zero without estimates or sessions", () => {
  const summary = buildProjectTimeSummary(
    [{ estimate_minutes: null }],
    [],
    { startIso: "2026-12-07T00:00:00.000Z", endIso: "2026-12-14T00:00:00.000Z" },
    "2026-12-08T00:00:00.000Z",
  );

  assert.deepEqual(summary, {
    weekTrackedSeconds: 0,
    weekSessionCount: 0,
    totalTrackedSeconds: 0,
    estimatedMinutes: 0,
    estimatedTaskCount: 0,
  });
});

test("status and goal colours use the status token namespace", () => {
  assert.equal(getProjectStatusBarColor("review"), "var(--status-review)");
  assert.equal(getProjectStatusBarColor("done"), "var(--status-healthy)");
  assert.equal(getProjectStatusBarColor("legacy"), "var(--ega-text-tertiary)");
  assert.equal(getGoalHealthColor("on_track"), "var(--status-healthy)");
  assert.equal(getGoalHealthColor("at_risk"), "var(--status-risk)");
  assert.equal(getGoalHealthColor("off_track"), "var(--status-overdue)");
  assert.equal(getGoalHealthColor(null), "var(--ega-text-tertiary)");
});
