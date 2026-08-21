import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp, type ServerDependencies } from "../src/index";
import { resolvePort } from "../src/port";

/**
 * Controlled transport tests. The app receives a fake token verifier and a
 * fake/controlled Supabase client (same pattern as
 * packages/data-access/test/data-access.test.ts), so every test proves the
 * HTTP contract, the owner scoping, and the identity rules without any
 * network access.
 */

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

type ChainStep = { method: string; args: unknown[] };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: ChainStep[] }> = [];

  from(table: string) {
    return new FakeQueryBuilder(table, this);
  }

  pushResult(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  popResult(table: string): QueryResult {
    const queue = this.queues.get(table) ?? [];
    const result = queue.shift();
    return result ?? { data: null, error: null };
  }

  record(table: string, steps: ChainStep[]) {
    this.calls.push({ table, steps });
  }
}

class FakeQueryBuilder {
  private readonly steps: ChainStep[] = [];

  constructor(
    private readonly table: string,
    private readonly supabase: FakeSupabase,
  ) {}

  select(columns: string) {
    this.steps.push({ method: "select", args: [columns] });
    return this;
  }

  eq(column: string, value: unknown) {
    this.steps.push({ method: "eq", args: [column, value] });
    return this;
  }

  neq(column: string, value: unknown) {
    this.steps.push({ method: "neq", args: [column, value] });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.steps.push({ method: "in", args: [column, values] });
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    this.steps.push({ method: "not", args: [column, operator, value] });
    return this;
  }

  order(column: string, options?: unknown) {
    this.steps.push({ method: "order", args: [column, options] });
    return this;
  }

  maybeSingle() {
    this.steps.push({ method: "maybeSingle", args: [] });
    return this;
  }

  insert(payload: unknown) {
    this.steps.push({ method: "insert", args: [payload] });
    return this;
  }

  update(payload: unknown) {
    this.steps.push({ method: "update", args: [payload] });
    return this;
  }

  then<TResult1, TResult2>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.supabase.record(this.table, this.steps);
    return Promise.resolve(this.supabase.popResult(this.table)).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(): FakeSupabase {
  return new FakeSupabase();
}

const FIXED_NOW = "2026-05-01T00:00:00.000Z";

const TOKENS: Record<string, string> = {
  "token-user-123": "user-123",
};

function makeApp(
  fake: FakeSupabase,
  overrides: Partial<ServerDependencies> = {},
) {
  return createApp({
    verifyToken: async (token) => TOKENS[token] ?? null,
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date(FIXED_NOW),
    ...overrides,
  });
}

const AUTH = { authorization: "Bearer token-user-123" };
const JSON_HEADERS = { "content-type": "application/json" };

function stepsFor(fake: FakeSupabase, index = 0) {
  return fake.calls[index]?.steps ?? [];
}

function insertStep(fake: FakeSupabase, table: string) {
  const call = fake.calls.find((call) => call.table === table);
  return call?.steps.find((step) => step.method === "insert");
}

function updateSteps(fake: FakeSupabase, table: string) {
  const call = fake.calls.find((call) => call.table === table);
  return call?.steps.filter((step) => step.method === "update") ?? [];
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test("rejects requests without an Authorization header", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { code: "UNAUTHENTICATED", message: "Authentication required." },
  });
});

test("rejects requests with a non-Bearer scheme", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects", {
    headers: { authorization: "Basic dXNlcjpwYXNz" },
  });

  assert.equal(response.status, 401);
});

test("rejects an empty Bearer token", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects", {
    headers: { authorization: "Bearer   " },
  });

  assert.equal(response.status, 401);
});

test("rejects an invalid token after server-side verification", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects", {
    headers: { authorization: "Bearer token-invalid" },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: { code: "UNAUTHENTICATED", message: "Authentication required." },
  });
});

