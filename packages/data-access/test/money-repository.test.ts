import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseMoneyPeriodRepository } from "../src/money/repository";

const ACTOR = createAuthenticatedActor("owner-money");
const PERIOD_ID = "00000000-0000-4000-8000-000000000001";
const OPENING_ID = "00000000-0000-4000-8000-000000000002";

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
  count?: number | null;
};

const PERIOD_ROW = {
  id: PERIOD_ID,
  owner_user_id: ACTOR.userId,
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
      note: null,
      corrections: [
        {
          at: "2026-11-11T11:00:00.000Z",
          amountMinor: 55000,
          previousAmountMinor: 50000,
          ledgerVersion: 2,
          source: "user_entered",
          note: "recount",
        },
      ],
    },
    createdFrom: "web",
  },
  settings: { dailyTargetMinor: 20000 },
  version: 3,
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T11:00:00.000Z",
};

class FakeBuilder {
  readonly steps: string[] = [];

  constructor(
    private readonly table: string,
    private readonly fake: FakeSupabase,
  ) {}

  select(columns: string, options?: Record<string, unknown>) {
    this.steps.push(
      `select:${columns}${options ? `:${JSON.stringify(options)}` : ""}`,
    );
    return this;
  }
  insert(payload: unknown) {
    this.steps.push(`insert:${JSON.stringify(payload)}`);
    return this;
  }
  update(payload: unknown) {
    this.steps.push(`update:${JSON.stringify(payload)}`);
    return this;
  }
  eq(column: string, value: unknown) {
    this.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }
  neq(column: string, value: unknown) {
    this.steps.push(`neq:${column}=${String(value)}`);
    return this;
  }
  is(column: string, value: unknown) {
    this.steps.push(`is:${column}=${String(value)}`);
    return this;
  }
  gte(column: string, value: unknown) {
    this.steps.push(`gte:${column}=${String(value)}`);
    return this;
  }
  lte(column: string, value: unknown) {
    this.steps.push(`lte:${column}=${String(value)}`);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.steps.push(`order:${column}:${String(options?.ascending)}`);
    return this;
  }
  limit(value: number) {
    this.steps.push(`limit:${value}`);
    return this;
  }
  range(from: number, to: number) {
    this.steps.push(`range:${from}-${to}`);
    return this;
  }
  maybeSingle() {
    return this.terminal("maybeSingle");
  }
  single() {
    return this.terminal("single");
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.terminal("await").then(fulfilled, rejected);
  }
  private terminal(method: string) {
    this.steps.push(method);
    this.fake.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(this.fake.pop(this.table));
  }
}

class FakeSupabase {
  readonly calls: Array<{ table: string; steps: string[] }> = [];
  readonly rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  private readonly queues = new Map<string, QueryResult[]>();

