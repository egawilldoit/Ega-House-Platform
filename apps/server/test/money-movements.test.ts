import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { movementReceiptFingerprint } from "@ega/application";
import { parseCreateMovementInput } from "@ega/domain/money";

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

  select(...args: unknown[]) { this.steps.push({ method: "select", args }); return this; }
  eq(...args: unknown[]) { this.steps.push({ method: "eq", args }); return this; }
  is(...args: unknown[]) { this.steps.push({ method: "is", args }); return this; }
  gte(...args: unknown[]) { this.steps.push({ method: "gte", args }); return this; }
  lte(...args: unknown[]) { this.steps.push({ method: "lte", args }); return this; }
  lt(...args: unknown[]) { this.steps.push({ method: "lt", args }); return this; }
  order(...args: unknown[]) { this.steps.push({ method: "order", args }); return this; }
  range(...args: unknown[]) { this.steps.push({ method: "range", args }); return this; }
  limit(...args: unknown[]) { this.steps.push({ method: "limit", args }); return this; }
  insert(...args: unknown[]) { this.steps.push({ method: "insert", args }); return this; }
  update(...args: unknown[]) { this.steps.push({ method: "update", args }); return this; }
  maybeSingle(...args: unknown[]) { return this.terminal("maybeSingle", args); }
  single(...args: unknown[]) { return this.terminal("single", args); }
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

const AUTH = { authorization: "Bearer movement-token" };
const MOVEMENT_ID = "00000000-0000-4000-8000-000000000010";
const MISSING_PERIOD = {
  data: null,
  error: { code: "42P01", message: 'relation "public.money_periods" does not exist' },
};

const INCOME_INPUT = {
  kind: "income",
  amountMinor: 20000,
  bookingDate: "2026-11-09",
  note: "salary",
  idempotencyKey: "income-1",
};

const INCOME_FINGERPRINT = (() => {
  const parsed = parseCreateMovementInput(INCOME_INPUT);
  if (!parsed.ok) throw new Error("test fixture is invalid");
  return movementReceiptFingerprint(parsed.value);
})();

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: MOVEMENT_ID,
    kind: "income",
    direction: "in",
    occurred_at: null,
    booking_date: "2026-11-09",
    amount_minor: 20000,
    currency: "MAD",
    category: null,
    note: "salary",
    merchant: null,
    need_vs_want: null,
    payment_method: null,
    purpose: null,
    counts_in_daily: false,
    period_id: null,
    idempotency_key: "income-1",
    create_fingerprint: INCOME_FINGERPRINT,
    version: 1,
    deleted_at: null,
    created_at: "2026-11-09T10:00:00+00:00",
    updated_at: "2026-11-09T10:00:00+00:00",
    ...overrides,
  };
}

