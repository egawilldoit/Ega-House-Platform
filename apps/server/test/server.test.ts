import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp, type ServerDependencies } from "../src/index";

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
  count?: number | null;
};

type ChainStep = { method: string; args: unknown[] };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: ChainStep[] }> = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  from(table: string) {
    return new FakeQueryBuilder(table, this);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return {
      then: (fulfilled: (value: QueryResult) => unknown) =>
        Promise.resolve(this.popResult(`rpc:${name}`)).then(fulfilled),
    } as unknown as Promise<QueryResult>;
  }

  pushResult(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pushRpcResult(name: string, result: QueryResult) {
    this.pushResult(`rpc:${name}`, result);
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

  is(column: string, value: unknown) {
    this.steps.push({ method: "is", args: [column, value] });
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

  delete() {
    this.steps.push({ method: "delete", args: [] });
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

const ARCHIVED_PROJECT_ROW = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  name: "Home Renovation",
  slug: "home-renovation",
  description: "Kitchen",
  status: "archived",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-02-01T00:00:00.000Z",
};

const DELETE_PROJECT_PATH = `/api/projects/${ARCHIVED_PROJECT_ROW.id}`;

function queueEligibleArchivedDelete(fake: FakeSupabase) {
  fake.pushResult("projects", { data: ARCHIVED_PROJECT_ROW, error: null });
  fake.pushResult("tasks", { data: [], error: null });
  fake.pushResult("goals", { data: [], error: null });
  fake.pushResult("projects", { data: [{ id: ARCHIVED_PROJECT_ROW.id }], error: null });
}

test("DELETE /api/projects/:id removes an eligible archived project", async () => {
  const fake = fakeSupabase();
  queueEligibleArchivedDelete(fake);
  const app = makeApp(fake);

  const response = await app.request(DELETE_PROJECT_PATH, {
    method: "DELETE",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ userId: "attacker", projectId: "other" }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });

  const calls = fake.calls.filter((call) => call.table === "projects");
  const remove = calls.find((call) => call.steps.some((step) => step.method === "delete"));
  assert.ok(remove);
  assert.ok(remove.steps.some((step) => step.method === "eq" && step.args[0] === "id" && step.args[1] === ARCHIVED_PROJECT_ROW.id));
  assert.ok(remove.steps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
  assert.ok(remove.steps.some((step) => step.method === "eq" && step.args[0] === "status" && step.args[1] === "archived"));
});

test("DELETE /api/projects/:id requires authentication", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request(DELETE_PROJECT_PATH, { method: "DELETE" });

  assert.equal(response.status, 401);
});

test("DELETE /api/projects/:id rejects a malformed id before the database", async () => {
  const fake = fakeSupabase();
  const app = makeApp(fake);

  const response = await app.request("/api/projects/not-a-uuid", {
    method: "DELETE",
    headers: AUTH,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Project delete request is invalid." },
  });
  assert.equal(fake.calls.length, 0);
});

test("DELETE /api/projects/:id rejects every non-archived status with 400", async () => {
  for (const status of ["planned", "active", "done", "paused"]) {
    const fake = fakeSupabase();
    fake.pushResult("projects", { data: { ...ARCHIVED_PROJECT_ROW, status }, error: null });
    const app = makeApp(fake);

    const response = await app.request(DELETE_PROJECT_PATH, {
      method: "DELETE",
      headers: AUTH,
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: "VALIDATION", message: "Only archived projects can be permanently deleted." },
    });
    assert.ok(!fake.calls.some((call) => call.steps.some((step) => step.method === "delete")));
  }
});

test("DELETE /api/projects/:id returns 409 when linked tasks remain", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: ARCHIVED_PROJECT_ROW, error: null });
  fake.pushResult("tasks", {
    data: [{ id: "task-1", project_id: "project-1", title: "Paint", status: "todo", priority: "high", updated_at: "2026-02-02T00:00:00.000Z" }],
    error: null,
  });
  fake.pushResult("goals", { data: [], error: null });
  const app = makeApp(fake);

  const response = await app.request(DELETE_PROJECT_PATH, {
    method: "DELETE",
    headers: AUTH,
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "VALIDATION",
      message: "This project still has linked tasks. Move or remove them before permanently deleting the project.",
    },
  });
});

test("DELETE /api/projects/:id returns 409 when linked goals remain", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: ARCHIVED_PROJECT_ROW, error: null });
  fake.pushResult("tasks", { data: [], error: null });
  fake.pushResult("goals", { data: [{ id: "goal-1", title: "Finish kitchen", project_id: "project-1" }], error: null });
  const app = makeApp(fake);

  const response = await app.request(DELETE_PROJECT_PATH, {
    method: "DELETE",
    headers: AUTH,
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "VALIDATION",
      message: "This project still has linked goals. Move or remove them before permanently deleting the project.",
    },
  });
});