test("health endpoint does not require authentication", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

// ---------------------------------------------------------------------------
// Port resolution
// ---------------------------------------------------------------------------

test("resolvePort accepts a valid port string", () => {
  assert.equal(resolvePort("8080"), 8080);
  assert.equal(resolvePort("1"), 1);
  assert.equal(resolvePort("65535"), 65535);
});

test("resolvePort falls back to the default when PORT is unset or blank", () => {
  assert.equal(resolvePort(undefined), 3001);
  assert.equal(resolvePort(""), 3001);
  assert.equal(resolvePort("   "), 3001);
});

test("resolvePort falls back on NaN and non-integer values", () => {
  assert.equal(resolvePort("abc"), 3001);
  assert.equal(resolvePort("NaN"), 3001);
  assert.equal(resolvePort("3001.5"), 3001);
});

test("resolvePort falls back on out-of-range ports", () => {
  assert.equal(resolvePort("0"), 3001);
  assert.equal(resolvePort("-1"), 3001);
  assert.equal(resolvePort("65536"), 3001);
  assert.equal(resolvePort("99999"), 3001);
});

test("resolvePort honors an explicit fallback", () => {
  assert.equal(resolvePort("bogus", 4000), 4000);
  assert.equal(resolvePort("5150", 4000), 5150);
});

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

test("ready endpoint does not require authentication and reports config-ok without a probe", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/ready");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("ready endpoint returns 200 when the readiness probe succeeds", async () => {
  const app = makeApp(fakeSupabase(), {
    readinessCheck: async () => true,
  });

  const response = await app.request("/ready");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("ready endpoint returns 503 when the readiness probe fails", async () => {
  const app = makeApp(fakeSupabase(), {
    readinessCheck: async () => false,
  });

  const response = await app.request("/ready");

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

test("ready endpoint stays liveness-independent from /health", async () => {
  const app = makeApp(fakeSupabase(), {
    readinessCheck: async () => false,
  });

  const health = await app.request("/health");
  assert.equal(health.status, 200);

  const ready = await app.request("/ready");
  assert.equal(ready.status, 503);
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

test("CORS is disabled by default", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects", {
    headers: { origin: "https://app.example.com", ...AUTH },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("CORS allowlist echoes allowed origins when configured", async () => {
  const app = makeApp(fakeSupabase(), {
    corsOrigins: ["https://app.example.com"],
  });

  const response = await app.request("/api/projects", {
    headers: { origin: "https://app.example.com", ...AUTH },
  });

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://app.example.com",
  );
});

test("CORS allowlist rejects non-allowed origins", async () => {
  const app = makeApp(fakeSupabase(), {
    corsOrigins: ["https://app.example.com"],
  });

  const response = await app.request("/api/projects", {
    headers: { origin: "https://evil.example.com", ...AUTH },
  });

  assert.equal(
    response.headers.get("access-control-allow-origin"),
    null,
  );
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

test("POST /api/projects creates a project scoped to the verified actor", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/projects", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ name: "Home Renovation", slug: "Home Renovation!", description: "Kitchen" }),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.values, {
    name: "Home Renovation",
    slug: "home-renovation",
    description: "Kitchen",
  });

  const insert = insertStep(fake, "projects");
  assert.ok(insert);
  assert.deepEqual(insert.args[0], {
    name: "Home Renovation",
    slug: "home-renovation",
    description: "Kitchen",
    owner_user_id: "user-123",
  });
});

test("POST /api/projects never takes identity from the body", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/projects", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({
      name: "Sneaky",
      slug: "sneaky",
      userId: "attacker-1",
      ownerId: "attacker-1",
      owner_user_id: "attacker-1",
    }),
  });

  assert.equal(response.status, 201);

  const insert = insertStep(fake, "projects");
  assert.ok(insert);
  assert.equal((insert.args[0] as Record<string, unknown>).owner_user_id, "user-123");
});

test("POST /api/projects rejects a missing name with the application message", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ slug: "no-name" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Project name is required." },
  });
});

test("POST /api/projects maps a duplicate slug conflict to a 400 with the conflict message", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: { code: "23505" } });
  const app = makeApp(fake);

  const response = await app.request("/api/projects", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ name: "Duplicate", slug: "duplicate" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "VALIDATION",
      message: "That slug is already in use. Choose a different slug.",
    },
  });
});

test("POST /api/projects rejects an invalid JSON body", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: "{not json",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Request body must be valid JSON." },
  });
});

