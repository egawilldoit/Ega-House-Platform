import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyHomeDashboardData,
  getHomeDeadlineWindows,
  toHomeDashboardGroup,
} from "./home-dashboard-data";

test("EGA-805: deadline windows are non-overlapping calendar buckets", () => {
  // Thursday 2026-09-24: tomorrow is Friday, This week covers Sat–Sun.
  const windows = getHomeDeadlineWindows("2026-09-24");

  assert.equal(windows.todayFrom, "2026-09-24");
  assert.equal(windows.todayTo, "2026-09-24");
  assert.equal(windows.tomorrowFrom, "2026-09-25");
  assert.equal(windows.tomorrowTo, "2026-09-25");
  assert.equal(windows.thisWeekFrom, "2026-09-26");
  assert.equal(windows.thisWeekTo, "2026-09-27");
  assert.equal(windows.weekEnd, "2026-09-27");
});

test("EGA-805: This week is a verified empty window on Sunday", () => {
  const windows = getHomeDeadlineWindows("2026-09-27");

  assert.equal(windows.tomorrowFrom, "2026-09-28");
  assert.equal(windows.thisWeekFrom, "2026-09-29");
  assert.equal(windows.thisWeekTo, "2026-09-27");
  assert.equal(windows.thisWeekFrom > windows.thisWeekTo, true);
});

test("EGA-805: a failed preview group is unavailable rather than an empty zero", () => {
  assert.deepEqual(toHomeDashboardGroup({ data: null, errorMessage: "nope" }), {
    count: null,
    tasks: [],
  });

  assert.deepEqual(
    toHomeDashboardGroup({
      data: {
        count: 42,
        rows: [
          {
            id: "task-1",
            title: "A task",
            status: "todo",
            priority: "high",
            due_date: "2026-09-24",
            completed_at: null,
            project_id: "project-1",
            projects: { name: "EGA House", slug: "ega-house" },
          },
        ],
      },
      errorMessage: null,
    }),
    {
      count: 42,
      tasks: [
        {
          id: "task-1",
          title: "A task",
          status: "todo",
          priority: "high",
          dueDate: "2026-09-24",
          projectName: "EGA House",
          projectSlug: "ega-house",
        },
      ],
    },
  );
});

test("EGA-805: empty dashboard data marks every aggregate unavailable", () => {
  const empty = emptyHomeDashboardData();

  assert.equal(empty.today, "");
  assert.equal(empty.stats.openTasks, null);
  assert.equal(empty.stats.activeProjects, null);
  assert.equal(empty.stats.completedThisWeek, null);
  assert.equal(empty.stats.trackedThisWeekMinutes, null);
  assert.equal(empty.deadlines.today.count, null);
  assert.equal(empty.myTasks.upcoming.count, null);
});
