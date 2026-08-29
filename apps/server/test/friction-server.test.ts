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
  lt(...args: unknown[]) {
    this.steps.push({ method: "lt", args });
    return this;
  }
  or(...args: unknown[]) {
    this.steps.push({ method: "or", args });
    return this;
  }
  gte(...args: unknown[]) {
    this.steps.push({ method: "gte", args });
    return this;
  }
  is(...args: unknown[]) {
    this.steps.push({ method: "is", args });
    return this;
  }
  limit(...args: unknown[]) {
    this.steps.push({ method: "limit", args });
    return this;
  }
  maybeSingle(...args: unknown[]) {
    this.steps.push({ method: "maybeSingle", args });
    return this;
  }
  single(...args: unknown[]) {
    this.steps.push({ method: "single", args });
    return this;
  }
  upsert(...args: unknown[]) {
    this.steps.push({ method: "upsert", args });
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
  // owner-scoped — find calls by table, not index, because user_time_context is queried first
  const tasksCall = fake.calls.find((c) => c.table === "tasks");
  const goalsCall = fake.calls.find((c) => c.table === "goals");
  assert.ok(tasksCall?.steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
  assert.ok(goalsCall?.steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
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
  const tasksCall = fake.calls.find((c) => c.table === "tasks");
  assert.ok(tasksCall?.steps.some((s) => s.args[1] === "user-good"));
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
  const spoofTasksCall = spoofFake.calls.find((c) => c.table === "tasks");
  assert.ok(spoofTasksCall?.steps.some((s) => s.args[1] === "user-good"));
});

// ---------------------------------------------------------------------------
// Rolling 14-day neglected window regression — proves defect fix and TZ handling
// ---------------------------------------------------------------------------

test("GET /api/friction/radar evidenceWindow is rolling 14-day local window (not calendar week)", async () => {
  const now = new Date("2026-04-22T12:00:00.000Z");
  const fake = new FakeSupabase();
  fake.push("tasks", { data: [], error: null });
  fake.push("goals", { data: [], error: null });
  // No user_time_context => UTC fallback; rolling start = 2026-04-08T00:00:00Z
  const res = await makeApp(fake, now).request("/api/friction/radar", { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.evidenceWindow.startIso, "2026-04-08T00:00:00.000Z");
  assert.equal(body.evidenceWindow.endIso, now.toISOString());
  // Must not be week window (Monday 2026-04-20)
  assert.notEqual(body.evidenceWindow.startIso, "2026-04-20T00:00:00.000Z");
});

test("GET /api/friction/radar neglected: 8 days ago not neglected, 13 days not neglected, >=14 neglected", async () => {
  const now = new Date("2026-04-22T12:00:00.000Z");
  const goals = [{ id: "g1", title: "G1", status: "active", updated_at: "2026-04-01T00:00:00.000Z", project_id: "p1" }];

  // 8 days ago => inside 14-day window (start 2026-04-08)
  const fake8 = new FakeSupabase();
  fake8.push("tasks", { data: [], error: null });
  fake8.push("goals", { data: goals, error: null });
  fake8.push("task_sessions", {
    data: [
      {
        id: "s1",
        task_id: "t1",
        started_at: new Date(now.getTime() - 8 * 86400000).toISOString(),
        ended_at: new Date(now.getTime() - 8 * 86400000 + 3600000).toISOString(),
        duration_seconds: 3600,
        tasks: { id: "t1", title: "T1", project_id: "p1", goal_id: "g1", projects: { id: "p1", name: "P1" }, goals: { id: "g1", title: "G1" } },
      },
    ],
    error: null,
  });
  const res8 = await makeApp(fake8, now).request("/api/friction/radar", { headers: AUTH });
  const body8 = await res8.json();
  assert.equal(body8.neglectedGoals.length, 0, "8 days ago should not be neglected");

  // 13 days ago still inside (2026-04-09)
  const fake13 = new FakeSupabase();
  fake13.push("tasks", { data: [], error: null });
  fake13.push("goals", { data: goals, error: null });
  fake13.push("task_sessions", {
    data: [
      {
        id: "s1",
        task_id: "t1",
        started_at: new Date(now.getTime() - 13 * 86400000).toISOString(),
        ended_at: new Date(now.getTime() - 13 * 86400000 + 3600000).toISOString(),
        duration_seconds: 3600,
        tasks: { id: "t1", title: "T1", project_id: "p1", goal_id: "g1", projects: { id: "p1", name: "P1" }, goals: { id: "g1", title: "G1" } },
      },
    ],
    error: null,
  });
  const res13 = await makeApp(fake13, now).request("/api/friction/radar", { headers: AUTH });
  const body13 = await res13.json();
  assert.equal(body13.neglectedGoals.length, 0, "13 days ago should not be neglected");

  // 15 days ago (before window start 2026-04-08) => neglected
  const fake15 = new FakeSupabase();
  fake15.push("tasks", { data: [], error: null });
  fake15.push("goals", { data: goals, error: null });
  fake15.push("task_sessions", {
    data: [
      {
        id: "s1",
        task_id: "t1",
        started_at: new Date(now.getTime() - 15 * 86400000).toISOString(),
        ended_at: new Date(now.getTime() - 15 * 86400000 + 3600000).toISOString(),
        duration_seconds: 3600,
        tasks: { id: "t1", title: "T1", project_id: "p1", goal_id: "g1", projects: { id: "p1", name: "P1" }, goals: { id: "g1", title: "G1" } },
      },
    ],
    error: null,
  });
  const res15 = await makeApp(fake15, now).request("/api/friction/radar", { headers: AUTH });
  const body15 = await res15.json();
  assert.equal(body15.neglectedGoals.length, 1, "15 days ago should be neglected");
  assert.equal(body15.neglectedGoals[0].id, "g1");
});

test("GET /api/friction/radar neglected Monday boundary — week defect would false-neglect but rolling does not", async () => {
  const mondayNow = new Date("2026-01-12T12:00:00.000Z"); // Monday
  const goals = [{ id: "g1", title: "G1", status: "active", updated_at: "2026-01-01T00:00:00.000Z", project_id: "p1" }];
  const sundaySession = {
    id: "s1",
    task_id: "t1",
    started_at: "2026-01-11T10:00:00.000Z", // Sunday
    ended_at: "2026-01-11T11:00:00.000Z",
    duration_seconds: 3600,
    tasks: { id: "t1", title: "T1", project_id: "p1", goal_id: "g1", projects: { id: "p1", name: "P1" }, goals: { id: "g1", title: "G1" } },
  };
  const fake = new FakeSupabase();
  fake.push("tasks", { data: [], error: null });
  fake.push("goals", { data: goals, error: null });
  fake.push("task_sessions", { data: [sundaySession], error: null });
  const res = await makeApp(fake, mondayNow).request("/api/friction/radar", { headers: AUTH });
  const body = await res.json();
  assert.equal(body.neglectedGoals.length, 0, "Sunday activity 1 day before Monday should not be neglected with rolling 14-day");
  assert.equal(body.evidenceWindow.startIso, "2025-12-29T00:00:00.000Z");
});

test("GET /api/friction/radar rolling window Tokyo timezone", async () => {
  const now = new Date("2026-01-15T03:00:00.000Z"); // 12:00 Tokyo
  const goals = [{ id: "g1", title: "G1", status: "active", updated_at: "2026-01-01T00:00:00.000Z", project_id: "p1" }];
  const fake = new FakeSupabase();
  fake.push("user_time_context", { data: { iana_timezone: "Asia/Tokyo" }, error: null });
  fake.push("tasks", { data: [], error: null });
  fake.push("goals", { data: goals, error: null });
  fake.push("task_sessions", {
    data: [
      {
        id: "s1",
        task_id: "t1",
        started_at: "2026-01-07T03:00:00.000Z", // 8 days ago Tokyo 12:00
        ended_at: "2026-01-07T04:00:00.000Z",
        duration_seconds: 3600,
        tasks: { id: "t1", title: "T1", project_id: "p1", goal_id: "g1", projects: { id: "p1", name: "P1" }, goals: { id: "g1", title: "G1" } },
      },
    ],
    error: null,
  });
  const res = await makeApp(fake, now).request("/api/friction/radar", { headers: AUTH });
  const body = await res.json();
  assert.equal(body.neglectedGoals.length, 0);
  // Window start for Tokyo 2026-01-15 is 14 days before => 2026-01-01 midnight Tokyo = 2025-12-31T15:00Z
  assert.equal(body.evidenceWindow.startIso, "2025-12-31T15:00:00.000Z");
});

test("GET /api/friction/radar rolling window New York timezone", async () => {
  const now = new Date("2026-01-15T12:00:00.000Z"); // 07:00 NY
  const goals = [{ id: "g1", title: "G1", status: "active", updated_at: "2026-01-01T00:00:00.000Z", project_id: "p1" }];
  const fake = new FakeSupabase();
  fake.push("user_time_context", { data: { iana_timezone: "America/New_York" }, error: null });
  fake.push("tasks", { data: [], error: null });
  fake.push("goals", { data: goals, error: null });
  fake.push("task_sessions", {
    data: [
      {
        id: "s1",
        task_id: "t1",
        started_at: new Date(now.getTime() - 8 * 86400000).toISOString(),
        ended_at: new Date(now.getTime() - 8 * 86400000 + 3600000).toISOString(),
        duration_seconds: 3600,
        tasks: { id: "t1", title: "T1", project_id: "p1", goal_id: "g1", projects: { id: "p1", name: "P1" }, goals: { id: "g1", title: "G1" } },
      },
    ],
    error: null,
  });
  const res = await makeApp(fake, now).request("/api/friction/radar", { headers: AUTH });
  const body = await res.json();
  assert.equal(body.neglectedGoals.length, 0);
  assert.equal(body.evidenceWindow.startIso, "2026-01-01T05:00:00.000Z");
});

test("GET /api/friction/radar DST spring forward and fall back windows correct", async () => {
  // Spring forward: NY 2026-03-08 23h day, window should still be 14 local days
  const springNow = new Date("2026-03-09T12:00:00.000Z");
  const fakeSpring = new FakeSupabase();
  fakeSpring.push("user_time_context", { data: { iana_timezone: "America/New_York" }, error: null });
  fakeSpring.push("tasks", { data: [], error: null });
  fakeSpring.push("goals", { data: [], error: null });
  fakeSpring.push("task_sessions", { data: [], error: null });
  const resSpring = await makeApp(fakeSpring, springNow).request("/api/friction/radar", { headers: AUTH });
  const bodySpring = await resSpring.json();
  assert.equal(bodySpring.evidenceWindow.startIso, "2026-02-23T05:00:00.000Z");

  // Fall back: NY 2026-11-01 25h day
  const fallNow = new Date("2026-11-02T12:00:00.000Z");
  const fakeFall = new FakeSupabase();
  fakeFall.push("user_time_context", { data: { iana_timezone: "America/New_York" }, error: null });
  fakeFall.push("tasks", { data: [], error: null });
  fakeFall.push("goals", { data: [], error: null });
  fakeFall.push("task_sessions", { data: [], error: null });
  const resFall = await makeApp(fakeFall, fallNow).request("/api/friction/radar", { headers: AUTH });
  const bodyFall = await resFall.json();
  assert.equal(bodyFall.evidenceWindow.startIso, "2026-10-19T04:00:00.000Z");
});

test("GET /api/friction/radar server TZ independence", async () => {
  const originalTz = process.env.TZ;
  try {
    const now = new Date("2026-04-22T12:00:00.000Z");
    process.env.TZ = "Asia/Tokyo";
    const fake1 = new FakeSupabase();
    fake1.push("user_time_context", { data: { iana_timezone: "America/New_York" }, error: null });
    fake1.push("tasks", { data: [], error: null });
    fake1.push("goals", { data: [], error: null });
    fake1.push("task_sessions", { data: [], error: null });
    const res1 = await makeApp(fake1, now).request("/api/friction/radar", { headers: AUTH });
    const body1 = await res1.json();

    process.env.TZ = "UTC";
    const fake2 = new FakeSupabase();
    fake2.push("user_time_context", { data: { iana_timezone: "America/New_York" }, error: null });
    fake2.push("tasks", { data: [], error: null });
    fake2.push("goals", { data: [], error: null });
    fake2.push("task_sessions", { data: [], error: null });
    const res2 = await makeApp(fake2, now).request("/api/friction/radar", { headers: AUTH });
    const body2 = await res2.json();

    assert.deepEqual(body1.evidenceWindow, body2.evidenceWindow);
    assert.equal(body1.evidenceWindow.startIso, "2026-04-08T04:00:00.000Z"); // NY 14 days before 2026-04-22
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});
