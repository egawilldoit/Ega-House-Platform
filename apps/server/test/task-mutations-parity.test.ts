import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH,
  FakeSupabase,
  JSON_HEADERS,
  makeApp,
} from "./harness.task-parity";
import {
  expectedTodayItem,
  parityReminderRows,
  parityTaskRows,
} from "./fixtures.task-parity";

/**
 * TASKS mutation parity: create/update/pin flows answer the legacy
 * `{ ok: true, task }` enriched envelope, force verified ownership, and map
 * missing tasks to 404 exactly like `/api/mobile/tasks*` did.
 */

function queueHydratedRow(fake: FakeSupabase, rowIndex: number, overrides: Record<string, unknown> = {}) {
  fake.push("tasks", { data: { ...parityTaskRows()[rowIndex], ...overrides }, error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });
}

function recurrenceRow() {
  return {
    id: "rec1",
    task_id: "t-overdue",
    rule: "daily",
    anchor_date: "2026-08-15",
    timezone: "UTC",
    next_occurrence_date: "2026-08-16",
    last_generated_at: null,
  };
}

test("PARITY CREATE: attacker-supplied owner is ignored; response carries the enriched item", async () => {
  const fake = new FakeSupabase();
  fake.push("projects", { data: [{ id: "project-1" }], error: null });
  fake.push("goals", { data: [], error: null });
  queueHydratedRow(fake, 1);

  const response = await makeApp(fake).request("/api/tasks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      title: "Wave 2",
      projectId: "project-1",
      status: "todo",
      priority: "medium",
      owner_user_id: "attacker",
    }),
  });

  assert.equal(response.status, 201);
  const insert = fake.calls
    .find((call) => call.table === "tasks")
    ?.steps.find((step) => step.method === "insert");
  assert.equal((insert?.args[0] as Record<string, unknown>).owner_user_id, "user-123");

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.task.project, expectedTodayItem().project);
});

test("PARITY CREATE: blocked without reason rejects with the legacy validation message", async () => {
  const fake = new FakeSupabase();
  const response = await makeApp(fake).request("/api/tasks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ title: "Blocked", projectId: "p1", status: "blocked" }),
  });
  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error.message,
    "Blocked reason is required when status is Blocked.",
  );
});

test("PARITY CREATE: inline recurrenceRule anchors on the created task's due date", async () => {
  const fake = new FakeSupabase();
  fake.push("projects", { data: [{ id: "p1" }], error: null });
  fake.push("goals", { data: [], error: null });
  // Create + hydrate.
  queueHydratedRow(fake, 0);
  // Recurrence upsert result, then re-hydration now carrying the schedule.
  fake.push("task_recurrences", { data: null, error: null });
  fake.push("tasks", { data: parityTaskRows()[0], error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [recurrenceRow()], error: null });
  fake.push("task_sessions", { data: [], error: null });

  const response = await makeApp(fake).request("/api/tasks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      title: "Recurring",
      projectId: "p1",
      status: "todo",
      priority: "urgent",
      dueDate: "2026-08-15",
      recurrenceRule: "daily",
    }),
  });

  assert.equal(response.status, 201);
  const upsert = fake.calls
    .filter((call) => call.table === "task_recurrences")
    .flatMap((call) => call.steps)
    .find((step) => step.method === "upsert");
  const payload = upsert?.args[0] as Record<string, unknown>;
  assert.equal(payload.rule, "daily");
  assert.equal(payload.anchor_date, "2026-08-15");
  assert.equal(payload.owner_user_id, "user-123");

  const body = await response.json();
  assert.equal(body.ok, true);
  // The schedule anchors on the created task's due date (2026-08-15), not
  // the fixture's default anchor.
  assert.deepEqual(body.task.recurrence, {
    rule: "daily",
    anchorDate: "2026-08-15",
    timezone: "UTC",
    nextOccurrenceDate: "2026-08-16",
    lastGeneratedAt: null,
  });
});

test("PARITY PATCH: recurrence rides along and explicit null clears it", async () => {
  const setFake = new FakeSupabase();
  queueHydratedRow(setFake, 0);
  setFake.push("task_recurrences", { data: null, error: null });
  // Re-hydration after both writes reflects the new priority + schedule.
  setFake.push("tasks", { data: { ...parityTaskRows()[0], priority: "high" }, error: null });
  setFake.push("task_reminders", { data: [], error: null });
  setFake.push("task_recurrences", { data: [recurrenceRow()], error: null });
  setFake.push("task_sessions", { data: [], error: null });

  const setResponse = await makeApp(setFake).request("/api/tasks/t-overdue", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ priority: "high", recurrenceRule: "daily" }),
  });
  assert.equal(setResponse.status, 200);
  const setBody = await setResponse.json();
  assert.equal(setBody.ok, true);
  assert.equal(setBody.task.priority, "high");

  const upsert = setFake.calls
    .filter((call) => call.table === "task_recurrences")
    .flatMap((call) => call.steps)
    .find((step) => step.method === "upsert");
  assert.equal(((upsert?.args[0] ?? {}) as Record<string, unknown>).rule, "daily");

  const clearFake = new FakeSupabase();
  queueHydratedRow(clearFake, 0);
  clearFake.push("task_recurrences", { data: null, error: null });
  queueHydratedRow(clearFake, 0);

  const clearResponse = await makeApp(clearFake).request("/api/tasks/t-overdue", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ recurrenceRule: null }),
  });
  assert.equal(clearResponse.status, 200);
  const deletes = clearFake.calls
    .filter((call) => call.table === "task_recurrences")
    .map((call) => call.steps.find((step) => step.method === "delete"))
    .filter(Boolean);
  assert.equal(deletes.length, 1);
});

