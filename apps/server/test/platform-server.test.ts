import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp, type ServerDependencies } from "../src/app";
import { resolveServerPort } from "../src/serve";

const AUTH = { authorization: "Bearer good" };
const JSON_HEADERS = { ...AUTH, "content-type": "application/json" };

type Result = { data: unknown; error: { code?: string; message?: string } | null };

class FakeSupabase {
  queues = new Map<string, Result[]>();
  calls: Array<{ table: string; steps: Array<{ method: string; args: unknown[] }> }> = [];

  from(table: string) {
    return new Builder(table, this);
  }

  push(table: string, result: Result) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pop(table: string): Result {
    return this.queues.get(table)?.shift() ?? { data: null, error: null };
  }
}

class Builder {
  steps: Array<{ method: string; args: unknown[] }> = [];
  constructor(
    private table: string,
    private fake: FakeSupabase,
  ) {}
  select(...args: unknown[]) { this.steps.push({ method: "select", args }); return this; }
  eq(...args: unknown[]) { this.steps.push({ method: "eq", args }); return this; }
  is(...args: unknown[]) { this.steps.push({ method: "is", args }); return this; }
  order(...args: unknown[]) { this.steps.push({ method: "order", args }); return this; }
  limit(...args: unknown[]) { this.steps.push({ method: "limit", args }); return this; }
  maybeSingle(...args: unknown[]) { this.steps.push({ method: "maybeSingle", args }); return this; }
  single(...args: unknown[]) { this.steps.push({ method: "single", args }); return this; }
  insert(payload: unknown) {
    this.steps.push({ method: "insert", args: [payload] });
    return this;
  }
  update(payload: unknown) {
    this.steps.push({ method: "update", args: [payload] });
    return this;
  }
  then<A, B>(
    ok?: ((value: Result) => A | PromiseLike<A>) | null,
    fail?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.fake.calls.push({ table: this.table, steps: this.steps });
    return Promise.resolve(this.fake.pop(this.table)).then(ok, fail);
  }
}

function makeApp(fake: FakeSupabase, overrides: Partial<ServerDependencies> = {}) {
  return createApp({
    verifyToken: async (token) => (token === "good" ? "user-123" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date("2026-08-10T12:00:00Z"),
    ...overrides,
  });
}

function authDeps(): Partial<ServerDependencies> {
  return {
    authenticateWithPassword: async (email, password) =>
      email === "user@example.com" && password === "secret"
        ? {
            ok: true,
            user: { id: "user-123", email: "user@example.com" },
            session: { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 1800000000 },
          }
        : { ok: false, message: "Email or password is incorrect." },
    refreshAuthSession: async (refreshToken) =>
      refreshToken === "refresh-1"
        ? {
            ok: true,
            user: { id: "user-123", email: "user@example.com" },
            session: { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: 1800003600 },
          }
        : { ok: false, message: "Session expired. Sign in again." },
    signOutToken: async () => {},
  };
}

test("POST /api/auth/session issues a mobile session without bearer auth", async () => {
  const app = makeApp(new FakeSupabase(), authDeps());

  const response = await app.request("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", password: "secret" }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.user, { id: "user-123", email: "user@example.com" });
  assert.deepEqual(body.session, { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 1800000000 });
});

test("POST /api/auth/session rejects bad credentials and missing fields", async () => {
  const app = makeApp(new FakeSupabase(), authDeps());

  const bad = await app.request("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", password: "wrong" }),
  });
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error.code, "INVALID_CREDENTIALS");

  const missing = await app.request("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "" }),
  });
  assert.equal(missing.status, 400);
});

test("POST /api/auth/refresh rotates the session and rejects dead tokens", async () => {
  const app = makeApp(new FakeSupabase(), authDeps());

  const okResponse = await app.request("/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: "refresh-1" }),
  });
  assert.equal(okResponse.status, 200);
  assert.equal((await okResponse.json()).session.accessToken, "access-2");

  const expired = await app.request("/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: "stale" }),
  });
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).error.code, "SESSION_EXPIRED");
});

test("POST /api/auth/logout requires a verified bearer token", async () => {
  let signedOut: string | null = null;
  const app = makeApp(new FakeSupabase(), {
    ...authDeps(),
    signOutToken: async (token) => {
      signedOut = token;
    },
  });

  const unauthenticated = await app.request("/api/auth/logout", { method: "POST" });
  assert.equal(unauthenticated.status, 401);

  const okResponse = await app.request("/api/auth/logout", { method: "POST", headers: AUTH });
  assert.equal(okResponse.status, 200);
  assert.deepEqual(await okResponse.json(), { ok: true });
  assert.equal(signedOut, "good");
});

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    task_id: "task-1",
    started_at: "2026-08-10T11:00:00.000Z",
    ended_at: null,
    duration_seconds: null,
    tasks: { title: "Focus work" },
    ...overrides,
  };
}

