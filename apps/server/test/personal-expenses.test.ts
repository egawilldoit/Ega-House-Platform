import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { expenseReceiptFingerprint } from "@ega/application";

import { createApp } from "../src/index";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
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
  is(...args: unknown[]) {
    this.steps.push({ method: "is", args });
    return this;
  }
  gte(...args: unknown[]) {
    this.steps.push({ method: "gte", args });
    return this;
  }
  lt(...args: unknown[]) {
    this.steps.push({ method: "lt", args });
    return this;
  }
  order(...args: unknown[]) {
    this.steps.push({ method: "order", args });
    return this;
  }
  range(...args: unknown[]) {
    this.steps.push({ method: "range", args });
    return this;
  }
  limit(...args: unknown[]) {
    this.steps.push({ method: "limit", args });
    return this;
  }
  insert(...args: unknown[]) {
    this.steps.push({ method: "insert", args });
    return this;
  }
  update(...args: unknown[]) {
    this.steps.push({ method: "update", args });
    return this;
  }
  maybeSingle(...args: unknown[]) {
    return this.terminal("maybeSingle", args);
  }
  single(...args: unknown[]) {
    return this.terminal("single", args);
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.terminal("await", []).then(fulfilled, rejected);
  }
  private terminal(method: string, args: unknown[]) {
    this.steps.push({ method, args });
    this.fake.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(this.fake.pop(this.table));
  }
}

const AUTH = { authorization: "Bearer expense-token" };
const EXPENSE_ID = "00000000-0000-4000-8000-000000000001";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPENSE_ID,
    kind: "expense",
    direction: "out",
    occurred_at: "2026-11-07T08:30:00+00:00",
    booking_date: "2026-11-07",
    amount_minor: 2250,
    currency: "MAD",
    category: "coffee",
    note: "morning coffee",
    merchant: "Cafe Atlas",
    need_vs_want: "want",
    payment_method: "card",
    purpose: null,
    counts_in_daily: true,
    period_id: null,
    idempotency_key: "key-1",
    create_fingerprint: FINGERPRINT,
    version: 1,
    deleted_at: null,
    created_at: "2026-11-07T08:31:00+00:00",
    updated_at: "2026-11-07T08:31:00+00:00",
    ...overrides,
  };
}

const BODY = {
  occurredAt: "2026-11-07T09:30:00+01:00",
  amountMinor: 2250,
  category: "coffee",
  note: "morning coffee",
  merchant: "Cafe Atlas",
  needVsWant: "want",
  paymentMethod: "card",
  idempotencyKey: "key-1",
};

const FINGERPRINT = expenseReceiptFingerprint({
  occurredAt: "2026-11-07T08:30:00.000Z",
  bookingDate: "2026-11-07",
  amountMinor: 2250,
  category: "coffee",
  note: "morning coffee",
  merchant: "Cafe Atlas",
  needVsWant: "want",
  paymentMethod: "card",
  idempotencyKey: "key-1",
});

function makeApp(fake: FakeSupabase, now = new Date("2026-11-07T12:00:00.000Z")) {
  return createApp({
    verifyToken: async (token) => (token === "expense-token" ? "user-123" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => now,
  });
}

function tableCall(fake: FakeSupabase, table: string) {
  return fake.calls.find((call) => call.table === table);
}

test("expense routes require a verified bearer token", async () => {
  const app = makeApp(new FakeSupabase());
  for (const [method, path] of [
    ["GET", "/api/expenses"],
    ["POST", "/api/expenses"],
    ["GET", `/api/expenses/${EXPENSE_ID}`],
    ["PATCH", `/api/expenses/${EXPENSE_ID}`],
    ["DELETE", `/api/expenses/${EXPENSE_ID}`],
  ] as const) {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
    });
    assert.equal(res.status, 401, `${method} ${path}`);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHENTICATED");
  }
});

test("POST /api/expenses creates a new receipt with 201 and the verified owner", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", { data: null, error: null });
  fake.push("personal_expenses", { data: row(), error: null });

  const res = await makeApp(fake).request("/api/expenses", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(BODY),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.replayed, false);
  assert.equal(body.expense.id, EXPENSE_ID);
  assert.equal(body.expense.amountMinor, 2250);
  assert.equal(body.expense.currency, "MAD");

  const insertCall = fake.calls.find((call) =>
    call.steps.some((step) => step.method === "insert"),
  );
  const payload = insertCall?.steps.find((step) => step.method === "insert")
    ?.args[0] as Record<string, unknown>;
  assert.equal(payload.owner_user_id, "user-123");
  assert.equal(payload.amount_minor, 2250);
  assert.equal(payload.currency, "MAD");
});

