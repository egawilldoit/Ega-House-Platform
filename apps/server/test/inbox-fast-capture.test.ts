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

test("POST /api/inbox with same X-Idempotency-Key does not create duplicate (retry-safe)", async () => {
  const fake = fakeSupabase();
  // First request: pre-check miss + service lookup miss, then projects check, then insert
  fake.pushResult("inbox_idempotency_keys", { data: null, error: null }); // pre-check miss (no idea fetch)
  fake.pushResult("inbox_idempotency_keys", { data: null, error: null }); // service lookup miss (no idea fetch)
  fake.pushResult("projects", { data: [{ id: "project-1" }], error: null });
  fake.pushResult("idea_notes", { data: { id: "inbox-1", title: "Idea", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null });
  fake.pushResult("inbox_idempotency_keys", { data: null, error: null }); // insert mapping

  const app = makeApp(fake);
  const key = "key-abc-123";
  const first = await app.request("/api/inbox", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS, "x-idempotency-key": key },
    body: JSON.stringify({ title: "Idea" }),
  });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.item.id, "inbox-1");
  assert.equal(first.headers.get("x-idempotency-key"), key);

  // Second request with same key: should return same item without second insert (replay -> 200)
  // Setup: pre-check hit (route) requires keys+idea, service lookup hit also requires keys+idea
  const fake2 = fakeSupabase();
  fake2.pushResult("inbox_idempotency_keys", { data: { inbox_item_id: "inbox-1" }, error: null }); // pre-check keys
  fake2.pushResult("idea_notes", { data: { id: "inbox-1", title: "Idea", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null }); // pre-check idea
  fake2.pushResult("inbox_idempotency_keys", { data: { inbox_item_id: "inbox-1" }, error: null }); // service lookup keys
  fake2.pushResult("idea_notes", { data: { id: "inbox-1", title: "Idea", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null }); // service lookup idea
  // No projects or insert needed because early return
  const app2 = makeApp(fake2);
  const second = await app2.request("/api/inbox", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS, "x-idempotency-key": key },
    body: JSON.stringify({ title: "Idea" }),
  });
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.item.id, "inbox-1");
  // Ensure no duplicate insert happened: only one call to idea_notes insert in first flow, second flow has 0 inserts
  const secondInsertCalls = fake2.calls.filter((c) => c.table === "idea_notes" && c.steps.some((s) => s.method === "insert"));
  assert.equal(secondInsertCalls.length, 0);
});

test("POST /api/inbox without X-Idempotency-Key still creates normally", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [], error: null });
  fake.pushResult("idea_notes", { data: { id: "inbox-2", title: "No key", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null });
  const app = makeApp(fake);
  const res = await app.request("/api/inbox", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS },
    body: JSON.stringify({ title: "No key" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.item.title, "No key");
});

test("POST /api/inbox with raw title only lands in inbox state", async () => {
  const fake = fakeSupabase();
  fake.pushResult("projects", { data: [], error: null });
  fake.pushResult("idea_notes", { data: { id: "inbox-3", title: "Raw thought", body: null, status: "inbox", type: "idea", project_id: null, priority: null, tags: [], created_at: "2026-04-29T12:00:00.000Z", updated_at: "2026-04-29T12:00:00.000Z", projects: null }, error: null });
  const app = makeApp(fake);
  const res = await app.request("/api/inbox", {
    method: "POST",
    headers: { ...AUTH, ...JSON_HEADERS, "x-idempotency-key": "raw-key" },
    body: JSON.stringify({ title: " Raw thought " }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.item.status, "inbox");
  assert.equal(body.item.title, "Raw thought");
});
