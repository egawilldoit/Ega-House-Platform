import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

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
  insert(...args: unknown[]) {
    this.steps.push({ method: "insert", args });
    return this;
  }
  update(...args: unknown[]) {
    this.steps.push({ method: "update", args });
    return this;
  }
  delete(...args: unknown[]) {
    this.steps.push({ method: "delete", args });
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
const PERIOD = {
  periodStartDate: "2026-11-09",
  periodEndDate: "2026-11-30",
};

function makeApp(fake: FakeSupabase) {
  return createApp({
    verifyToken: async (token) => (token === "money-token" ? "user-123" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date("2026-11-11T12:00:00.000Z"),
  });
}

const PLAN_ROW = {
  id: "plan-1",
  period_start_date: "2026-11-09",
  period_end_date: "2026-11-30",
  currency: "MAD",
  allocations: { coffee: 7_000 },
  savings_target_minor: 20_000,
  emergency_target_minor: null,
  coffee_weekly_spend_limit_minor: 7_000,
  coffee_weekly_visit_limit: 5,
  version: 1,
  created_at: "2026-11-11T12:00:00.000Z",
  updated_at: "2026-11-11T12:00:00.000Z",
};

test("money routes require a verified bearer token", async () => {
  const app = makeApp(new FakeSupabase());
  for (const [method, path] of [
    ["GET", `/api/money/budget?periodStartDate=${PERIOD.periodStartDate}&periodEndDate=${PERIOD.periodEndDate}`],
    ["PUT", "/api/money/budget"],
    ["PATCH", "/api/money/budget"],
    ["POST", "/api/money/coffee-visits"],
    ["POST", "/api/money/classify"],
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

test("GET /api/money/budget validates the period and returns null for no plan", async () => {
  const fake = new FakeSupabase();
  fake.push("money_budget_plans", { data: null, error: null });
  const res = await makeApp(fake).request(
    `/api/money/budget?periodStartDate=${PERIOD.periodStartDate}&periodEndDate=${PERIOD.periodEndDate}`,
    { headers: AUTH },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.plan, null);

  const invalid = await makeApp(new FakeSupabase()).request(
    "/api/money/budget?periodStartDate=2026-11-30&periodEndDate=2026-11-01",
    { headers: AUTH },
  );
  assert.equal(invalid.status, 400);
});

test("PATCH /api/money/budget creates a versioned plan through the shared use case", async () => {
  const fake = new FakeSupabase();
  fake.push("money_budget_plans", { data: null, error: null });
  fake.push("money_budget_plans", { data: PLAN_ROW, error: null });

  const res = await makeApp(fake).request("/api/money/budget", {
    method: "PATCH",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      ...PERIOD,
      version: 0,
      allocations: { coffee: 7_000 },
      savingsTargetMinor: 20_000,
      coffeeWeeklySpendLimitMinor: 7_000,
      coffeeWeeklyVisitLimit: 5,
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.plan?.id, "plan-1");
  assert.equal(body.plan?.version, 1);

  const insertCall = fake.calls.find((call) =>
    call.steps.some((step) => step.method === "insert"),
  );
  const payload = insertCall?.steps.find((step) => step.method === "insert")
    ?.args[0] as Record<string, unknown>;
  assert.equal(payload.owner_user_id, "user-123");
  assert.deepEqual(payload.allocations, { coffee: 7_000 });
});

test("POST /api/money/coffee-visits rejects an empty line list before persistence", async () => {
  const fake = new FakeSupabase();
  const res = await makeApp(fake).request("/api/money/coffee-visits", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      visitKey: "visit-1",
      localDate: "2026-11-11",
      timezone: "Africa/Casablanca",
      expenseIds: [],
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "VALIDATION");
  assert.equal(fake.calls.length, 0);
});