test("POST /api/expenses replays a prior receipt with 200", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", { data: row(), error: null });

  const res = await makeApp(fake).request("/api/expenses", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(BODY),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.replayed, true);
  assert.equal(body.expense.id, EXPENSE_ID);
});

test("POST /api/expenses rejects a same-key different-payload conflict with 409", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", {
    data: row({ amount_minor: 999, create_fingerprint: "f".repeat(64) }),
    error: null,
  });

  const res = await makeApp(fake).request("/api/expenses", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(BODY),
  });

  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "CONFLICT");
});

test("POST /api/expenses maps a permission failure to 403 FORBIDDEN", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", { data: null, error: null });
  fake.push("personal_expenses", {
    data: null,
    error: { code: "42501", message: "permission denied for table personal_expenses" },
  });

  const res = await makeApp(fake).request("/api/expenses", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(BODY),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, "FORBIDDEN");
});

test("PATCH /api/expenses/:id maps a permission failure to 403 FORBIDDEN", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", {
    data: null,
    error: { code: "42501", message: "permission denied for table personal_expenses" },
  });

  const res = await makeApp(fake).request(`/api/expenses/${EXPENSE_ID}`, {
    method: "PATCH",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ version: 1, amountMinor: 1990 }),
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, "FORBIDDEN");
});

test("DELETE /api/expenses/:id maps a permission failure to 403 FORBIDDEN", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", {
    data: null,
    error: { code: "42501", message: "permission denied for table personal_expenses" },
  });

  const res = await makeApp(fake).request(`/api/expenses/${EXPENSE_ID}`, {
    method: "DELETE",
    headers: AUTH,
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, "FORBIDDEN");
});

test("POST /api/expenses rejects invalid amounts and caller identity before persistence", async () => {
  const app = makeApp(new FakeSupabase());
  for (const body of [
    { ...BODY, amountMinor: 0 },
    { ...BODY, amountMinor: -5 },
    { ...BODY, amountMinor: 22.5 },
    { ...BODY, amountMinor: 2147483648 },
    { ...BODY, amountMinor: "2250" },
    { ...BODY, category: "rent" },
    { ...BODY, ownerUserId: "attacker" },
    { ...BODY, currency: "USD" },
  ]) {
    const res = await app.request("/api/expenses", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, JSON.stringify(body));
    const response = await res.json();
    assert.equal(response.error.code, "VALIDATION");
  }
});

test("GET /api/expenses resolves the owner timezone and returns a bounded page", async () => {
  const fake = new FakeSupabase();
  fake.push("user_time_context", { data: { iana_timezone: "America/New_York" }, error: null });
  fake.push("personal_expenses", { data: [row()], error: null });

  const res = await makeApp(fake).request(
    "/api/expenses?from=2026-03-08&to=2026-03-08&limit=10",
    { headers: AUTH },
  );

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.expenses.length, 1);
  assert.deepEqual(body.pagination, { limit: 10, offset: 0, hasMore: false });

  const listSteps = tableCall(fake, "personal_expenses")?.steps ?? [];
  assert.ok(listSteps.some((step) => step.method === "eq" && step.args[0] === "owner_user_id" && step.args[1] === "user-123"));
  assert.ok(listSteps.some((step) => step.method === "is" && step.args[0] === "deleted_at" && step.args[1] === null));
  assert.ok(listSteps.some((step) => step.method === "gte" && step.args[0] === "occurred_at" && step.args[1] === "2026-03-08T05:00:00.000Z"));
  assert.ok(listSteps.some((step) => step.method === "lt" && step.args[0] === "occurred_at" && step.args[1] === "2026-03-09T04:00:00.000Z"));
  assert.ok(listSteps.some((step) => step.method === "range" && step.args[0] === 0 && step.args[1] === 10));
});

