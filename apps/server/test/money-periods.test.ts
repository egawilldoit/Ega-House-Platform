import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp } from "../src/index";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
  count?: number | null;
};
type Step = { method: string; args: unknown[] };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  calls: Array<{ table: string; steps: Step[] }> = [];
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  rpc(name: string, params: Record<string, unknown>) {
    this.rpcCalls.push({ name, params });
    return Promise.resolve(this.fakeRpc.shift() ?? { data: null, error: null });
  }

  private readonly fakeRpc: QueryResult[] = [];

  pushRpc(result: QueryResult) {
    this.fakeRpc.push(result);
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
  neq(...args: unknown[]) {
    this.steps.push({ method: "neq", args });
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
  lte(...args: unknown[]) {
    this.steps.push({ method: "lte", args });
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

const AUTH = { authorization: "Bearer money-token" };
const PERIOD_ID = "00000000-0000-4000-8000-000000000001";
const OPENING_ID = "00000000-0000-4000-8000-000000000002";

function periodRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PERIOD_ID,
    owner_user_id: "user-money",
    start_date: "2026-11-09",
    end_date: "2026-11-30",
    currency: "MAD",
    timezone: "Africa/Casablanca",
    active_date: "2026-11-11",
    lifecycle: "tracking",
    initialization: "initialized",
    opening_movement_id: OPENING_ID,
    provenance: {
      opening: {
        source: "user_entered",
        recordedAt: "2026-11-11T10:00:00.000Z",
        cutoffDate: "2026-11-08",
        evidence: null,
        note: "counted",
        corrections: [],
      },
      createdFrom: "web",
    },
    settings: {},
    version: 2,
    created_at: "2026-11-11T10:00:00.000Z",
    updated_at: "2026-11-11T10:00:00.000Z",
    ...overrides,
  };
}

const CREATE_BODY = {
  startDate: "2026-11-09",
  endDate: "2026-11-30",
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-11",
  opening: {
    amountMinor: 50000,
    source: "user_entered",
    cutoffDate: "2026-11-08",
    note: "counted",
  },
  settings: {},
};

function makeApp(fake: FakeSupabase, now = new Date("2026-11-11T12:00:00.000Z")) {
  return createApp({
    verifyToken: async (token) => (token === "money-token" ? "user-money" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => now,
  });
}

test("money routes require a verified bearer token", async () => {
  const app = makeApp(new FakeSupabase());
  for (const [method, path] of [
    ["GET", "/api/money/state"],
    ["POST", "/api/money/periods"],
    ["PATCH", `/api/money/periods/${PERIOD_ID}/settings`],
  ] as const) {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test("GET /api/money/state reports local today without inventing a period", async () => {
  const fake = new FakeSupabase();
  const res = await makeApp(fake).request("/api/money/state", {
    headers: AUTH,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.localToday, "2026-11-11");
  assert.equal(body.timezone, "Africa/Casablanca");
  assert.equal(body.period, null);
  assert.equal(body.opening.status, "unknown");
  assert.equal(body.cash.available, false);
  assert.equal(body.dateResolution.basis, "local_today_no_period");
});

test("POST /api/money/periods creates through the atomic RPC with 201", async () => {
  const fake = new FakeSupabase();
  fake.push("money_periods", { data: [], error: null });
  fake.push("money_periods", { data: null, error: null });
  fake.pushRpc({ data: periodRow(), error: null });

  const res = await makeApp(fake).request("/api/money/periods", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(CREATE_BODY),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.replayed, false);
  assert.equal(body.period.id, PERIOD_ID);
  assert.equal(fake.rpcCalls[0].name, "money_create_period");
  assert.equal(fake.rpcCalls[0].params.p_opening_amount_minor, 50000);
  assert.equal("p_owner_user_id" in fake.rpcCalls[0].params, false);
});

test("POST /api/money/periods replays an identical request with 200", async () => {
  const fake = new FakeSupabase();
  fake.push("money_periods", { data: [periodRow()], error: null });
  fake.push("personal_expenses", {
    data: {
      id: OPENING_ID,
      amount_minor: 50000,
      currency: "MAD",
      booking_date: "2026-11-09",
      version: 1,
      created_at: "2026-11-11T10:00:00.000Z",
      updated_at: "2026-11-11T10:00:00.000Z",
    },
    error: null,
  });

  const res = await makeApp(fake).request("/api/money/periods", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify(CREATE_BODY),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.replayed, true);
  assert.equal(body.period.id, PERIOD_ID);
  assert.equal(fake.rpcCalls.length, 0);
});

test("PATCH settings requires the current version and maps conflicts", async () => {
  const fake = new FakeSupabase();
  fake.push("money_periods", {
    data: periodRow({ opening_movement_id: null, initialization: "uninitialized", version: 1 }),
    error: null,
  });
  fake.pushRpc({
    data: periodRow({
      opening_movement_id: null,
      initialization: "uninitialized",
      active_date: "2026-11-10",
      version: 2,
    }),
    error: null,
  });
  const ok = await makeApp(fake).request(`/api/money/periods/${PERIOD_ID}/settings`, {
    method: "PATCH",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ version: 1, activeDate: "2026-11-10" }),
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.period.activeDate, "2026-11-10");
  assert.equal(fake.rpcCalls[0].name, "money_update_period");
  assert.equal(fake.rpcCalls[0].params.p_expected_version, 1);

  const staleFake = new FakeSupabase();
  staleFake.push("money_periods", {
    data: periodRow({ opening_movement_id: null, initialization: "uninitialized", version: 3 }),
    error: null,
  });
  const stale = await makeApp(staleFake).request(
    `/api/money/periods/${PERIOD_ID}/settings`,
    {
      method: "PATCH",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, activeDate: "2026-11-10" }),
    },
  );
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "CONFLICT");
  assert.equal(staleFake.rpcCalls.length, 0);

  const missingFake = new FakeSupabase();
  missingFake.push("money_periods", { data: null, error: null });
  const missing = await makeApp(missingFake).request(
    `/api/money/periods/${PERIOD_ID}/settings`,
    {
      method: "PATCH",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ version: 1, activeDate: "2026-11-10" }),
    },
  );
  assert.equal(missing.status, 404);
});

test("a malformed period body returns VALIDATION, never a success shape", async () => {
  const fake = new FakeSupabase();
  const res = await makeApp(fake).request("/api/money/periods", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ startDate: "2026-11-30", endDate: "2026-11-09" }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "VALIDATION");
  assert.equal(fake.rpcCalls.length, 0);
});

test("expense creation receives the out-of-period guard at the HTTP boundary", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", { data: null, error: null });
  fake.push("money_periods", {
    data: periodRow({
      opening_movement_id: null,
      initialization: "uninitialized",
      start_date: "2026-11-09",
      end_date: "2026-11-30",
    }),
    error: null,
  });

  const res = await makeApp(fake).request("/api/expenses", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      occurredAt: "2026-12-02T12:00:00+01:00",
      amountMinor: 1100,
      category: "coffee",
      needVsWant: "want",
      idempotencyKey: "out-of-period",
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error.message, /outside the tracking period/);
  assert.equal(
    fake.calls.some((call) =>
      call.steps.some((step) => step.method === "insert"),
    ),
    false,
  );
});
