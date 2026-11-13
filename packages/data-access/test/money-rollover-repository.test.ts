import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseMoneyRolloverRepository } from "../src/money/rollover-repository";

const ACTOR = createAuthenticatedActor("11111111-1111-4111-8111-111111111111");
const PERIOD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type QueryResult = {
  data: unknown;
  error: null | { code?: string; message?: string };
  count?: number | null;
};

/**
 * Queue-backed Supabase stand-in. Queues are keyed by table (or `rpc:<name>`)
 * so concurrent calls in `getSourceContext` stay independent of call ordering.
 */
class FakeBuilder {
  readonly steps: string[] = [];
  constructor(
    private readonly table: string,
    private readonly pop: (key: string) => QueryResult,
  ) {}

  select(columns: string, options?: { count?: string }) {
    this.steps.push(
      `select:${columns}${options?.count ? `:count=${options.count}` : ""}`,
    );
    return this;
  }
  eq(column: string, value: unknown) {
    this.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }
  lte(column: string, value: unknown) {
    this.steps.push(`lte:${column}=${String(value)}`);
    return this;
  }
  gte(column: string, value: unknown) {
    this.steps.push(`gte:${column}=${String(value)}`);
    return this;
  }
  is(column: string, value: unknown) {
    this.steps.push(`is:${column}=${String(value)}`);
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
    this.steps.push("maybeSingle");
    return Promise.resolve(this.pop(this.table));
  }
  single() {
    this.steps.push("single");
    return Promise.resolve(this.pop(this.table));
  }
  then(
    resolve: (value: QueryResult) => unknown,
    reject: (error: unknown) => unknown,
  ) {
    return Promise.resolve(this.pop(this.table)).then(resolve, reject);
  }
}

function fakeClient(queues: Record<string, QueryResult[]>) {
  const calls: Array<{ table: string; builder: FakeBuilder }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const pending = new Map(
    Object.entries(queues).map(([key, values]) => [key, [...values]]),
  );
  const pop = (key: string): QueryResult => {
    const queue = pending.get(key);
    return queue?.shift() ?? { data: null, error: null, count: null };
  };
  const client = {
    from(table: string) {
      const builder = new FakeBuilder(table, pop);
      calls.push({ table, builder });
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve(pop(`rpc:${name}`));
    },
  };
  return { client: client as unknown as SupabaseClient, calls, rpcCalls };
}

const PERIOD_ROW = {
  id: PERIOD_ID,
  owner_user_id: ACTOR.userId,
  start_date: "2026-11-01",
  end_date: "2026-11-30",
  currency: "MAD",
  timezone: "Africa/Casablanca",
  active_date: "2026-11-30",
  lifecycle: "ended",
  initialization: "initialized",
  opening_movement_id: null,
  provenance: { opening: null, createdFrom: "web" },
  settings: { savingsTargetMinor: 12_000 },
  version: 4,
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-30T00:00:00.000Z",
};

const BRIDGE_ROW = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  source_period_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  destination_period_id: PERIOD_ID,
  movement_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  correction_version: 3,
  amount_minor: 1_250,
  direction: "out",
  booking_date: "2026-11-20",
  applied: false,
  variance_reason: "verified_opening_covered_cutoff",
  created_at: "2026-12-02T00:00:00.000Z",
};

function closeSummary(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    closeCount: 18,
    requiredCloseCount: 19,
    trackedFromDate: "2026-11-13",
    missingCloseDates: ["2026-11-20"],
    completeCloseEvidence: false,
    lastClosedDate: "2026-11-30",
    comparableToRestatedTotals: true,
    restatedDifferenceCount: 0,
    restatedDifferences: [],
    paidObligationCount: 0,
    paidObligationMismatchCount: 0,
    countedVisitCount: 0,
    countedVisitMismatchCount: 0,
    savingsTargetMinor: null,
    savingsTransferredMinor: 0,
    ...overrides,
  };
}