test("GET /api/projects returns the read model with the view filter and owner scoping", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: [
      {
        id: "project-1",
        name: "Home Renovation",
        slug: "home-renovation",
        description: "Kitchen",
        status: "archived",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-02-01T00:00:00.000Z",
      },
    ],
    error: null,
  });
  fake.pushResult("projects", {
    data: [{ status: "archived" }, { status: "active" }],
    error: null,
  });
  fake.pushResult("tasks", {
    data: [
      {
        id: "task-1",
        project_id: "project-1",
        title: "Paint",
        status: "done",
        priority: "high",
        updated_at: "2026-02-02T00:00:00.000Z",
      },
    ],
    error: null,
  });
  const app = makeApp(fake);

  const response = await app.request("/api/projects?view=archived", {
    headers: AUTH,
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].slug, "home-renovation");
  assert.equal(body.projects[0].taskCount, 1);
  assert.equal(body.projects[0].progressPercent, 100);
  assert.deepEqual(body.summary, { total: 2, active: 1, completed: 0, archived: 1 });

  const listCall = fake.calls[0];
  assert.equal(listCall.table, "projects");
  assert.ok(
    stepsFor(fake, 0).some((step) => step.method === "eq" && step.args[0] === "status" && step.args[1] === "archived"),
  );
  assert.ok(
    stepsFor(fake, 0).some(
      (step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
    ),
  );
});

test("GET /api/projects defaults the view to active", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [], error: null });
  fake.pushResult("projects", { data: [], error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/projects", { headers: AUTH });

  assert.equal(response.status, 200);
  assert.ok(
    stepsFor(fake, 0).some((step) => step.method === "neq" && step.args[0] === "status" && step.args[1] === "archived"),
  );
});

test("GET /api/projects maps a read-model failure to 500", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: { code: "PGRST500" } });
  fake.pushResult("projects", { data: [], error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/projects", { headers: AUTH });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "INTERNAL", message: "Unable to load projects right now." },
  });
});

test("PATCH /api/projects/:id/status updates scoped by id and owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/projects/project-1/status", {
    method: "PATCH",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ status: "paused" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "id" && step.args[1] === "project-1"));
  assert.ok(
    steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"),
  );
  const update = steps.find((step) => step.method === "update");
  assert.ok(update);
  assert.deepEqual(update.args[0], { status: "paused", updated_at: FIXED_NOW });
});

test("PATCH /api/projects/:id/status rejects an invalid status", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects/project-1/status", {
    method: "PATCH",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ status: "bogus" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Project update request is invalid." },
  });
});

test("POST /api/projects/:id/archive writes the archived status", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/projects/project-1/archive", {
    method: "POST",
    headers: AUTH,
  });

  assert.equal(response.status, 200);
  const update = updateSteps(fake, "projects")[0];
  assert.ok(update);
  assert.deepEqual(update.args[0], { status: "archived", updated_at: FIXED_NOW });
});

test("POST /api/projects/:id/unarchive writes the active status", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/projects/project-1/unarchive", {
    method: "POST",
    headers: AUTH,
  });

  assert.equal(response.status, 200);
  const update = updateSteps(fake, "projects")[0];
  assert.ok(update);
  assert.deepEqual(update.args[0], { status: "active", updated_at: FIXED_NOW });
});

test("GET /api/projects/:slug returns the project identity read model", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: {
      id: "project-1",
      name: "Home Renovation",
      slug: "home-renovation",
      description: "Kitchen",
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    },
    error: null,
  });
  fake.pushResult("goals", {
    data: [{ id: "goal-1", title: "Finish kitchen", project_id: "project-1" }],
    error: null,
  });
  const app = makeApp(fake);

  const response = await app.request("/api/projects/home-renovation", { headers: AUTH });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.project.id, "project-1");
  assert.equal(body.goals.length, 1);
  assert.equal(body.goals[0].title, "Finish kitchen");

  assert.ok(
    stepsFor(fake, 0).some((step) => step.method === "eq" && step.args[0] === "slug" && step.args[1] === "home-renovation"),
  );
  assert.ok(
    stepsFor(fake, 0).some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"),
  );
});

test("GET /api/projects/:slug returns 404 for a missing project", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/projects/missing", { headers: AUTH });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "NOT_FOUND", message: "Project not found." },
  });
});

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

