import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp } from "../src/index";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};
type Step = { method: string; args: unknown[] };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: Step[] }> = [];

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  push(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pop(table: string): QueryResult {
    return this.queues.get(table)?.shift() ?? { data: null, error: null };
  }
}

class FakeBuilder {
  private readonly steps: Step[] = [];

  constructor(
    private readonly table: string,
    private readonly fake: FakeSupabase,
  ) {}

  select(...args: unknown[]) { this.steps.push({ method: "select", args }); return this; }
  eq(...args: unknown[]) { this.steps.push({ method: "eq", args }); return this; }
  is(...args: unknown[]) { this.steps.push({ method: "is", args }); return this; }
  in(...args: unknown[]) { this.steps.push({ method: "in", args }); return this; }
  neq(...args: unknown[]) { this.steps.push({ method: "neq", args }); return this; }
  not(...args: unknown[]) { this.steps.push({ method: "not", args }); return this; }
  or(...args: unknown[]) { this.steps.push({ method: "or", args }); return this; }
  order(...args: unknown[]) { this.steps.push({ method: "order", args }); return this; }
  limit(...args: unknown[]) { this.steps.push({ method: "limit", args }); return this; }
  insert(...args: unknown[]) { this.steps.push({ method: "insert", args }); return this; }
  update(...args: unknown[]) { this.steps.push({ method: "update", args }); return this; }
  maybeSingle(...args: unknown[]) { this.steps.push({ method: "maybeSingle", args }); return this; }
  single(...args: unknown[]) { this.steps.push({ method: "single", args }); return this; }

  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(fulfilled, rejected);
  }
}

const AUTH = { authorization: "Bearer task-token" };
const JSON_HEADERS = { ...AUTH, "content-type": "application/json" };

function makeApp(fake: FakeSupabase) {
  return createApp({
    verifyToken: async (token) => token === "task-token" ? "user-123" : null,
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  });
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Wave 2",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    estimate_minutes: null,
    project_id: "project-1",
    goal_id: null,
    planned_for_date: "2026-08-10",
    focus_rank: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    completed_at: null,
    archived_at: null,
    created_at: "2026-08-10T10:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

function queueHydration(fake: FakeSupabase, rows: Array<Record<string, unknown>>) {
  fake.push("tasks", { data: rows, error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });
}

test("GET /api/tasks requires auth and returns actor-scoped tasks", async () => {
  const unauthenticated = await makeApp(new FakeSupabase()).request("/api/tasks");
  assert.equal(unauthenticated.status, 401);

  const fake = new FakeSupabase();
  queueHydration(fake, [taskRow()]);
  const response = await makeApp(fake).request("/api/tasks", { headers: AUTH });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tasks.length, 1);
  assert.ok(fake.calls[0]?.steps.some(
    (step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
  ));
});

test("POST /api/tasks derives owner from the verified bearer identity", async () => {
  const fake = new FakeSupabase();
  fake.push("projects", { data: [{ id: "project-1" }], error: null });
  fake.push("goals", { data: [], error: null });
  queueHydration(fake, [taskRow()]);

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
  const taskCall = fake.calls.find((call) => call.table === "tasks");
  const insert = taskCall?.steps.find((step) => step.method === "insert");
  assert.ok(insert);
  assert.equal((insert.args[0] as Record<string, unknown>).owner_user_id, "user-123");
});

test("GET /api/today returns the rich mobile read model", async () => {
  const fake = new FakeSupabase();
  fake.push("user_time_context", { data: null, error: null });
  fake.push("tasks", { data: [taskRow()], error: null });
  fake.push("tasks", { data: [], error: null });
  fake.push("tasks", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });

  const response = await makeApp(fake).request("/api/today?date=2026-08-10", { headers: AUTH });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.date, "2026-08-10");
  assert.deepEqual(body.sections.planned, [{
    id: "task-1",
    title: "Wave 2",
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
    updatedAt: "2026-08-10T10:00:00.000Z",
    focusRank: null,
    plannedForDate: "2026-08-10",
    projectName: "Unknown project",
    projectSlug: null,
    goalTitle: null,
    hasActiveTimer: false,
    isDueToday: false,
    isPlannedForToday: true,
    dueBucket: "none",
  }]);
  assert.deepEqual(body.summary, {
    plannedCount: 1,
    inProgressCount: 0,
    blockedCount: 0,
    completedCount: 0,
    selectedCount: 1,
    clearableCompletedCount: 0,
    overdueCount: 0,
    dueTodayCount: 0,
    totalEstimateMinutes: 0,
    trackedTodaySeconds: 0,
    trackedTodayLabel: "0s",
  });
  assert.deepEqual(body.suggestions, { pinned: [], inProgress: [] });
  assert.equal(body.activeTimer, null);
  const todayTasksCall = fake.calls.find((call) => call.table === "tasks");
  assert.ok(todayTasksCall?.steps.some(
    (step) => step.method === "or" && String(step.args[0]).includes("planned_for_date.eq.2026-08-10"),
  ));
});

test("POST /api/tasks/:id/reminders validates future time and uses owner-scoped persistence", async () => {
  const fake = new FakeSupabase();
  fake.push("task_reminders", { data: null, error: null });
  queueHydration(fake, [taskRow()]);

  const response = await makeApp(fake).request("/api/tasks/task-1/reminders", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ remindAt: "2026-08-10T13:00:00.000Z" }),
  });

  assert.equal(response.status, 201);
  const reminderInsert = fake.calls.find((call) => call.table === "task_reminders")?.steps
    .find((step) => step.method === "insert");
  assert.ok(reminderInsert);
  assert.equal((reminderInsert.args[0] as Record<string, unknown>).owner_user_id, "user-123");
});