test("DELETE /api/projects/:id returns 404 for a missing or foreign project", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request(DELETE_PROJECT_PATH, {
    method: "DELETE",
    headers: AUTH,
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "NOT_FOUND", message: "Project not found." },
  });
});

test("DELETE /api/projects/:id maps a foreign-key race to 409", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: ARCHIVED_PROJECT_ROW, error: null });
  fake.pushResult("tasks", { data: [], error: null });
  fake.pushResult("goals", { data: [], error: null });
  fake.pushResult("projects", { data: null, error: { code: "23503", message: "violates foreign key constraint" } });
  const app = makeApp(fake);

  const response = await app.request(DELETE_PROJECT_PATH, {
    method: "DELETE",
    headers: AUTH,
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "VALIDATION",
      message: "This project still has linked tasks or goals. Move or remove them before permanently deleting the project.",
    },
  });
});

test("DELETE /api/projects/:id maps a persistence failure to sanitized 500", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: ARCHIVED_PROJECT_ROW, error: null });
  fake.pushResult("tasks", { data: [], error: null });
  fake.pushResult("goals", { data: [], error: null });
  fake.pushResult("projects", { data: null, error: { code: "PGRST500" } });
  const app = makeApp(fake);

  const response = await app.request(DELETE_PROJECT_PATH, {
    method: "DELETE",
    headers: AUTH,
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "INTERNAL", message: "Unable to delete project right now." },
  });
});

const PURGE_PROJECT_ID = ARCHIVED_PROJECT_ROW.id;
const PREVIEW_PATH = `/api/projects/${PURGE_PROJECT_ID}/purge-preview`;
const PURGE_PATH = `/api/projects/${PURGE_PROJECT_ID}/purge`;

function queuePurgePreview(fake: FakeSupabase) {
  fake.pushResult("projects", {
    data: { ...ARCHIVED_PROJECT_ROW, name: "Stage CGI" },
    error: null,
  });
  fake.pushResult("projects", {
    data: { id: PURGE_PROJECT_ID, name: "Stage CGI" },
    error: null,
  });
  fake.pushResult("tasks", {
    data: [{ id: "task-1", calendar_event_id: "event-1" }],
    error: null,
  });
  fake.pushResult("goals", { data: [{ id: "goal-1" }], error: null });
  fake.pushResult("task_sessions", { data: null, error: null, count: 2 });
  fake.pushResult("task_sessions", { data: null, error: null, count: 1 });
  fake.pushResult("task_reminders", { data: null, error: null, count: 1 });
  fake.pushResult("task_recurrences", { data: null, error: null, count: 0 });
  fake.pushResult("task_external_refs", { data: null, error: null, count: 0 });
  fake.pushResult("notifications", { data: null, error: null, count: 1 });
}

function purgeBody(overrides: Record<string, unknown> = {}) {
  return {
    confirmationName: "Stage CGI",
    expectedTaskCount: 1,
    expectedGoalCount: 1,
    ...overrides,
  };
}

function queuePurgeProject(fake: FakeSupabase) {
  fake.pushResult("projects", {
    data: { ...ARCHIVED_PROJECT_ROW, name: "Stage CGI" },
    error: null,
  });
}

test("GET /api/projects/:id/purge-preview requires authentication", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request(PREVIEW_PATH);

  assert.equal(response.status, 401);
});

test("GET /api/projects/:id/purge-preview rejects a malformed id", async () => {
  const fake = fakeSupabase();
  const app = makeApp(fake);

  const response = await app.request("/api/projects/not-a-uuid/purge-preview", {
    headers: AUTH,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Project purge preview request is invalid." },
  });
  assert.equal(fake.calls.length, 0);
});

test("GET /api/projects/:id/purge-preview returns 404 for a missing or foreign project", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request(PREVIEW_PATH, { headers: AUTH });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "NOT_FOUND", message: "Project not found." },
  });
});

test("GET /api/projects/:id/purge-preview rejects a non-archived project", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: { ...ARCHIVED_PROJECT_ROW, status: "active" }, error: null });
  const app = makeApp(fake);

  const response = await app.request(PREVIEW_PATH, { headers: AUTH });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Only archived projects can be permanently deleted." },
  });
});

