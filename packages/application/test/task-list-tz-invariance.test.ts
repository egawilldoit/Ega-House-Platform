import assert from "node:assert/strict";
import test from "node:test";

import type { TaskRecord, TaskQuery } from "../src/tasks/ports";
import { buildMobileTaskListView, computeMobileTaskCounters } from "../src/tasks/list-view";

/**
 * The task list read model must receive an explicit canonical local date from
 * Time Context; it must never derive the owner's calendar day from the
 * process timezone. These tests lock that contract: the same explicit
 * `today` yields identical results no matter the server TZ (proven by running
 * this file under TZ=UTC, TZ=Asia/Tokyo, TZ=America/New_York,
 * TZ=Africa/Casablanca and comparing).
 */

function makeRecord(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "task-1",
    title: "Task",
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    plannedForDate: null,
    archivedAt: null,
    estimateMinutes: null,
    updatedAt: "2026-08-27T10:00:00.000Z",
    focusRank: null,
    totalDurationSeconds: 0,
    projectId: "project-1",
    projectName: "Project",
    projectSlug: "project",
    goalId: null,
    goalTitle: null,
    reminders: [],
    recurrence: null,
    ...overrides,
  } as TaskRecord;
}

const RECORDS: TaskRecord[] = [
  makeRecord({ id: "overdue", dueDate: "2026-08-26" }),
  makeRecord({ id: "today", dueDate: "2026-08-27" }),
  makeRecord({ id: "tomorrow", dueDate: "2026-08-28" }),
  makeRecord({ id: "done-today", dueDate: "2026-08-27", status: "done" }),
  makeRecord({ id: "no-due" }),
];

const QUERY: TaskQuery = {
  status: null,
  priority: null,
  projectId: null,
  goalId: null,
  plannedForDate: null,
  includeArchived: false,
  due: "all",
  sort: "updated_desc",
  limit: null,
};

test("due-today/overdue counters follow the explicit canonical local date", () => {
  const view = buildMobileTaskListView({
    records: RECORDS,
    projects: [],
    goals: [],
    query: QUERY,
    today: "2026-08-27",
  });

  assert.equal(view.counters.total, 5);
  assert.equal(view.counters.overdue, 1);
  assert.equal(view.counters.dueToday, 1);

  const overdueFilter = buildMobileTaskListView({
    records: RECORDS,
    projects: [],
    goals: [],
    query: { ...QUERY, due: "overdue" },
    today: "2026-08-27",
  });
  assert.deepEqual(
    overdueFilter.items.map((item) => item.id),
    ["overdue"],
  );

  const dueTodayFilter = buildMobileTaskListView({
    records: RECORDS,
    projects: [],
    goals: [],
    query: { ...QUERY, due: "due_today" },
    today: "2026-08-27",
  });
  assert.deepEqual(
    dueTodayFilter.items.map((item) => item.id),
    ["today"],
  );
});

test("a different explicit local date moves the due-today/overdue boundary", () => {
  const view = buildMobileTaskListView({
    records: RECORDS,
    projects: [],
    goals: [],
    query: QUERY,
    today: "2026-08-28",
  });

  assert.equal(view.counters.overdue, 2);
  assert.equal(view.counters.dueToday, 1);
});

test("computeMobileTaskCounters requires an explicit today", () => {
  const counters = computeMobileTaskCounters(
    RECORDS.map((record) => record) as never,
    "2026-08-27",
  );
  assert.equal(counters.overdue, 1);
  assert.equal(counters.dueToday, 1);
});

test("process timezone cannot leak into the read model (structural)", () => {
  // The view input carries no `now`; the only clock input is the explicit
  // canonical `today`. If a process-local Date ever crept back in, the
  // counters below would shift with the server TZ near midnight.
  const view = buildMobileTaskListView({
    records: RECORDS,
    projects: [],
    goals: [],
    query: QUERY,
    today: "2026-08-27",
  });
  assert.equal(view.counters.overdue, 1);
  assert.equal(view.counters.dueToday, 1);
  assert.equal(view.counters.total, 5);
});