test("GET /api/timer/workspace returns active session and summary", async () => {
  const fake = new FakeSupabase();
  fake.push("task_sessions", { data: [sessionRow()], error: null });
  fake.push("task_sessions", {
    data: [
      sessionRow(),
      {
        id: "session-0",
        task_id: "task-0",
        started_at: "2026-08-10T06:00:00.000Z",
        ended_at: "2026-08-10T07:00:00.000Z",
        duration_seconds: 3600,
        tasks: { title: "Earlier" },
      },
    ],
    error: null,
  });

  const response = await makeApp(fake).request("/api/timer/workspace", { headers: AUTH });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.activeSession, {
    sessionId: "session-1",
    taskId: "task-1",
    startedAt: "2026-08-10T11:00:00.000Z",
    elapsedLabel: "1h 0m 0s",
    taskTitle: "Focus work",
  });
  assert.equal(body.summary.trackedTodaySeconds, 7200);
  assert.equal(body.summary.trackedTodayLabel, "2h 0m 0s");

  const firstCall = fake.calls[0];
  assert.ok(firstCall?.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id"));
  assert.ok(firstCall?.steps.some((step) => step.method === "is" && step.args[0] === "ended_at" && step.args[1] === null));
});

test("POST /api/timer/start enforces single-active and inserts an owned open session", async () => {
  const fake = new FakeSupabase();
  fake.push("tasks", { data: { id: "task-1", title: "Focus work", status: "todo", archived_at: null }, error: null });
  fake.push("task_sessions", { data: [], error: null });
  fake.push("task_sessions", { data: sessionRow(), error: null });

  const response = await makeApp(fake).request("/api/timer/start", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ taskId: "task-1" }),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.activeSession.taskTitle, "Focus work");

  const insert = fake.calls.flatMap((call) => call.steps).find(
    (step) => step.method === "insert",
  );
  assert.ok(insert);
  assert.equal((insert.args[0] as Record<string, unknown>).owner_user_id, "user-123");
});

test("POST /api/timer/start rejects a second concurrent session", async () => {
  const fake = new FakeSupabase();
  fake.push("tasks", { data: { id: "task-1", title: "Focus work", status: "todo", archived_at: null }, error: null });
  fake.push("task_sessions", { data: [sessionRow()], error: null });

  const response = await makeApp(fake).request("/api/timer/start", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ taskId: "task-1" }),
  });

  assert.equal(response.status, 400);
  assert.match((await response.json()).error.message, /already running/);
});

test("POST /api/timer/stop finalizes the open session with computed duration", async () => {
  const fake = new FakeSupabase();
  fake.push("task_sessions", { data: [sessionRow()], error: null });
  fake.push("task_sessions", { data: [{ id: "session-1" }], error: null });

  const response = await makeApp(fake).request("/api/timer/stop", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({}),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sessionId: "session-1", taskId: "task-1" });

  const finalizeCall = fake.calls.filter((call) => call.table === "task_sessions")[1];
  const update = finalizeCall?.steps.find((step) => step.method === "update");
  assert.ok(update);
  assert.equal((update.args[0] as Record<string, unknown>).duration_seconds, 3600);
  assert.ok(finalizeCall?.steps.some(
    (step) => step.method === "is" && step.args[0] === "ended_at" && step.args[1] === null,
  ));
});

test("GET /ready reports dependency health through injected probe", async () => {
  const healthy = makeApp(new FakeSupabase(), { checkReadiness: async () => true });
  assert.equal((await healthy.request("/ready")).status, 200);

  const unhealthy = makeApp(new FakeSupabase(), { checkReadiness: async () => false });
  const response = await unhealthy.request("/ready");
  assert.equal(response.status, 503);
});

test("resolveServerPort validates PORT strictly", () => {
  assert.equal(resolveServerPort(undefined), 3001);
  assert.equal(resolveServerPort(""), 3001);
  assert.equal(resolveServerPort("8080"), 8080);
  assert.throws(() => resolveServerPort("abc"));
  assert.throws(() => resolveServerPort("0"));
  assert.throws(() => resolveServerPort("70000"));
  assert.throws(() => resolveServerPort("3.5"));
});