test("GET /api/goals returns the goals read model with owner scoping", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", {
    data: [{ id: "project-1", name: "Home Renovation" }],
    error: null,
  });
  fake.pushResult("goals", {
    data: [
      {
        id: "goal-1",
        project_id: "project-1",
        title: "Finish kitchen",
        slug: "finish-kitchen",
        description: "Cabinets",
        next_step: "Order countertop",
        health: "on_track",
        status: "active",
        created_at: "2026-01-10T00:00:00.000Z",
        updated_at: "2026-02-10T00:00:00.000Z",
      },
    ],
    error: null,
  });
  fake.pushResult("tasks", {
    data: [{ id: "task-1", title: "Paint", status: "done", goal_id: "goal-1" }],
    error: null,
  });
  fake.pushResult("goals", {
    data: [{ status: "active" }],
    error: null,
  });
  const app = makeApp(fake);

  const response = await app.request("/api/goals?view=all", { headers: AUTH });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.goals.length, 1);
  assert.equal(body.goals[0].projectName, "Home Renovation");
  assert.equal(body.goals[0].progressPercent, 100);
  assert.deepEqual(body.summary, { total: 1, active: 1, completed: 0, archived: 0 });

  const goalsCall = fake.calls.find((call) => call.table === "goals" && call.steps.some((s) => s.method === "select" && String(s.args[0]).includes("next_step")));
  assert.ok(goalsCall);
  assert.ok(
    goalsCall.steps.some(
      (step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123",
    ),
  );
});

test("POST /api/goals creates a goal scoped to the verified actor", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/goals", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({
      title: "Finish kitchen",
      projectId: "project-1",
      description: "Cabinets",
      nextStep: "Order countertop",
      health: "on_track",
      status: "active",
      slug: "Finish Kitchen!",
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.values, {
    title: "Finish kitchen",
    projectId: "project-1",
    description: "Cabinets",
    nextStep: "Order countertop",
    health: "on_track",
    status: "active",
    slug: "finish-kitchen",
  });

  const insert = insertStep(fake, "goals");
  assert.ok(insert);
  assert.deepEqual(insert.args[0], {
    title: "Finish kitchen",
    project_id: "project-1",
    description: "Cabinets",
    next_step: "Order countertop",
    health: "on_track",
    status: "active",
    slug: "finish-kitchen",
    owner_user_id: "user-123",
  });
});

test("POST /api/goals ignores any identity fields in the body", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/goals", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({
      title: "Sneaky goal",
      projectId: "project-1",
      userId: "attacker-1",
      ownerId: "attacker-1",
    }),
  });

  assert.equal(response.status, 201);
  const insert = insertStep(fake, "goals");
  assert.ok(insert);
  assert.equal((insert.args[0] as Record<string, unknown>).owner_user_id, "user-123");
});

test("POST /api/goals rejects a missing title with the application message", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/goals", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ projectId: "project-1" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Goal title is required." },
  });
});

test("POST /api/goals rejects an invalid status with the allowed values message", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/goals", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ title: "X", projectId: "project-1", status: "bogus" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Status must be one of: draft, active, done, paused." },
  });
});

test("PATCH /api/goals/:id/status updates scoped by id and owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/goals/goal-1/status", {
    method: "PATCH",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ status: "done" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const steps = stepsFor(fake);
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "id" && step.args[1] === "goal-1"));
  assert.ok(steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
  const update = steps.find((step) => step.method === "update");
  assert.ok(update);
  assert.deepEqual(update.args[0], { status: "done", updated_at: FIXED_NOW });
});

test("PATCH /api/goals/:id/health rejects an invalid health value", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/goals/goal-1/health", {
    method: "PATCH",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ health: "bogus" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Health must be one of: on_track, at_risk, off_track." },
  });
});

test("PATCH /api/goals/:id/next-step updates the next step", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/goals/goal-1/next-step", {
    method: "PATCH",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ nextStep: "Call the architect" }),
  });

  assert.equal(response.status, 200);
  const update = updateSteps(fake, "goals")[0];
  assert.ok(update);
  assert.deepEqual(update.args[0], { next_step: "Call the architect", updated_at: FIXED_NOW });
});

test("POST /api/goals/:id/archive writes the archived status", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/goals/goal-1/archive", {
    method: "POST",
    headers: AUTH,
  });

  assert.equal(response.status, 200);
  const update = updateSteps(fake, "goals")[0];
  assert.ok(update);
  assert.deepEqual(update.args[0], { status: "archived", updated_at: FIXED_NOW });
});

test("POST /api/goals/:id/unarchive writes the active status", async () => {
  const fake = fakeSupabase();
  fake.pushResult("goals", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request("/api/goals/goal-1/unarchive", {
    method: "POST",
    headers: AUTH,
  });

  assert.equal(response.status, 200);
  const update = updateSteps(fake, "goals")[0];
  assert.ok(update);
  assert.deepEqual(update.args[0], { status: "active", updated_at: FIXED_NOW });
});

test("unknown routes return a JSON 404", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request("/api/projects/project-1/delete", {
    method: "POST",
    headers: AUTH,
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "NOT_FOUND", message: "Route not found." },
  });
});
