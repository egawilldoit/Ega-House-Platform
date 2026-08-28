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

  select(...args: unknown[]) {
    this.steps.push({ method: "select", args });
    return this;
  }
  eq(...args: unknown[]) {
    this.steps.push({ method: "eq", args });
    return this;
  }
  order(...args: unknown[]) {
    this.steps.push({ method: "order", args });
    return this;
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(fulfilled, rejected);
  }
}

const AUTH = { authorization: "Bearer friction-token" };

function makeApp(fake: FakeSupabase, now = new Date("2026-08-27T12:00:00.000Z")) {
  return createApp({
    verifyToken: async (token) => (token === "friction-token" ? "user-123" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => now,
  });
}

function isoAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("GET /api/friction/radar requires auth", async () => {
  const res = await makeApp(new FakeSupabase()).request("/api/friction/radar");
  assert.equal(res.status, 401);
});

test("GET /api/friction/radar returns owner-scoped empty state", async () => {
  const fake = new FakeSupabase();
  fake.push("tasks", { data: [], error: null });
  fake.push("goals", { data: [], error: null });

  const res = await makeApp(fake).request("/api/friction/radar", { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.thresholdDays, 7);
  assert.deepEqual(body.blocked, []);
  assert.deepEqual(body.staleTasks, []);
  assert.deepEqual(body.staleGoals, []);
  // owner-scoped
  assert.ok(fake.calls[0]?.steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.ok(fake.calls[1]?.steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
});

test("GET /api/friction/radar returns blocked with age and stale threshold, archived excluded", async () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const fake = new FakeSupabase();
  fake.push("tasks", {
    data: [
      {
        id: "blocked-1",
        title: "Blocked old",
        blocked_reason: "needs review",
        status: "blocked",
        updated_at: isoAgo(now, 10),
        project_id: "proj-1",
        goal_id: null,
        archived_at: null,
      },
      {
        id: "blocked-archived",
        title: "Blocked archived",
        blocked_reason: "x",
        status: "blocked",
        updated_at: isoAgo(now, 10),
        project_id: "proj-1",
        goal_id: null,
        archived_at: isoAgo(now, 1),
      },
      {
        id: "stale-task",
        title: "Stale active",
        blocked_reason: null,
        status: "todo",
        updated_at: isoAgo(now, 8),
        project_id: "proj-1",
        goal_id: null,
        archived_at: null,
      },
      {
        id: "fresh-task",
        title: "Fresh",
        blocked_reason: null,
        status: "todo",
        updated_at: isoAgo(now, 2),
        project_id: "proj-1",
        goal_id: null,
        archived_at: null,
      },
      {
        id: "done-task",
        title: "Done stale",
        blocked_reason: null,
        status: "done",
        updated_at: isoAgo(now, 20),
        project_id: "proj-1",
        goal_id: null,
        archived_at: null,
      },
    ],
    error: null,
  });
  fake.push("goals", {
    data: [
      {
        id: "goal-stale",
        title: "Stale goal",
        status: "active",
        updated_at: isoAgo(now, 9),
        project_id: "proj-1",
      },
      {
        id: "goal-archived",
        title: "Archived goal",
        status: "archived",
        updated_at: isoAgo(now, 9),
        project_id: "proj-1",
      },
      {
        id: "goal-fresh",
        title: "Fresh goal",
        status: "active",
        updated_at: isoAgo(now, 1),
        project_id: "proj-1",
      },
    ],
    error: null,
  });

  const res = await makeApp(fake, now).request("/api/friction/radar", { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json();
  // blocked: only non-archived blocked
  assert.equal(body.blocked.length, 1);
  assert.equal(body.blocked[0].id, "blocked-1");
  assert.equal(body.blocked[0].blockedReason, "needs review");
  assert.equal(body.blocked[0].ageDays, 10);
  // staleTasks: blocked-1 is also stale (10d) + stale-task (8d), but fresh excluded, done excluded, archived excluded
  // staleTasks should include blocked-1 and stale-task
  assert.ok(body.staleTasks.some((t: { id: string }) => t.id === "blocked-1"));
  assert.ok(body.staleTasks.some((t: { id: string }) => t.id === "stale-task"));
  assert.equal(body.staleTasks.some((t: { id: string }) => t.id === "fresh-task"), false);
  assert.equal(body.staleTasks.some((t: { id: string }) => t.id === "done-task"), false);
  assert.equal(body.staleTasks.some((t: { id: string }) => t.id === "blocked-archived"), false);
  // staleGoals: only active stale
  assert.equal(body.staleGoals.length, 1);
  assert.equal(body.staleGoals[0].id, "goal-stale");
  assert.equal(body.staleGoals[0].ageDays, 9);
});

test("GET /api/friction/radar derives actor from verified token, not payload", async () => {
  const fake = new FakeSupabase();
  fake.push("tasks", { data: [], error: null });
  fake.push("goals", { data: [], error: null });

  const app = createApp({
    verifyToken: async (token) => (token === "good-token" ? "user-good" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date("2026-08-27T12:00:00.000Z"),
  });

  const res = await app.request("/api/friction/radar", {
    headers: { authorization: "Bearer good-token" },
  });
  assert.equal(res.status, 200);
  assert.ok(fake.calls[0]?.steps.some((s) => s.args[1] === "user-good"));
  // attacker tries to spoof via body (should not affect actor)
  const spoofFake = new FakeSupabase();
  spoofFake.push("tasks", { data: [], error: null });
  spoofFake.push("goals", { data: [], error: null });
  const spoofApp = createApp({
    verifyToken: async (token) => (token === "good-token" ? "user-good" : null),
    createRequestClient: () => spoofFake as unknown as SupabaseClient,
  });
  const spoofRes = await spoofApp.request("/api/friction/radar?owner_user_id=attacker", {
    headers: { authorization: "Bearer good-token" },
  });
  assert.equal(spoofRes.status, 200);
  // still scoped to verified user-good, not attacker
  assert.ok(spoofFake.calls[0]?.steps.some((s) => s.args[1] === "user-good"));
});