test("correction bridge reads are owner-scoped and disclose truncation", async () => {
  const complete = fakeClient({
    money_period_rollover_bridges: [
      { data: [BRIDGE_ROW], error: null, count: 1 },
    ],
  });
  const completeResult = await new SupabaseMoneyRolloverRepository(
    complete.client,
  ).listCorrectionBridges(ACTOR, PERIOD_ID);
  assert.equal(completeResult.ok, true);
  assert.deepEqual(completeResult.ok && completeResult.value.bridges[0], {
    id: BRIDGE_ROW.id,
    sourcePeriodId: BRIDGE_ROW.source_period_id,
    destinationPeriodId: PERIOD_ID,
    movementId: BRIDGE_ROW.movement_id,
    correctionVersion: 3,
    amountMinor: 1_250,
    direction: "out",
    bookingDate: "2026-11-20",
    applied: false,
    varianceReason: "verified_opening_covered_cutoff",
    createdAt: BRIDGE_ROW.created_at,
  });
  assert.equal(completeResult.ok && completeResult.value.truncated, false);
  const steps = complete.calls[0]!.builder.steps;
  assert.ok(steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
  assert.ok(steps.includes(`eq:destination_period_id=${PERIOD_ID}`));
  assert.ok(steps.includes("limit:500"));
  assert.ok(steps.some((step) => step.includes("count=exact")));

  const truncated = fakeClient({
    money_period_rollover_bridges: [
      { data: [BRIDGE_ROW], error: null, count: 501 },
    ],
  });
  const truncatedResult = await new SupabaseMoneyRolloverRepository(
    truncated.client,
  ).listCorrectionBridges(ACTOR, PERIOD_ID);
  assert.equal(truncatedResult.ok && truncatedResult.value.truncated, true);

  const unknownCount = fakeClient({
    money_period_rollover_bridges: [{ data: [BRIDGE_ROW], error: null }],
  });
  const unknownResult = await new SupabaseMoneyRolloverRepository(
    unknownCount.client,
  ).listCorrectionBridges(ACTOR, PERIOD_ID);
  assert.equal(
    unknownResult.ok && unknownResult.value.truncated,
    true,
    "an unverifiable total is never treated as a complete history",
  );
});

test("source context reads the effective policy and a bridge truncation flag", async () => {
  const { client, calls, rpcCalls } = fakeClient({
    money_periods: [
      { data: PERIOD_ROW, error: null },
      { data: { successor_period_id: null }, error: null },
    ],
    "rpc:money_ledger_direction_totals": [
      {
        data: [{ inflowsMinor: 0, outflowsMinor: 0, recordCount: 0 }],
        error: null,
      },
    ],
    money_obligations: [{ data: [], error: null, count: 0 }],
    money_period_rollovers: [{ data: null, error: null }],
    "rpc:money_rollover_close_snapshot_summary": [
      { data: closeSummary(), error: null },
    ],
    money_policy_versions: [
      {
        data: { policy: { settings: { savingsTargetMinor: 5_000 } } },
        error: null,
      },
    ],
    money_period_rollover_bridges: [
      { data: [BRIDGE_ROW], error: null, count: 2 },
    ],
  });

  const result = await new SupabaseMoneyRolloverRepository(
    client,
  ).getSourceContext(ACTOR, PERIOD_ID);

  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.deepEqual(result.value.effectiveSettings, {
    savingsTargetMinor: 5_000,
  });
  assert.equal(result.value.priorCorrectionBridges.length, 1);
  assert.equal(result.value.priorCorrectionBridgesTruncated, true);
  assert.deepEqual(result.value.closeSnapshots, {
    available: true,
    closeCount: 18,
    requiredCloseCount: 19,
    trackedFromDate: "2026-11-13",
    missingCloseDates: ["2026-11-20"],
    completeCloseEvidence: false,
    lastClosedDate: "2026-11-30",
    comparableToRestatedTotals: true,
    restatedDifferenceCount: 0,
    restatedDifferences: [],
    paidObligationCount: 0,
    paidObligationMismatchCount: 0,
    countedVisitCount: 0,
    countedVisitMismatchCount: 0,
    savingsTargetMinor: null,
    savingsTransferredMinor: 0,
  });
  assert.equal(
    rpcCalls.filter(
      (call) => call.name === "money_rollover_close_snapshot_summary",
    ).length,
    1,
  );
  assert.ok(calls.some((call) => call.table === "money_policy_versions"));
});

test("policy settings fall back to the period copy when no version exists", async () => {
  const { client } = fakeClient({
    money_periods: [
      { data: PERIOD_ROW, error: null },
      { data: { successor_period_id: null }, error: null },
    ],
    "rpc:money_ledger_direction_totals": [
      {
        data: [{ inflowsMinor: 0, outflowsMinor: 0, recordCount: 0 }],
        error: null,
      },
    ],
    money_obligations: [{ data: [], error: null, count: 0 }],
    money_period_rollovers: [{ data: null, error: null }],
    "rpc:money_rollover_close_snapshot_summary": [
      {
        data: closeSummary({
          closeCount: 19,
          requiredCloseCount: 19,
          trackedFromDate: "2026-11-12",
          missingCloseDates: [],
          completeCloseEvidence: true,
        }),
        error: null,
      },
    ],
    money_policy_versions: [{ data: null, error: null }],
    money_period_rollover_bridges: [{ data: [], error: null, count: 0 }],
  });

  const result = await new SupabaseMoneyRolloverRepository(
    client,
  ).getSourceContext(ACTOR, PERIOD_ID);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value?.effectiveSettings, {
    savingsTargetMinor: 12_000,
  });
});

