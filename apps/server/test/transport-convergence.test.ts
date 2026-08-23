import assert from "node:assert/strict";
import test from "node:test";

import { createEgaApiClient } from "../../../packages/api-client/src/client";
import { createApp, type ServerDependencies } from "../src/app";

/**
 * Transport convergence: the REAL @ega/api-client tasks/today surface drives
 * the REAL Hono app (in-process fetch adapter) and parses every response
 * into the shared @ega/contracts/mobile DTOs. This proves the canonical
 * endpoints satisfy exactly what the migrated mobile callers consume.
 */

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: Array<{ method: string; args: unknown[] }> }> = [];

  from(table: string) {
    const steps: Array<{ method: string; args: unknown[] }> = [];
    const popFrom = (target: string) => this.pop(target);
    const thisRecord = () => this.calls.push({ table, steps });
    const builder = {
      select() { steps.push({ method: "select", args: [] }); return builder; },
      eq(...args: unknown[]) { steps.push({ method: "eq", args }); return builder; },
      is(...args: unknown[]) { steps.push({ method: "is", args }); return builder; },
      in(...args: unknown[]) { steps.push({ method: "in", args }); return builder; },
      neq(...args: unknown[]) { steps.push({ method: "neq", args }); return builder; },
      not(...args: unknown[]) { steps.push({ method: "not", args }); return builder; },
      or(...args: unknown[]) { steps.push({ method: "or", args }); return builder; },
      order(...args: unknown[]) { steps.push({ method: "order", args }); return builder; },
      limit(...args: unknown[]) { steps.push({ method: "limit", args }); return builder; },
      insert() { steps.push({ method: "insert", args: [] }); return builder; },
      update() { steps.push({ method: "update", args: [] }); return builder; },
      maybeSingle() {
        steps.push({ method: "maybeSingle", args: [] });
        return Promise.resolve(popFrom(table));
      },
      single() {
        steps.push({ method: "single", args: [] });
        return Promise.resolve(popFrom(table));
      },
      then(resolve?: (value: QueryResult) => unknown) {
        thisRecord();
        return Promise.resolve(popFrom(table)).then(resolve);
      },
    };
    return builder;
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

function makeStack() {
  const fake = new FakeSupabase();
  const dependencies: ServerDependencies = {
    verifyToken: async (token) => (token === "conv-token" ? "user-123" : null),
    createRequestClient: () => fake as never,
  };
  const app = createApp(dependencies);

  // Fetch adapter: routes global fetch into the Hono app in-process.
  const fetchAdapter = (async (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const url = new URL(input);
    const response = await app.request(
      `${url.pathname}${url.search}`,
      {
        method: init.method,
        headers: init.headers,
        ...(init.body ? { body: init.body } : {}),
      },
    );
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;

  const client = createEgaApiClient({
    baseUrl: "https://hono.in-process.test",
    getAccessToken: () => "conv-token",
    fetch: fetchAdapter,
  });

  return { client, fake };
}

test("CONVERGENCE: unauthenticated list answers the typed UNAUTHENTICATED result", async () => {
  const anonClient = createEgaApiClient({
    baseUrl: "https://hono.in-process.test",
    getAccessToken: async () => null,
    fetch: (async () => new Response("{}", { status: 401 })) as unknown as typeof globalThis.fetch,
  });

  const result = await anonClient.tasks.list();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "UNAUTHENTICATED");
  }
});

test("CONVERGENCE: client list parses the enriched server payload into the contract shape", async () => {
  const { client, fake } = makeStack();

  fake.push("projects", { data: [{ id: "p1", name: "Platform", slug: "platform" }], error: null });
  fake.push("goals", { data: [{ id: "g1", title: "Ship v1", project_id: "p1" }], error: null });
  fake.push("tasks", { data: [{
    id: "t-1",
    title: "Converged",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "urgent",
    due_date: "2026-08-01",
    estimate_minutes: 15,
    project_id: "p1",
    goal_id: null,
    planned_for_date: null,
    focus_rank: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    completed_at: null,
    archived_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
    projects: { name: "Platform", slug: "platform" },
    goals: null,
  }], error: null });
  fake.push("task_reminders", { data: [], error: null });
  fake.push("task_recurrences", { data: [], error: null });
  fake.push("task_sessions", { data: [{ task_id: "t-1", duration_seconds: 45 }], error: null });

  const result = await client.tasks.list({ priority: "urgent", due: "overdue", sort: "due_date_asc", limit: 50 });
  assert.equal(result.ok, true);

  if (result.ok) {
    assert.equal(result.data.ok, true);
    assert.deepEqual(result.data.counters.byPriority, { low: 0, medium: 0, high: 0, urgent: 1 });
    assert.equal(result.data.filters.priority, "urgent");
    assert.equal(result.data.filters.limit, 50);
    assert.equal(result.data.tasks[0].project.slug, "platform");
    assert.equal(result.data.tasks[0].trackedDurationSeconds, 45);
    assert.deepEqual(result.data.goals, [{ id: "g1", title: "Ship v1" }]);
  }
});

test("CONVERGENCE: detail + mutation envelopes parse into MobileTaskMutationResponse", async () => {
  const { client, fake } = makeStack();

  const taskRow = {
    id: "t-9",
    title: "Detail",
    description: null,
    blocked_reason: null,
    status: "todo",
    priority: "low",
    due_date: null,
    estimate_minutes: null,
    project_id: "p1",
    goal_id: null,
    planned_for_date: null,
    focus_rank: null,
    scheduled_start_at: null,
    scheduled_end_at: null,
    calendar_sync_enabled: false,
    calendar_reminder_minutes: 10,
    completed_at: null,
    archived_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-05T00:00:00.000Z",
    projects: { name: "Platform", slug: "platform" },
    goals: null,
  };
  const hydrate = () => {
    fake.push("task_reminders", { data: [], error: null });
    fake.push("task_recurrences", { data: [], error: null });
    fake.push("task_sessions", { data: [], error: null });
  };

  fake.push("tasks", { data: taskRow, error: null });
  hydrate();

  const got = await client.tasks.get("t-9");
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.data.ok, true);
    assert.equal(got.data.task.title, "Detail");
    assert.equal(got.data.task.project.name, "Platform");
  }

  // Validation failure surfaces through the alias mapping with message intact.
  const bad = await client.tasks.create({
    title: "",
    projectId: "p1",
    goalId: null,
    description: null,
    blockedReason: null,
    status: "todo",
    priority: "medium",
    dueDate: null,
    estimateMinutes: null,
  } as never);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.error.code, "VALIDATION");
    assert.equal(bad.error.message, "Task title is required.");
  }
});

test("CONVERGENCE: today surface parses the canonical read model over the wire path", async () => {
  const { client, fake } = makeStack();

  fake.push("tasks", { data: [], error: null });
  fake.push("tasks", { data: [], error: null });
  fake.push("tasks", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });
  fake.push("task_sessions", { data: [], error: null });

  const result = await client.today.get("2026-08-10");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.date, "2026-08-10");
    assert.equal(result.data.summary.trackedTodayLabel, "0s");
    assert.deepEqual(result.data.suggestions, { pinned: [], inProgress: [] });
    assert.equal(result.data.activeTimer, null);
  }
});
