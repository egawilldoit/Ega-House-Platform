import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH,
  FakeSupabase,
  makeApp,
  queueFullList,
} from "./harness.task-parity";
import {
  expectedFullCounters,
  expectedListEnvelope,
  expectedOverdueItem,
  expectedTodayItem,
  parityGoalRows,
  parityProjectRows,
  parityRecurrenceRows,
  parityReminderRows,
  paritySessionRows,
  parityTaskRows,
} from "./fixtures.task-parity";

/**
 * TASKS list/detail parity: proves the canonical Hono `/api/tasks` endpoints
 * satisfy every read capability the legacy `/api/mobile/tasks*` surface
 * provided (phase-1 Task 3 enriched payload), shape-for-shape.
 */

test("PARITY LIST: unauthenticated requests answer the canonical 401 envelope", async () => {
  const response = await makeApp(new FakeSupabase()).request("/api/tasks");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { code: "UNAUTHENTICATED", message: "Authentication required." },
  });
});

test("PARITY LIST: default envelope matches the legacy enriched payload exactly", async () => {
  const fake = new FakeSupabase();
  queueFullList(fake);

  const response = await makeApp(fake).request("/api/tasks", { headers: AUTH });
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.deepEqual(body.tasks.map((task: { id: string }) => task.id), [
    "t-today",
    "t-soon",
    "t-nodate",
    "t-overdue",
    "t-done",
  ]);
  assert.equal(body.tasks[0].trackedDurationSeconds, 120);
  assert.deepEqual(body.tasks[0].reminders[0], expectedTodayItem().reminders[0]);
  assert.deepEqual(body.tasks[3].recurrence, expectedOverdueItem().recurrence);
  assert.deepEqual(body.counters, expectedFullCounters());
  assert.deepEqual(body.filters, {
    status: null,
    projectId: null,
    goalId: null,
    priority: null,
    due: "all",
    sort: "updated_desc",
    plannedForDate: null,
    includeArchived: false,
    limit: null,
  });
  assert.deepEqual(body.projects, expectedListEnvelope([]).projects);
  assert.deepEqual(body.goals, expectedListEnvelope([]).goals);
});

test("PARITY LIST: counters cover the full filtered scope before the limit slice", async () => {
  const fake = new FakeSupabase();
  queueFullList(fake);

  const body = await (await makeApp(fake).request("/api/tasks?limit=2", { headers: AUTH })).json();

  assert.deepEqual(body.counters, expectedFullCounters());
  assert.equal(body.tasks.length, 2);
  assert.equal(body.filters.limit, 2);
});

test("PARITY LIST: due filters reproduce legacy buckets and counter scopes", async () => {
  // Legacy computed counters over the DUE-FILTERED set before slicing, so
  // totals here describe the bucket, not the unfiltered table.
  const cases: Array<[string, string[], number]> = [
    ["overdue", ["t-overdue"], 1],
    ["due_today", ["t-today"], 1],
    ["due_soon", ["t-today", "t-soon"], 2],
    ["no_due_date", ["t-nodate"], 1],
  ];

  for (const [due, expectedIds, expectedTotal] of cases) {
    const fake = new FakeSupabase();
    queueFullList(fake);
    const body = await (await makeApp(fake).request(`/api/tasks?due=${due}`, { headers: AUTH })).json();
    assert.deepEqual(body.tasks.map((task: { id: string }) => task.id), expectedIds, `due=${due}`);
    assert.equal(body.counters.total, expectedTotal);
    assert.equal(body.filters.due, due);
  }

  const badFake = new FakeSupabase();
  const bad = await makeApp(badFake).request("/api/tasks?due=yesterday", { headers: AUTH });
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.equal(badBody.error.code, "VALIDATION");
  assert.equal(badBody.error.message, "Invalid due filter.");
});

test("PARITY LIST: sort values reproduce legacy orders including null-dates-last", async () => {
  const fake = new FakeSupabase();
  queueFullList(fake);
  // Null dates sort last in both directions; completed tasks keep their
  // place in the ordering exactly like the legacy task-list query.
  const asc = await (await makeApp(fake).request("/api/tasks?sort=due_date_asc", { headers: AUTH })).json();
  assert.deepEqual(asc.tasks.map((task: { id: string }) => task.id), [
    "t-overdue",
    "t-done",
    "t-today",
    "t-soon",
    "t-nodate",
  ]);
  assert.equal(asc.filters.sort, "due_date_asc");

  const descFake = new FakeSupabase();
  queueFullList(descFake);
  const desc = await (
    await makeApp(descFake).request("/api/tasks?sort=due_date_desc", { headers: AUTH })
  ).json();
  assert.deepEqual(desc.tasks.map((task: { id: string }) => task.id), [
    "t-soon",
    "t-today",
    "t-done",
    "t-overdue",
    "t-nodate",
  ]);
});