test("pending occurrences paginate and report a bounded truncation", async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    kind: "bill",
    description: `Bill ${index}`,
    amount_minor: 100,
    due_date: "2026-11-30",
    template_id: null,
    need_vs_want: "need",
    purpose: "fixed",
    counts_in_daily: false,
    category: "bills",
  }));
  const { client, calls } = fakeClient({
    money_periods: [
      { data: PERIOD_ROW, error: null },
      { data: { successor_period_id: null }, error: null },
    ],
    "rpc:money_ledger_direction_totals": [
      {
        data: [{ inflowsMinor: 0, outflowsMinor: 0, recordCount: 0 }],
        error: null,
      },
    ],
    money_obligations: [
      { data: rows, error: null, count: 1001 },
      { data: [rows[0]], error: null, count: 1001 },
    ],
    money_period_rollovers: [{ data: null, error: null }],
    "rpc:money_rollover_close_snapshot_summary": [
      { data: closeSummary(), error: null },
    ],
    money_policy_versions: [{ data: null, error: null }],
    money_period_rollover_bridges: [{ data: [], error: null, count: 0 }],
  });

  const result = await new SupabaseMoneyRolloverRepository(
    client,
  ).getSourceContext(ACTOR, PERIOD_ID);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value?.pendingOccurrences.length, 1001);
  assert.equal(result.ok && result.value?.pendingOccurrencesTruncated, false);
  const pendingCalls = calls.filter((call) => call.table === "money_obligations");
  assert.equal(pendingCalls.length, 2);
  assert.ok(pendingCalls[1]!.builder.steps.includes("range:1000-1999"));
});

test("an inconsistent close summary is rejected instead of trusted", async () => {
  const { client } = fakeClient({
    money_periods: [
      { data: PERIOD_ROW, error: null },
      { data: { successor_period_id: null }, error: null },
    ],
    "rpc:money_ledger_direction_totals": [
      {
        data: [{ inflowsMinor: 0, outflowsMinor: 0, recordCount: 0 }],
        error: null,
      },
    ],
    money_obligations: [{ data: [], error: null, count: 0 }],
    money_period_rollovers: [{ data: null, error: null }],
    "rpc:money_rollover_close_snapshot_summary": [
      {
        data: closeSummary({
          completeCloseEvidence: true,
          missingCloseDates: ["2026-11-20"],
        }),
        error: null,
      },
    ],
    money_policy_versions: [{ data: null, error: null }],
    money_period_rollover_bridges: [{ data: [], error: null, count: 0 }],
  });

  const result = await new SupabaseMoneyRolloverRepository(
    client,
  ).getSourceContext(ACTOR, PERIOD_ID);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value?.closeSnapshots, {
    available: false,
    reason: "close_snapshot_summary_invalid",
  });
});
