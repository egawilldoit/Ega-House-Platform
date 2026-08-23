import assert from "node:assert/strict";
import test from "node:test";

import { AUTH, FakeSupabase, JSON_HEADERS, makeApp } from "./harness.task-parity";
import { PARITY_TODAY } from "./fixtures.task-parity";

/**
 * TODAY parity: proves the canonical `/api/today*` endpoints answer the same
 * read model and mutation envelopes the legacy `/api/mobile/today*` routes
 * produced, including 404 mapping for unavailable tasks.
 */

function todayRow(overrides: Record<string, unknown>) {
  return {
    title: "Planned task",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    estimate_minutes: 30,
    scheduled_start_at: null,
    scheduled_end_at: null,
    focus_rank: null,
    planned_for_date: PARITY_TODAY,
    completed_at: null,
    projects: { name: "Platform", slug: "platform" },
    goals: null,
    ...overrides,
  };
}

const MUTATION_TASK_ROW = {
  id: "t-plan",
  title: "Planned task",
  description: null,
  blocked_reason: null,
  status: "in_progress",
  priority: "medium",
  due_date: null,
  estimate_minutes: null,
  project_id: "p1",
  goal_id: null,
  planned_for_date: PARITY_TODAY,
  focus_rank: null,
  scheduled_start_at: null,
  scheduled_end_at: null,
  calendar_sync_enabled: false,
  calendar_reminder_minutes: 10,
  completed_at: null,
  archived_at: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-10T00:00:00.000Z",
};

function queueMutationPair(fake: FakeSupabase) {
  // Ownership probe (select + hydrate) then write (update + hydrate).
  fake.push("tasks", { data: MUTATION_TASK_ROW, error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });
  fake.push("tasks", { data: MUTATION_TASK_ROW, error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });
}

test("PARITY TODAY GET: sections/suggestions/summary/activeTimer match the mobile contract", async () => {
  const fake = new FakeSupabase();
  // The three parallel reads pop one tasks queue each: selected, pinned, in-progress.
  fake.push("tasks", { data: [todayRow({ id: "t-plan" })], error: null });
  fake.push("tasks", { data: [todayRow({ id: "t-pin", focus_rank: 1, planned_for_date: null })], error: null });
  fake.push("tasks", { data: [todayRow({ id: "t-wip", status: "in_progress", planned_for_date: null })], error: null });
  fake.push("task_sessions", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });

  const response = await makeApp(fake).request(`/api/today?date=${PARITY_TODAY}`, { headers: AUTH });
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.date, PARITY_TODAY);

  assert.deepEqual(
    Object.keys(body.sections).sort(),
    ["blocked", "completed", "inProgress", "planned"],
  );
  assert.deepEqual(body.sections.planned.map((task: { id: string }) => task.id), ["t-plan"]);
  assert.equal(body.sections.planned[0].projectName, "Platform");
  assert.equal(body.sections.planned[0].projectSlug, "platform");
  assert.equal(body.sections.planned[0].isPlannedForToday, true);
  assert.equal(body.sections.planned[0].dueBucket, "none");

  assert.deepEqual(body.suggestions.pinned.map((task: { id: string }) => task.id), ["t-pin"]);
  assert.deepEqual(body.suggestions.inProgress.map((task: { id: string }) => task.id), ["t-wip"]);

  assert.deepEqual(body.summary, {
    plannedCount: 1,
    inProgressCount: 0,
    blockedCount: 0,
    completedCount: 0,
    selectedCount: 1,
    clearableCompletedCount: 0,
    overdueCount: 0,
    dueTodayCount: 0,
    totalEstimateMinutes: 30,
    trackedTodaySeconds: 0,
    trackedTodayLabel: "0s",
  });

  assert.equal(body.activeTimer, null);
});

test("PARITY TODAY MUTATIONS: add/remove/status/clear-completed answer legacy envelopes", async () => {
  const fake = new FakeSupabase();
  queueMutationPair(fake);
  queueMutationPair(fake);
  queueMutationPair(fake);
  fake.push("tasks", { data: null, error: null, count: 2 });

  const app = makeApp(fake);

  const planned = await app.request("/api/today/tasks/t-plan", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ date: PARITY_TODAY }),
  });
  assert.equal(planned.status, 200);
  assert.deepEqual(await planned.json(), { ok: true, taskId: "t-plan" });

  const removed = await app.request("/api/today/tasks/t-plan", { method: "DELETE", headers: AUTH });
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { ok: true, taskId: "t-plan" });

  const status = await app.request("/api/today/tasks/t-plan/status", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ status: "in_progress" }),
  });
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { ok: true, taskId: "t-plan", status: "in_progress" });

  const clear = await app.request("/api/today/clear-completed", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ date: PARITY_TODAY }),
  });
  assert.equal(clear.status, 200);
  assert.deepEqual(await clear.json(), { ok: true });

  // Blocked status requires a blocked reason, exactly like legacy.
  const blockedFake = new FakeSupabase();
  blockedFake.push("tasks", { data: { id: "t-plan" }, error: null });
  blockedFake.push("task_reminders", { data: [], error: null });
  blockedFake.push("task_recurrences", { data: [], error: null });
  blockedFake.push("task_sessions", { data: [], error: null });
  const blocked = await makeApp(blockedFake).request("/api/today/tasks/t-plan/status", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ status: "blocked" }),
  });
  assert.equal(blocked.status, 400);
  assert.equal(
    (await blocked.json()).error.message,
    "Blocked reason is required when status is Blocked.",
  );
});

test("PARITY TODAY NOT_FOUND: mutations on unavailable tasks answer 404 before writing", async () => {
  for (const request of [
    { path: "/api/today/tasks/gone", init: { method: "POST", headers: JSON_HEADERS, body: "{}" } },
    { path: "/api/today/tasks/gone", init: { method: "DELETE", headers: AUTH } },
    {
      path: "/api/today/tasks/gone/status",
      init: { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status: "done" }) },
    },
  ] as Array<{ path: string; init: RequestInit }>) {
    const fake = new FakeSupabase();
    const response = await makeApp(fake).request(request.path, { headers: AUTH, ...request.init });
    assert.equal(response.status, 404, request.path);
    const body = await response.json();
    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(body.error.message, "Task is unavailable.");

    const writes = fake.calls.filter(
      (call) =>
        call.table === "tasks" &&
        call.steps.some((step) => ["insert", "update"].includes(step.method)),
    );
    assert.equal(writes.length, 0, `no writes after failed ownership probe (${request.path})`);
  }
});