  constructor(private readonly rpcQueue: QueryResult[] = []) {}

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  rpc(name: string, params: Record<string, unknown>) {
    this.rpcCalls.push({ name, params });
    return Promise.resolve(this.rpcQueue.shift() ?? { data: null, error: null });
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

function repository(fake: FakeSupabase) {
  return new SupabaseMoneyPeriodRepository(fake as unknown as SupabaseClient);
}

function steps(fake: FakeSupabase, table: string) {
  return fake.calls.find((call) => call.table === table)?.steps ?? [];
}

test("findTracking scopes owner and lifecycle and maps provenance/settings", async () => {
  const fake = new FakeSupabase();
  fake.push("money_periods", { data: PERIOD_ROW, error: null });
  const result = await repository(fake).findTracking(ACTOR);

  assert.equal(result.ok, true);
  if (result.ok && result.value) {
    assert.equal(result.value.activeDate, "2026-11-11");
    assert.equal(result.value.settings.dailyTargetMinor, 20000);
    assert.equal(result.value.provenance.opening?.corrections.length, 1);
    assert.equal(result.value.provenance.opening?.corrections[0].amountMinor, 55000);
  }
  const call = steps(fake, "money_periods");
  assert.ok(call.includes("eq:owner_user_id=owner-money"));
  assert.ok(call.includes("eq:lifecycle=tracking"));
});

test("overlap and list queries are owner-scoped and inclusive", async () => {
  const fake = new FakeSupabase();
  fake.push("money_periods", { data: [PERIOD_ROW], error: null });
  await repository(fake).findOverlapping(ACTOR, {
    startDate: "2026-11-30",
    endDate: "2026-12-31",
  });
  const overlap = steps(fake, "money_periods");
  assert.ok(overlap.includes("eq:owner_user_id=owner-money"));
  assert.ok(overlap.includes("lte:start_date=2026-12-31"));
  assert.ok(overlap.includes("gte:end_date=2026-11-30"));

  const listFake = new FakeSupabase();
  listFake.push("money_periods", { data: [PERIOD_ROW], error: null });
  await repository(listFake).list(ACTOR, 12);
  const list = steps(listFake, "money_periods");
  assert.ok(list.includes("eq:owner_user_id=owner-money"));
  assert.ok(list.includes("order:end_date:false"));
  assert.ok(list.includes("limit:12"));
});

test("create calls the atomic RPC with no caller owner and maps the stored row", async () => {
  const fake = new FakeSupabase([{ data: PERIOD_ROW, error: null }]);
  const result = await repository(fake).create(ACTOR, {
    values: {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      timezone: "Africa/Casablanca",
      activeDate: "2026-11-11",
      opening: {
        amountMinor: 50000,
        source: "user_entered",
        cutoffDate: "2026-11-08",
        evidence: null,
        note: "counted",
      },
      settings: {},
    },
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
    openingCreateFingerprint: "a".repeat(64),
    createdAt: "2026-11-11T10:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(fake.rpcCalls.length, 1);
  assert.equal(fake.rpcCalls[0].name, "money_create_period");
  const params = fake.rpcCalls[0].params;
  assert.equal("p_owner_user_id" in params, false);
  assert.equal(params.p_initialization, "initialized");
  assert.equal(params.p_opening_amount_minor, 50000);
  assert.equal(params.p_opening_booking_date, "2026-11-09");
});

test("an unknown opening maps to uninitialized and a verified one to reconciled", async () => {
  const unknown = new FakeSupabase([{ data: PERIOD_ROW, error: null }]);
  await repository(unknown).create(ACTOR, {
    values: {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      timezone: "Africa/Casablanca",
      activeDate: "2026-11-11",
      opening: null,
      settings: {},
    },
    provenance: { opening: null, createdFrom: "web" },
    openingCreateFingerprint: null,
    createdAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(unknown.rpcCalls[0].params.p_initialization, "uninitialized");
  assert.equal(unknown.rpcCalls[0].params.p_opening_amount_minor, null);

  const verified = new FakeSupabase([{ data: PERIOD_ROW, error: null }]);
  await repository(verified).create(ACTOR, {
    values: {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      timezone: "Africa/Casablanca",
      activeDate: "2026-11-11",
      opening: {
        amountMinor: 0,
        source: "verified_source",
        cutoffDate: "2026-11-08",
        evidence: "statement",
        note: null,
      },
      settings: {},
    },
    provenance: { opening: null, createdFrom: "web" },
    openingCreateFingerprint: "b".repeat(64),
    createdAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(verified.rpcCalls[0].params.p_initialization, "reconciled");
  assert.equal(verified.rpcCalls[0].params.p_opening_amount_minor, 0);
});

test("update calls the versioned RPC and classifies a null result", async () => {
  const fake = new FakeSupabase([{ data: { ...PERIOD_ROW, version: 4 }, error: null }]);
  const updated = await repository(fake).update(ACTOR, PERIOD_ID, {
    expectedVersion: 3,
    activeDate: "2026-11-10",
    updatedAt: "2026-11-11T12:00:00.000Z",
  });
  assert.equal(updated.ok, true);
  assert.equal(fake.rpcCalls[0].name, "money_update_period");
  assert.equal(fake.rpcCalls[0].params.p_expected_version, 3);

  const stale = new FakeSupabase([{ data: null, error: null }]);
  stale.push("money_periods", { data: PERIOD_ROW, error: null });
  const staleResult = await repository(stale).update(ACTOR, PERIOD_ID, {
    expectedVersion: 2,
    activeDate: "2026-11-10",
    updatedAt: "2026-11-11T12:00:00.000Z",
  });
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.error.code, "conflict");

  const missing = new FakeSupabase([{ data: null, error: null }]);
  missing.push("money_periods", { data: null, error: null });
  const missingResult = await repository(missing).update(ACTOR, PERIOD_ID, {
    expectedVersion: 2,
    activeDate: "2026-11-10",
    updatedAt: "2026-11-11T12:00:00.000Z",
  });
  assert.equal(missingResult.ok, false);
  if (!missingResult.ok) assert.equal(missingResult.error.code, "notFound");
});

test("opening reads only the opening kind and non-deleted rows", async () => {
  const fake = new FakeSupabase();
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
  const result = await repository(fake).getOpening(ACTOR, OPENING_ID);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value?.amountMinor, 50000);
  const call = steps(fake, "personal_expenses");
  assert.ok(call.includes("eq:kind=opening"));
  assert.ok(call.includes("is:deleted_at=null"));
  assert.ok(call.includes("eq:owner_user_id=owner-money"));
});

test("cash aggregation excludes the opening movement and sums integer directions", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", {
    data: [
      { direction: "out", amount_minor: 1100 },
      { direction: "out", amount_minor: 2500 },
      { direction: "in", amount_minor: 20000 },
    ],
    error: null,
  });
  const result = await repository(fake).sumLedgerByDirection(ACTOR, {
    startDate: "2026-11-09",
    endDateInclusive: "2026-11-11",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.outflowsMinor, 3600);
    assert.equal(result.value.inflowsMinor, 20000);
    assert.equal(result.value.recordCount, 3);
    assert.equal(result.value.truncated, false);
  }
  const call = steps(fake, "personal_expenses");
  assert.ok(call.includes("neq:kind=opening"));
  assert.ok(call.includes("gte:booking_date=2026-11-09"));
  assert.ok(call.includes("lte:booking_date=2026-11-11"));
  assert.ok(call.includes("eq:owner_user_id=owner-money"));
});

test("truncation is reported, never a fake complete cash total", async () => {
  const fake = new FakeSupabase();
  for (let page = 0; page < 10; page += 1) {
    fake.push("personal_expenses", {
      data: Array.from({ length: 1000 }, () => ({
        direction: "out",
        amount_minor: 100,
      })),
      error: null,
    });
  }
  const result = await repository(fake).sumLedgerByDirection(ACTOR, {
    startDate: "2026-11-09",
    endDateInclusive: "2026-11-30",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.truncated, true);
    assert.equal(result.value.recordCount, 10000);
  }
});

test("ledger overview counts expenses with and without the period assignment", async () => {
  const fake = new FakeSupabase();
  fake.push("personal_expenses", { data: null, error: null, count: 7 });
  fake.push("personal_expenses", { data: null, error: null, count: 2 });
  fake.push("personal_expenses", { data: null, error: null, count: 1 });
  const result = await repository(fake).ledgerOverview(ACTOR, {
    periodId: PERIOD_ID,
    startDate: "2026-11-09",
    endDate: "2026-11-30",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.totalExpenseCount, 7);
    assert.equal(result.value.assignedToPeriodCount, 2);
    assert.equal(result.value.inPeriodUnassignedCount, 1);
  }
  const assignments = fake.calls.filter((call) => call.table === "personal_expenses");
  assert.ok(assignments[0].steps.includes("eq:kind=expense"));
  assert.ok(assignments[1].steps.includes(`eq:period_id=${PERIOD_ID}`));
  assert.ok(assignments[2].steps.includes("is:period_id=null"));
});

test("permission and unique failures map to forbidden and conflict", async () => {
  const denied = new FakeSupabase([
    { data: null, error: { code: "42501", message: "permission denied" } },
  ]);
  const deniedResult = await repository(denied).create(ACTOR, {
    values: {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      timezone: "Africa/Casablanca",
      activeDate: "2026-11-11",
      opening: null,
      settings: {},
    },
    provenance: { opening: null, createdFrom: "web" },
    openingCreateFingerprint: null,
    createdAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(deniedResult.ok, false);
  if (!deniedResult.ok) assert.equal(deniedResult.error.code, "forbidden");

  const duplicate = new FakeSupabase([
    { data: null, error: { code: "23505", message: "duplicate key" } },
  ]);
  const duplicateResult = await repository(duplicate).create(ACTOR, {
    values: {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      timezone: "Africa/Casablanca",
      activeDate: "2026-11-11",
      opening: null,
      settings: {},
    },
    provenance: { opening: null, createdFrom: "web" },
    openingCreateFingerprint: null,
    createdAt: "2026-11-11T10:00:00.000Z",
  });
  assert.equal(duplicateResult.ok, false);
  if (!duplicateResult.ok) assert.equal(duplicateResult.error.code, "conflict");
});