test("GET /api/projects/:id/purge-preview returns the deletion impact", async () => {
  const fake = fakeSupabase();
  queuePurgePreview(fake);
  const app = makeApp(fake);

  const response = await app.request(PREVIEW_PATH, { headers: AUTH });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: PURGE_PROJECT_ID,
    projectName: "Stage CGI",
    impact: {
      taskCount: 1,
      goalCount: 1,
      sessionCount: 2,
      activeSessionCount: 1,
      reminderCount: 1,
      recurrenceCount: 0,
      externalRefCount: 0,
      taskNotificationCount: 1,
      calendarEventCount: 1,
    },
  });
});

test("POST /api/projects/:id/purge requires authentication", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(purgeBody()),
  });

  assert.equal(response.status, 401);
});

test("POST /api/projects/:id/purge rejects an invalid JSON body", async () => {
  const app = makeApp(fakeSupabase());

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: "{not json",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Request body must be valid JSON." },
  });
});

test("POST /api/projects/:id/purge rejects a malformed id before the database", async () => {
  const fake = fakeSupabase();
  const app = makeApp(fake);

  const response = await app.request("/api/projects/not-a-uuid/purge", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify(purgeBody()),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Project purge request is invalid." },
  });
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.rpcCalls.length, 0);
});

test("POST /api/projects/:id/purge rejects a missing confirmation", async () => {
  const fake = fakeSupabase();
  const app = makeApp(fake);

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify(purgeBody({ confirmationName: "  " })),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Project purge request is invalid." },
  });
  assert.equal(fake.calls.length, 0);
});

test("POST /api/projects/:id/purge rejects an incorrect confirmation", async () => {
  const fake = fakeSupabase();
  queuePurgeProject(fake);
  const app = makeApp(fake);

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify(purgeBody({ confirmationName: "Wrong Name" })),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Project name confirmation does not match." },
  });
  assert.equal(fake.rpcCalls.length, 0);
});

test("POST /api/projects/:id/purge rejects invalid expected counts", async () => {
  const fake = fakeSupabase();
  const app = makeApp(fake);

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify(purgeBody({ expectedTaskCount: -1 })),
  });

  assert.equal(response.status, 400);
  assert.equal(fake.calls.length, 0);
});

test("POST /api/projects/:id/purge rejects a non-archived project", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: { ...ARCHIVED_PROJECT_ROW, status: "done" }, error: null });
  const app = makeApp(fake);

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify(purgeBody()),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "VALIDATION", message: "Only archived projects can be permanently deleted." },
  });
  assert.equal(fake.rpcCalls.length, 0);
});

test("POST /api/projects/:id/purge returns 404 for a foreign project", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: null, error: null });
  const app = makeApp(fake);

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ ...purgeBody(), ownerUserId: "attacker" }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "NOT_FOUND", message: "Project not found." },
  });
  assert.equal(fake.rpcCalls.length, 0);
});

test("POST /api/projects/:id/purge returns 409 when contents changed", async () => {
  const fake = fakeSupabase();
  queuePurgeProject(fake);
  fake.pushRpcResult("purge_archived_project", { data: { status: "contents_changed" }, error: null });
  const app = makeApp(fake);

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify(purgeBody()),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "VALIDATION",
      message: "Project contents changed. Review the deletion impact and confirm again.",
    },
  });

  assert.deepEqual(fake.rpcCalls[0].args, {
    p_project_id: PURGE_PROJECT_ID,
    p_confirmation_name: "Stage CGI",
    p_expected_task_count: 1,
    p_expected_goal_count: 1,
  });
  assert.ok(!("p_owner_user_id" in fake.rpcCalls[0].args));
});

test("POST /api/projects/:id/purge removes the project atomically on success", async () => {
  const fake = fakeSupabase();
  queuePurgeProject(fake);
  fake.pushRpcResult("purge_archived_project", {
    data: {
      status: "purged",
      tasks_deleted: 1,
      goals_deleted: 1,
      sessions_deleted: 2,
      external_refs_deleted: 0,
      notifications_deleted: 1,
      calendar_delete_jobs_enqueued: 1,
    },
    error: null,
  });
  const app = makeApp(fake);

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify(purgeBody()),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    deleted: {
      tasksDeleted: 1,
      goalsDeleted: 1,
      sessionsDeleted: 2,
      externalRefsDeleted: 0,
      notificationsDeleted: 1,
      calendarDeleteJobsEnqueued: 1,
    },
  });
});

test("POST /api/projects/:id/purge maps a persistence failure to sanitized 500", async () => {
  const fake = fakeSupabase();
  queuePurgeProject(fake);
  fake.pushRpcResult("purge_archived_project", { data: null, error: { code: "PGRST500" } });
  const app = makeApp(fake);

  const response = await app.request(PURGE_PATH, {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify(purgeBody()),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: "INTERNAL", message: "Unable to purge project right now." },
  });
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
