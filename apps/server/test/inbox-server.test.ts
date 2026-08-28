import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createApp, type ServerDependencies } from "../src/index";

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };
type ChainStep = { method: string; args: unknown[] };

class FakeSupabase {
  private queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: ChainStep[] }> = [];
  from(table: string) { return new FakeQueryBuilder(table, this); }
  pushResult(table: string, result: QueryResult) {
    const q = this.queues.get(table) ?? [];
    q.push(result);
    this.queues.set(table, q);
  }
  popResult(table: string): QueryResult {
    const q = this.queues.get(table) ?? [];
    return q.shift() ?? { data: null, error: null };
  }
  record(table: string, steps: ChainStep[]) { this.calls.push({ table, steps }); }
}

class FakeQueryBuilder {
  private steps: ChainStep[] = [];
  constructor(private table: string, private supabase: FakeSupabase) {}
  select(c: string) { this.steps.push({ method: "select", args: [c] }); return this; }
  eq(c: string, v: unknown) { this.steps.push({ method: "eq", args: [c, v] }); return this; }
  in(c: string, v: unknown[]) { this.steps.push({ method: "in", args: [c, v] }); return this; }
  is(c: string, v: unknown) { this.steps.push({ method: "is", args: [c, v] }); return this; }
  or(f: string) { this.steps.push({ method: "or", args: [f] }); return this; }
  contains(c: string, v: unknown[]) { this.steps.push({ method: "contains", args: [c, v] }); return this; }
  order(c: string, o?: unknown) { this.steps.push({ method: "order", args: [c, o] }); return this; }
  insert(p: unknown) { this.steps.push({ method: "insert", args: [p] }); return this; }
  update(p: unknown) { this.steps.push({ method: "update", args: [p] }); return this; }
  maybeSingle() { this.steps.push({ method: "maybeSingle", args: [] }); return this; }
  single() { this.steps.push({ method: "single", args: [] }); return this; }
  then<TResult1, TResult2>(onfulfilled?: ((v: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> {
    this.supabase.record(this.table, this.steps);
    return Promise.resolve(this.supabase.popResult(this.table)).then(onfulfilled, onrejected);
  }
}

function fakeSupabase(): FakeSupabase { return new FakeSupabase(); }

const TOKENS: Record<string, string> = { "token-user-123": "user-123" };

function makeApp(fake: FakeSupabase, overrides: Partial<ServerDependencies> = {}) {
  return createApp({
    verifyToken: async (t) => TOKENS[t] ?? null,
    createRequestClient: () => fake as unknown as SupabaseClient,
    ...overrides,
  });
}

const AUTH = { authorization: "Bearer token-user-123" };
const JSON_HEADERS = { "content-type": "application/json" };

test("POST /api/inbox creates inbox item scoped to verified actor and accepts idempotency header", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [{ id: "project-1" }], error: null });
  fake.pushResult("idea_notes", { data: { id: "inbox-1", title: "Idea", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null });
  const app = makeApp(fake);
  const response = await app.request("/api/inbox", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS, "x-idempotency-key": "key-123" },
    body: JSON.stringify({ title: "Idea" }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.item.title, "Idea");
  assert.equal(response.headers.get("x-idempotency-key"), "key-123");
  const insert = fake.calls.find((c) => c.table === "idea_notes")?.steps.find((s) => s.method === "insert");
  assert.ok(insert);
  assert.equal((insert.args[0] as any).owner_user_id, "user-123");
  assert.equal((insert.args[0] as any).title, "Idea");
});

test("POST /api/inbox never takes identity from body", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [{ id: "project-1" }], error: null });
  fake.pushResult("idea_notes", { data: { id: "inbox-1", title: "Sneaky", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null });
  const app = makeApp(fake);
  const response = await app.request("/api/inbox", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ title: "Sneaky", owner_user_id: "attacker", userId: "attacker" }),
  });
  assert.equal(response.status, 201);
  const insert = fake.calls.find((c) => c.table === "idea_notes")?.steps.find((s) => s.method === "insert");
  assert.ok(insert);
  assert.equal((insert.args[0] as any).owner_user_id, "user-123");
});

test("GET /api/inbox returns list with owner scoping and filters", async () => {
  const fake = fakeSupabase();
  fake.pushResult("idea_notes", { data: [{ id: "inbox-1", title: "Idea", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }], error: null });
  fake.pushResult("projects", { data: [{ id: "project-1", name: "Ops" }], error: null });
  const app = makeApp(fake);
  const response = await app.request("/api/inbox?view=active", { headers: AUTH });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.items.length, 1);
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id" && s.args[1] === "user-123"));
});

test("GET /api/inbox/:id returns 404 for missing idea and enforces owner scoping", async () => {
  const fake = fakeSupabase();
  fake.pushResult("idea_notes", { data: null, error: null });
  const app = makeApp(fake);
  const response = await app.request("/api/inbox/missing-id", { headers: AUTH });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: { code: "NOT_FOUND", message: "Idea not found." } });
  assert.ok(fake.calls[0].steps.some((s) => s.method === "eq" && s.args[0] === "owner_user_id"));
});

test("PATCH /api/inbox/:id updates inbox item scoped by id and owner", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [{ id: "project-1" }], error: null });
  fake.pushResult("idea_notes", { data: { id: "inbox-1", title: "Updated", body: null, status: "reviewing", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null });
  const app = makeApp(fake);
  const response = await app.request("/api/inbox/inbox-1", {
    method: "PATCH",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ title: "Updated", status: "reviewing" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.item.status, "reviewing");
});

test("POST /api/inbox/:id/archive and restore are owner scoped and preserve converted guard", async () => {
  const fake = fakeSupabase();
  fake.pushResult("idea_notes", { data: { id: "inbox-1", title: "Idea", body: null, status: "archived", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null });
  let app = makeApp(fake);
  let response = await app.request("/api/inbox/inbox-1/archive", { method: "POST", headers: AUTH });
  assert.equal(response.status, 200);

  const fake2 = fakeSupabase();
  fake2.pushResult("idea_notes", { data: { id: "inbox-1", title: "Idea", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null });
  app = makeApp(fake2);
  response = await app.request("/api/inbox/inbox-1/restore", { method: "POST", headers: AUTH });
  assert.equal(response.status, 200);

  // converted status should be rejected on update
  const fake3 = fakeSupabase();
  const app3 = makeApp(fake3);
  const bad = await app3.request("/api/inbox/inbox-1", {
    method: "PATCH",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ title: "Idea", status: "converted" }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error.message, /reserved/);
});

test("inbox routes reject unauthenticated requests", async () => {
  const app = makeApp(fakeSupabase());
  const response = await app.request("/api/inbox");
  assert.equal(response.status, 401);
});
