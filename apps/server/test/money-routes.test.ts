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

  rpc(name: string, args: unknown) {
    this.calls.push({
      table: `rpc:${name}`,
      steps: [{ method: "rpc", args }],
    });
    return Promise.resolve(this.pop("<rpc>"));
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
  is(...args: unknown[]) {
    this.steps.push({ method: "is", args });
    return this;
  }
  limit(...args: unknown[]) {
    this.steps.push({ method: "limit", args });
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
  period_id: "period-1",
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

const PERIOD_ROW = {
  id: "period-1",
  owner_user_id: "user-123",
  start_date: PERIOD.periodStartDate,
  end_date: PERIOD.periodEndDate,
  currency: "MAD",
  timezone: "Africa/Casablanca",
  active_date: "2026-11-11",
  lifecycle: "tracking",
  initialization: "initialized",
  opening_movement_id: null,
  provenance: { opening: null, createdFrom: "web" },
  settings: {},
  version: 1,
  created_at: "2026-11-09T00:00:00.000Z",
  updated_at: "2026-11-09T00:00:00.000Z",
};

test("money routes require a verified bearer token", async () => {
  const app = makeApp(new FakeSupabase());
  for (const [method, path] of [
    ["GET", `/api/money/budget?periodStartDate=${PERIOD.periodStartDate}&periodEndDate=${PERIOD.periodEndDate}`],
    ["PUT", "/api/money/budget"],
    ["PATCH", "/api/money/budget"],
    ["POST", "/api/money/coffee-visits"],
    ["POST", "/api/money/classify"],
    ["POST", "/api/money/day-close"],
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
  fake.push("money_periods", { data: [PERIOD_ROW], error: null });
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
  fake.push("money_periods", { data: [PERIOD_ROW], error: null });
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
  assert.equal(payload.period_id, "period-1");
  assert.deepEqual(payload.allocations, { coffee: 7_000 });
  assert.equal("period_start_date" in payload, false);
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

test("GET /api/money/coffee-visits normalizes numeric pagination query values", async () => {
  const fake = new FakeSupabase();
  fake.push("money_coffee_visits", { data: [], error: null });
  const res = await makeApp(fake).request(
    "/api/money/coffee-visits?from=2026-11-09&to=2026-11-15&limit=25&offset=0",
    { headers: AUTH },
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.visits, []);
  assert.ok(
    fake.calls[0]!.steps.some(
      (step) => step.method === "range" && step.args[0] === 0 && step.args[1] === 24,
    ),
  );
});

const CLOSE_SNAPSHOT = {
  currency: "MAD",
  expenseTotalMinor: 1_100,
  dailyIncludedSpendMinor: 1_100,
  flexibleExpenseTotalMinor: 1_100,
  fixedExpenseTotalMinor: 0,
  emergencyExpenseTotalMinor: 0,
  categoryTotals: { coffee: 1_100 },
  recordedCashMinor: 48_900,
  recordedCashBasis: "recorded",
  dayStartBaseline: {
    date: "2026-11-11",
    version: 1,
    availability: "available",
    policyVersionId: null,
    cashMinor: 50_000,
    commitmentsMinor: 0,
    savingsTargetMinor: 0,
    savingsFundedMinor: 0,
    emergencyTargetMinor: 0,
    emergencyUsedMinor: 0,
  },
  dailyReference: {
    available: true,
    algorithm: "safe-flexible-start-of-day-v1",
    daysRemaining: 20,
    safePoolMinor: 50_000,
    referenceMinor: 2_500,
    dailyRemainingMinor: 1_400,
  },
  reserves: {
    recordedCashMinor: 48_900,
    unpaidCommitmentsMinor: 0,
    savingsTargetMinor: 0,
    fundedSavingsMinor: 0,
    unfundedSavingsMinor: 0,
    emergencyTargetMinor: 0,
    emergencyUsedMinor: 0,
    remainingEmergencyMinor: 0,
    safeFlexibleMinor: 50_000,
  },
};

test("POST /api/money/day-close validates before persistence and returns retained evidence", async () => {
  const invalid = await makeApp(new FakeSupabase()).request("/api/money/day-close", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }),
  });
  assert.equal(invalid.status, 400);

  const fake = new FakeSupabase();
  fake.push("money_day_closes", { data: null, error: null });
  fake.push("money_periods", {
    data: { ...PERIOD_ROW, opening_movement_id: "opening-1" },
    error: null,
  });
  fake.push("money_day_start_baselines", {
    data: {
      date: "2026-11-11",
      version: 1,
      availability: "available",
      unavailable_reason: null,
      cash_minor: 50_000,
      commitments_minor: 0,
      savings_target_minor: 0,
      savings_funded_minor: 0,
      emergency_target_minor: 0,
      emergency_used_minor: 0,
    },
    error: null,
  });
  fake.push("<rpc>", {
    data: {
      status: "closed",
      close: {
        id: "close-1",
        period_id: PERIOD_ROW.id,
        close_date: "2026-11-11",
        status: "closed",
        note: "Closed with chicken",
        operation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        close_fingerprint: "a".repeat(64),
        expected_period_version: 1,
        period_version_after: 2,
        active_date_after: "2026-11-12",
        lifecycle_after: "tracking",
        is_final_day: false,
        algorithm_version: "safe-flexible-start-of-day-v1",
        policy_version_id: null,
        policy_version: null,
        baseline_version: 1,
        included_movement_ids: [],
        snapshot: CLOSE_SNAPSHOT,
        created_at: "2026-11-11T20:00:00.000Z",
      },
      period: {
        ...PERIOD_ROW,
        active_date: "2026-11-12",
        version: 2,
        updated_at: "2026-11-11T20:00:00.000Z",
      },
    },
    error: null,
  });

  const res = await makeApp(fake).request("/api/money/day-close", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      note: "Closed with chicken",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.close.closeDate, "2026-11-11");
  assert.equal(body.close.activeDateAfter, "2026-11-12");
  assert.equal(body.close.snapshot.expenseTotalMinor, 1_100);
  assert.equal(body.period.activeDate, "2026-11-12");
  assert.equal(body.replayed, false);
  const rpc = fake.calls.find((call) => call.table === "rpc:money_close_day");
  assert.ok(rpc);
  const args = rpc.steps[0]!.args as Record<string, unknown>;
  assert.equal(args.p_expected_version, 1);
  assert.equal(args.p_date, "2026-11-11");
  assert.equal(args.p_operation_id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
});