test("PARITY PIN: pin assigns max+1 with owner scope; already-pinned is idempotent", async () => {
  const pinFake = new FakeSupabase();
  pinFake.push("tasks", { data: { id: "t-nodate", focus_rank: null }, error: null });
  pinFake.push("tasks", { data: [{ focus_rank: 2 }], error: null });
  pinFake.push("tasks", { data: null, error: null });
  queueHydratedRow(pinFake, 3);

  const pinned = await makeApp(pinFake).request("/api/tasks/t-nodate/pin", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(pinned.status, 200);
  const pinnedBody = await pinned.json();
  assert.equal(pinnedBody.ok, true);

  const taskSteps = pinFake.calls.filter((call) => call.table === "tasks").flatMap((call) => call.steps);
  const update = taskSteps.find((step) => step.method === "update");
  assert.equal(((update?.args[0] ?? {}) as Record<string, unknown>).focus_rank, 3);
  const idScope = taskSteps.find((step) => step.method === "eq" && step.args[0] === "id");
  assert.deepEqual(idScope?.args, ["id", "t-nodate"]);
  const ownerScope = taskSteps.find((step) => step.method === "eq" && step.args[0] === "owner_user_id");
  assert.equal(ownerScope?.args[1], "user-123");

  const idempotentFake = new FakeSupabase();
  idempotentFake.push("tasks", { data: { id: "t-overdue", focus_rank: 2 }, error: null });
  queueHydratedRow(idempotentFake, 0);

  const idempotent = await makeApp(idempotentFake).request("/api/tasks/t-overdue/pin", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(idempotent.status, 200);
  assert.equal(
    idempotentFake.calls.filter((call) => call.table === "tasks" && call.steps.some((s) => s.method === "update")).length,
    0,
  );
});

test("PARITY UNPIN: unpin clears focus rank; not-pinned is idempotent; missing task 404s", async () => {
  const unpinFake = new FakeSupabase();
  unpinFake.push("tasks", { data: { id: "t-overdue", focus_rank: 2 }, error: null });
  unpinFake.push("tasks", { data: null, error: null });
  queueHydratedRow(unpinFake, 0);

  const unpinned = await makeApp(unpinFake).request("/api/tasks/t-overdue/unpin", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(unpinned.status, 200);
  const update = unpinFake.calls
    .filter((call) => call.table === "tasks")
    .flatMap((call) => call.steps)
    .find((step) => step.method === "update");
  assert.equal(((update?.args[0] ?? {}) as Record<string, unknown>).focus_rank, null);

  const idleFake = new FakeSupabase();
  idleFake.push("tasks", { data: { id: "t-soon", focus_rank: null }, error: null });
  queueHydratedRow(idleFake, 2);

  const idle = await makeApp(idleFake).request("/api/tasks/t-soon/unpin", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(idle.status, 200);
  assert.equal(
    idleFake.calls.filter((call) => call.table === "tasks" && call.steps.some((s) => s.method === "update")).length,
    0,
  );

  const missingFake = new FakeSupabase();
  const missing = await makeApp(missingFake).request("/api/tasks/gone/unpin", {
    method: "POST",
    headers: AUTH,
  });
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, "NOT_FOUND");
  assert.equal(missingBody.error.message, "Selected task is unavailable.");
});

test("PARITY REMINDERS: future reminder creation answers the enriched envelope", async () => {
  const fake = new FakeSupabase();
  fake.push("task_reminders", { data: null, error: null });
  // Post-write hydration carries the new reminder.
  fake.push("tasks", { data: parityTaskRows()[1], error: null });
  fake.push("task_reminders", { data: parityReminderRows(), error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });

  const response = await makeApp(fake).request("/api/tasks/t-today/reminders", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ remindAt: "2026-08-10T13:00:00.000Z" }),
  });

  assert.equal(response.status, 201);
  const insert = fake.calls
    .find((call) => call.table === "task_reminders")
    ?.steps.find((step) => step.method === "insert");
  assert.equal((insert?.args[0] as Record<string, unknown>).owner_user_id, "user-123");

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.task.reminders, expectedTodayItem().reminders);
});