test("GET /api/expenses uses an explicit IANA timezone without reading time context", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", { data: [], error: null });

  const res = await makeApp(fake).request(
    "/api/expenses?from=2026-03-08&to=2026-03-08&timezone=America/New_York",
    { headers: AUTH },
  );

  assert.equal(res.status, 200);
  assert.equal(tableCall(fake, "user_time_context"), undefined);
  const listSteps = tableCall(fake, "personal_expenses")?.steps ?? [];
  assert.ok(listSteps.some((step) => step.method === "gte" && step.args[1] === "2026-03-08T05:00:00.000Z"));
  assert.ok(listSteps.some((step) => step.method === "lt" && step.args[1] === "2026-03-09T04:00:00.000Z"));
});

test("GET /api/expenses rejects invalid timezones and pagination with 400", async () => {
  const app = makeApp(new FakeSupabase());
  for (const query of [
    "timezone=Mars/Olympus&from=2026-11-01",
    "limit=0",
    "limit=101",
    "offset=-1",
    "from=2026-11-07&to=2026-11-01",
    "ownerUserId=attacker",
  ]) {
    const res = await app.request(`/api/expenses?${query}`, { headers: AUTH });
    assert.equal(res.status, 400, query);
    const body = await res.json();
    assert.equal(body.error.code, "VALIDATION");
  }
});

test("PATCH /api/expenses/:id maps a stale version to 409 and a deleted row to 404", async () => {
  const stale = new FakeSupabase();
  stale.push("personal_expenses", { data: null, error: null });
  stale.push("personal_expenses", { data: { version: 2, deleted_at: null }, error: null });
  const staleRes = await makeApp(stale).request(`/api/expenses/${EXPENSE_ID}`, {
    method: "PATCH",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ version: 1, amountMinor: 1990 }),
  });
  assert.equal(staleRes.status, 409);
  assert.equal((await staleRes.json()).error.code, "CONFLICT");

  const deleted = new FakeSupabase();
  deleted.push("personal_expenses", { data: null, error: null });
  deleted.push("personal_expenses", {
    data: { version: 2, deleted_at: "2026-11-08T00:00:00+00:00" },
    error: null,
  });
  const deletedRes = await makeApp(deleted).request(`/api/expenses/${EXPENSE_ID}`, {
    method: "PATCH",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ version: 1, amountMinor: 1990 }),
  });
  assert.equal(deletedRes.status, 404);
  assert.equal((await deletedRes.json()).error.code, "NOT_FOUND");
});

test("PATCH and GET return 404 for another owner's or an unknown id", async () => {
  const missing = new FakeSupabase();
  missing.push("personal_expenses", { data: null, error: null });
  const getRes = await makeApp(missing).request(`/api/expenses/${EXPENSE_ID}`, {
    headers: AUTH,
  });
  assert.equal(getRes.status, 404);

  const malformed = await makeApp(new FakeSupabase()).request("/api/expenses/not-a-uuid", {
    headers: AUTH,
  });
  assert.equal(malformed.status, 404);
});

test("DELETE /api/expenses/:id reports first and repeated soft deletes", async () => {
  const first = new FakeSupabase();
  first.push("personal_expenses", { data: { version: 1, deleted_at: null }, error: null });
  first.push("personal_expenses", {
    data: { id: EXPENSE_ID, deleted_at: "2026-11-07T12:00:00.000Z" },
    error: null,
  });
  const firstRes = await makeApp(first).request(`/api/expenses/${EXPENSE_ID}`, {
    method: "DELETE",
    headers: AUTH,
  });
  assert.equal(firstRes.status, 200);
  const firstBody = await firstRes.json();
  assert.equal(firstBody.alreadyDeleted, false);
  assert.equal(firstBody.deletedAt, "2026-11-07T12:00:00.000Z");

  const repeat = new FakeSupabase();
  repeat.push("personal_expenses", {
    data: { version: 2, deleted_at: "2026-11-07T12:00:00.000Z" },
    error: null,
  });
  const repeatRes = await makeApp(repeat).request(`/api/expenses/${EXPENSE_ID}`, {
    method: "DELETE",
    headers: AUTH,
  });
  assert.equal(repeatRes.status, 200);
  const repeatBody = await repeatRes.json();
  assert.equal(repeatBody.alreadyDeleted, true);
  assert.equal(repeatBody.deletedAt, "2026-11-07T12:00:00.000Z");
});