function makeApp(fake: FakeSupabase, now = new Date("2026-11-11T12:00:00.000Z")) {
  return createApp({
    verifyToken: async (token) => (token === "movement-token" ? "user-123" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => now,
  });
}

test("money routes require a verified bearer token", async () => {
  const app = makeApp(new FakeSupabase());
  for (const [method, path] of [
    ["GET", "/api/money/movements"],
    ["POST", "/api/money/movements"],
    ["GET", `/api/money/movements/${MOVEMENT_ID}`],
    ["PATCH", `/api/money/movements/${MOVEMENT_ID}`],
    ["GET", "/api/money/state"],
  ] as const) {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    assert.equal(res.status, 401, `${method} ${path}`);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHENTICATED");
  }
});

test("POST /api/money/movements records income once without a period table", async () => {
  const fake = new FakeSupabase();
  fake.push("money_periods", MISSING_PERIOD);
  fake.push("personal_expenses", { data: null, error: null });
  fake.push("personal_expenses", { data: row(), error: null });

  const res = await makeApp(fake).request("/api/money/movements", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "income",
      amountMinor: 20000,
      bookingDate: "2026-11-09",
      note: "salary",
      idempotencyKey: "income-1",
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.replayed, false);
  assert.equal(body.movement.direction, "in");
  assert.equal(body.movement.countsInDaily, false);
  assert.equal(body.movement.occurredAt, null);

  const insert = fake.calls.find((call) =>
    call.steps.some((step) => step.method === "insert"),
  );
  const payload = insert?.steps.find((step) => step.method === "insert")
    ?.args[0] as Record<string, unknown>;
  assert.equal(payload.owner_user_id, "user-123");
  assert.equal(payload.kind, "income");
  assert.equal(payload.direction, "in");
  assert.equal(payload.counts_in_daily, false);
  assert.equal(payload.booking_date, "2026-11-09");
  assert.equal(payload.period_id, null);
});

test("POST /api/money/movements replays the same key with 200", async () => {
  const fake = new FakeSupabase();
  fake.push("money_periods", MISSING_PERIOD);
  fake.push("personal_expenses", { data: row(), error: null });

  const res = await makeApp(fake).request("/api/money/movements", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "income",
      amountMinor: 20000,
      bookingDate: "2026-11-09",
      note: "salary",
      idempotencyKey: "income-1",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.replayed, true);
  assert.equal(body.movement.id, MOVEMENT_ID);
});

test("GET /api/money/state reports recorded cash 689 at the cutoff and incomplete confirmation", async () => {
  const fake = new FakeSupabase();
  fake.push("money_periods", MISSING_PERIOD);
  fake.push("personal_expenses", {
    data: [
      { id: "1", kind: "opening", direction: "in", amount_minor: 50000, counts_in_daily: false, booking_date: "2026-11-01" },
      { id: "2", kind: "income", direction: "in", amount_minor: 20000, counts_in_daily: false, booking_date: "2026-11-09" },
      { id: "3", kind: "expense", direction: "out", amount_minor: 1100, counts_in_daily: true, booking_date: "2026-11-11" },
    ],
    error: null,
  });

  const res = await makeApp(fake).request(
    "/api/money/state?cutoff=2026-11-11&timezone=Africa%2FCasablanca",
    { headers: AUTH },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.state.currency, "MAD");
  assert.equal(body.state.cutoff, "2026-11-11");
  assert.equal(body.state.recordedCashMinor, 68900);
  assert.equal(body.state.expenseTotalMinor, 1100);
  assert.equal(body.state.dailyIncludedSpendMinor, 1100);
  assert.equal(body.state.completeness.confirmed, false);
  assert.ok(body.state.completeness.reasons.includes("period_table_unavailable"));
});

test("GET /api/money/movements applies the cutoff to booking_date", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", {
    data: [row(), row({ id: "00000000-0000-4000-8000-000000000011", kind: "savings_transfer", direction: "out", category: null, need_vs_want: null, amount_minor: 50000, booking_date: "2026-11-10", idempotency_key: "save-1" })],
    error: null,
  });

  const res = await makeApp(fake).request(
    "/api/money/movements?cutoff=2026-11-10&timezone=Africa%2FCasablanca&limit=10",
    { headers: AUTH },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.cutoff, "2026-11-10");
  assert.equal(body.movements.length, 2);
  const listCall = fake.calls.find((call) => call.table === "personal_expenses");
  assert.ok(listCall?.steps.some((step) => step.method === "lte" && step.args[0] === "booking_date"));
});

test("PATCH /api/money/movements/:id maps a stale version to 409 CONFLICT", async () => {
  const fake = new FakeSupabase();
  // Load the current row, then the version-pinned update matches nothing and
  // the classification read sees a newer version.
  fake.push("personal_expenses", { data: row(), error: null });
  fake.push("personal_expenses", { data: null, error: null });
  fake.push("personal_expenses", { data: { version: 2, deleted_at: null }, error: null });

  const res = await makeApp(fake).request(`/api/money/movements/${MOVEMENT_ID}`, {
    method: "PATCH",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ version: 1, amountMinor: 21000 }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error.code, "CONFLICT");
});