test("PARITY LIST: urgent priority filter reaches SQL, scopes to owner, echoes filters", async () => {
  const fake = new FakeSupabase();
  fake.push("projects", { data: parityProjectRows(), error: null });
  fake.push("goals", { data: parityGoalRows(), error: null });
  fake.push("tasks", { data: [parityTaskRows()[0]], error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [parityRecurrenceRows()[0]], error: null });
  fake.push("task_sessions", { data: [], error: null });

  const body = await (await makeApp(fake).request("/api/tasks?priority=urgent", { headers: AUTH })).json();
  assert.deepEqual(body.tasks.map((task: { id: string }) => task.id), ["t-overdue"]);
  assert.equal(body.filters.priority, "urgent");
  assert.equal(body.counters.byPriority.urgent, 1);

  const taskCall = fake.calls.find((call) => call.table === "tasks");
  assert.ok(taskCall?.steps.some((step) => step.method === "in" && step.args[0] === "priority"));
  assert.equal(
    taskCall?.steps.find((step) => step.method === "eq" && step.args[0] === "owner_user_id")?.args[1],
    "user-123",
  );

  const badFake = new FakeSupabase();
  const bad = await makeApp(badFake).request("/api/tasks?priority=critical", { headers: AUTH });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.message, "Invalid priority filter.");
});

test("PARITY LIST: invalid status/sort/limit reject with legacy validation messages", async () => {
  for (const [query, message] of [
    ["status=archived", "Invalid status filter."],
    ["sort=random", "Invalid sort value."],
    ["includeArchived=yes", "Invalid includeArchived filter."],
    ["limit=0", "limit must be an integer between 1 and 200."],
    ["limit=201", "limit must be an integer between 1 and 200."],
  ] as Array<[string, string]>) {
    const fake = new FakeSupabase();
    const response = await makeApp(fake).request(`/api/tasks?${query}`, { headers: AUTH });
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error.message, message, query);
  }
});

test("PARITY LIST: unknown project/goal filters are dropped and echoed as null", async () => {
  const fake = new FakeSupabase();
  queueFullList(fake);

  const body = await (
    await makeApp(fake).request("/api/tasks?projectId=pX&goalId=gX", { headers: AUTH })
  ).json();

  assert.equal(body.filters.projectId, null);
  assert.equal(body.filters.goalId, null);
  const taskCall = fake.calls.find((call) => call.table === "tasks");
  assert.ok(!taskCall?.steps.some((step) => step.method === "eq" && step.args[0] === "project_id"));
});

test("PARITY LIST: active project restricts visible goal form options", async () => {
  const fake = new FakeSupabase();
  queueFullList(fake);

  const body = await (await makeApp(fake).request("/api/tasks?projectId=p1", { headers: AUTH })).json();
  assert.equal(body.filters.projectId, "p1");
  assert.deepEqual(body.goals, [{ id: "g1", title: "Ship v1" }]);
});

test("PARITY LIST: archive scope and planned date reach the canonical task read model", async () => {
  const fake = new FakeSupabase();
  const archivedTask = {
    ...parityTaskRows()[0],
    id: "t-archived",
    title: "Archived task",
    archived_at: "2026-08-09T12:00:00.000Z",
    planned_for_date: "2026-08-10",
  };
  fake.push("projects", { data: parityProjectRows(), error: null });
  fake.push("goals", { data: parityGoalRows(), error: null });
  fake.push("tasks", { data: [archivedTask], error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });

  const response = await makeApp(fake).request(
    "/api/tasks?includeArchived=true&plannedForDate=2026-08-10",
    { headers: AUTH },
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.tasks[0].id, "t-archived");
  assert.equal(body.tasks[0].archivedAt, "2026-08-09T12:00:00.000Z");
  assert.equal(body.tasks[0].plannedForDate, "2026-08-10");
  assert.equal(body.filters.includeArchived, true);
  assert.equal(body.filters.plannedForDate, "2026-08-10");

  const taskCall = fake.calls.find((call) => call.table === "tasks");
  assert.ok(taskCall);
  assert.ok(!taskCall.steps.some((step) => step.method === "is" && step.args[0] === "archived_at"));
  assert.ok(
    taskCall.steps.some(
      (step) => step.method === "eq" && step.args[0] === "planned_for_date" && step.args[1] === "2026-08-10",
    ),
  );
});

test("PARITY DETAIL: GET /api/tasks/:id returns the enriched { ok, task } envelope or 404", async () => {
  const fake = new FakeSupabase();
  fake.push("tasks", { data: parityTaskRows()[1], error: null });
  fake.push("task_reminders", { data: parityReminderRows(), error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: paritySessionRows(), error: null });

  const found = await makeApp(fake).request("/api/tasks/t-today", { headers: AUTH });
  assert.equal(found.status, 200);
  const foundBody = await found.json();
  assert.equal(foundBody.ok, true);
  assert.deepEqual(foundBody.task.project, expectedTodayItem().project);
  assert.equal(foundBody.task.trackedDurationSeconds, 120);
  assert.deepEqual(foundBody.task.reminders, expectedTodayItem().reminders);

  const missingFake = new FakeSupabase();
  const missing = await makeApp(missingFake).request("/api/tasks/gone", { headers: AUTH });
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, "NOT_FOUND");
  assert.equal(missingBody.error.message, "Task not found.");
});
