import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseMoneyBudgetRepository } from "../src/money/budget-repository";
import { SupabaseMoneyCoffeeRepository } from "../src/money/coffee-repository";
import { SupabaseMoneyPeriodRepository } from "../src/money/repository";

const ACTOR = createAuthenticatedActor("owner-money-05");
const VISIT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EXPENSE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("rebase adapter calls the explicit authenticated RPC and propagates failures", async () => {
  const periodId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const { client, rpcCalls } = fakeClient([{ data: [{ date: "2026-11-12", version: 2, availability: "available", unavailable_reason: null, cash_minor: 100, commitments_minor: 0, savings_target_minor: 0, savings_funded_minor: 0, emergency_target_minor: 0, emergency_used_minor: 0 }], error: null }]);
  const result = await new SupabaseMoneyPeriodRepository(client).rebaseDayStartBaseline(ACTOR, periodId);
  assert.equal(result.ok, true);
  assert.deepEqual(rpcCalls, [{ name: "money_rebase_day_start_baseline", args: { p_period_id: periodId } }]);
});

type QueryResult = { data: unknown; error: null | { code?: string; message?: string } };

class FakeBuilder {
  readonly steps: string[] = [];
  constructor(
    private readonly queue: QueryResult[],
    private readonly calls: FakeBuilder[],
  ) {}

  select(columns: string) {
    this.steps.push(`select:${columns}`);
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
  delete() {
    this.steps.push("delete");
    return this;
  }
  eq(column: string, value: unknown) {
    this.steps.push(`eq:${column}=${String(value)}`);
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
  is(column: string, value: unknown) {
    this.steps.push(`is:${column}=${String(value)}`);
    return this;
  }
  limit(value: number) {
    this.steps.push(`limit:${value}`);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.steps.push(`order:${column}:${String(options?.ascending)}`);
    return this;
  }
  range(from: number, to: number) {
    this.steps.push(`range:${from}-${to}`);
    return this;
  }
  maybeSingle() {
    this.steps.push("maybeSingle");
    return Promise.resolve(this.queue.shift() ?? { data: null, error: null });
  }
  single() {
    this.steps.push("single");
    return Promise.resolve(this.queue.shift() ?? { data: null, error: null });
  }
  then(resolve: (value: QueryResult) => unknown, reject: (error: unknown) => unknown) {
    return Promise.resolve(this.queue.shift() ?? { data: null, error: null }).then(
      resolve,
      reject,
    );
  }
}

function fakeClient(queue: QueryResult[]) {
  const calls: FakeBuilder[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const builder = new FakeBuilder(queue, calls);
      builder.steps.push(`from:${table}`);
      calls.push(builder);
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve(queue.shift() ?? { data: null, error: null });
    },
  };
  return { client: client as unknown as SupabaseClient, calls, rpcCalls };
}

const PLAN_ROW = {
  id: "plan-1",
  period_id: "period-1",
  currency: "MAD",
  allocations: { coffee: 7_000, groceries: 12_000 },
  savings_target_minor: 20_000,
  emergency_target_minor: null,
  coffee_weekly_spend_limit_minor: 7_000,
  coffee_weekly_visit_limit: 5,
  version: 2,
  created_at: "2026-11-09T00:00:00.000Z",
  updated_at: "2026-11-10T00:00:00.000Z",
};

test("budget repository always filters owner and period and maps integer values", async () => {
  const { client, calls } = fakeClient([{ data: PLAN_ROW, error: null }]);
  const repository = new SupabaseMoneyBudgetRepository(client);
  const result = await repository.getPlan(ACTOR, {
    periodId: "period-1",
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
  });
  assert.equal(result.ok, true);
  if (!result.ok || !result.value) return;
  assert.equal(result.value.allocations.coffee, 7_000);
  assert.equal(result.value.periodId, "period-1");
  assert.equal(result.value.periodStartDate, "2026-11-09");
  assert.equal(result.value.emergencyTargetMinor, null);
  const steps = calls[0]!.steps;
  assert.ok(steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
  assert.ok(steps.includes("eq:period_id=period-1"));
});

test("budget update carries owner, id and expected version", async () => {
  const { client, calls } = fakeClient([
    { data: { ...PLAN_ROW, version: 3 }, error: null },
  ]);
  const repository = new SupabaseMoneyBudgetRepository(client);
  const result = await repository.updatePlan(ACTOR, "plan-1", {
    values: {
      periodId: "period-1",
      periodStartDate: "2026-11-09",
      periodEndDate: "2026-11-30",
      allocations: { coffee: 8_000 },
      savingsTargetMinor: 20_000,
      emergencyTargetMinor: null,
      coffeeWeeklySpendLimitMinor: 7_000,
      coffeeWeeklyVisitLimit: 5,
    },
    expectedVersion: 2,
    updatedAt: "2026-11-11T00:00:00.000Z",
  });
  assert.equal(result.ok, true);
  const steps = calls[0]!.steps;
  assert.ok(steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
  assert.ok(steps.includes("eq:id=plan-1"));
  assert.ok(steps.includes("eq:version=2"));
  assert.ok(steps.some((step) => step.includes('"version":3')));
  // Immutable/identity columns are not granted for UPDATE; assigning them would
  // make every authenticated budget edit fail with permission denied.
  const updateStep = steps.find((step) => step.startsWith("update:"))!;
  assert.ok(!updateStep.includes("period_id"));
  assert.ok(!updateStep.includes("currency"));
});

test("coffee repository reads canonical amounts through the expense join", async () => {
  const { client, calls } = fakeClient([
    {
      data: [
        {
          id: VISIT_ID,
          visit_key: "visit-1",
          visit_fingerprint: "a".repeat(64),
          local_date: "2026-11-11",
          timezone: "Africa/Casablanca",
          note: null,
          version: 1,
          created_at: "2026-11-11T09:00:00.000Z",
          updated_at: "2026-11-11T09:00:00.000Z",
          lines: [
            {
              expense_id: EXPENSE_ID,
              expenses: {
                amount_minor: 2_500,
                category: "coffee",
                booking_date: "2026-11-11",
                deleted_at: null,
              },
            },
          ],
        },
      ],
      error: null,
    },
  ]);
  const repository = new SupabaseMoneyCoffeeRepository(client);
  const result = await repository.listVisits(ACTOR, {
    from: "2026-11-09",
    to: "2026-11-15",
    limit: 200,
    offset: 0,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value[0]!.lines[0]!.amountMinor, 2_500);
  assert.equal(result.value[0]!.lines[0]!.category, "coffee");
  const steps = calls[0]!.steps;
  assert.ok(steps.some((step) => step.includes("money_coffee_visit_lines")));
  assert.ok(steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
  assert.ok(steps.includes("gte:local_date=2026-11-09"));
  assert.ok(steps.includes("lte:local_date=2026-11-15"));
});

test("coffee visit creation commits identity and lines through one RPC", async () => {
  const { client, calls, rpcCalls } = fakeClient([
    { data: VISIT_ID, error: null },
    {
      data: {
        id: VISIT_ID,
        visit_key: "visit-1",
        visit_fingerprint: "a".repeat(64),
        local_date: "2026-11-11",
        timezone: "Africa/Casablanca",
        note: null,
        version: 1,
        created_at: "2026-11-11T09:00:00.000Z",
        updated_at: "2026-11-11T09:00:00.000Z",
        lines: [
          {
            expense_id: EXPENSE_ID,
            expenses: {
              amount_minor: 2_500,
              category: "coffee",
              booking_date: "2026-11-11",
              deleted_at: null,
            },
          },
        ],
      },
      error: null,
    },
  ]);
  const repository = new SupabaseMoneyCoffeeRepository(client);
  const result = await repository.createVisit(ACTOR, {
    values: {
      visitKey: "visit-1",
      localDate: "2026-11-11",
      timezone: "Africa/Casablanca",
      expenseIds: [EXPENSE_ID],
      note: null,
    },
    visitFingerprint: "a".repeat(64),
    createdAt: "2026-11-11T09:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.lines[0]!.expenseId, EXPENSE_ID);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]!.name, "money_record_coffee_visit");
  assert.deepEqual(rpcCalls[0]!.args.p_expense_ids, [EXPENSE_ID]);
  assert.equal(rpcCalls[0]!.args.p_visit_key, "visit-1");
  // Only the post-commit owner-scoped read follows the atomic RPC.
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.steps.includes(`eq:owner_user_id=${ACTOR.userId}`));
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

const CLOSE_ROW = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  period_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
};

test("close adapter calls the atomic RPC with every snapshot input and maps evidence", async () => {
  const { client, rpcCalls } = fakeClient([
    {
      data: {
        status: "closed",
        close: CLOSE_ROW,
        period: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          owner_user_id: ACTOR.userId,
          start_date: "2026-11-09",
          end_date: "2026-11-30",
          currency: "MAD",
          timezone: "Africa/Casablanca",
          active_date: "2026-11-12",
          lifecycle: "tracking",
          initialization: "initialized",
          opening_movement_id: null,
          provenance: {},
          settings: {},
          version: 2,
          created_at: "2026-11-09T00:00:00.000Z",
          updated_at: "2026-11-11T20:00:00.000Z",
        },
      },
      error: null,
    },
  ]);
  const repository = new SupabaseMoneyPeriodRepository(client);
  const result = await repository.closeDay(ACTOR, {
    periodId: CLOSE_ROW.period_id,
    expectedVersion: 1,
    date: "2026-11-11",
    note: "Closed with chicken",
    operationId: CLOSE_ROW.operation_id,
    closeFingerprint: CLOSE_ROW.close_fingerprint,
    includedMovementIds: [],
    createdAt: "2026-11-11T20:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "closed");
  assert.equal(result.value.period?.activeDate, "2026-11-12");
  assert.equal(result.value.close?.snapshot.expenseTotalMinor, 1_100);
  assert.equal(result.value.close?.snapshot.dailyReference.available, true);
  assert.equal(rpcCalls[0]!.name, "money_close_day");
  assert.equal(rpcCalls[0]!.args.p_expected_version, 1);
  assert.equal(rpcCalls[0]!.args.p_operation_id, CLOSE_ROW.operation_id);
});

test("close adapter preserves an actionable refusal status", async () => {
  const { client } = fakeClient([
    { data: { status: "baseline_unavailable", detail: "initial_setup_incomplete" }, error: null },
  ]);
  const result = await new SupabaseMoneyPeriodRepository(client).closeDay(ACTOR, {
    periodId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    expectedVersion: 1,
    date: "2026-11-11",
    note: null,
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    closeFingerprint: "a".repeat(64),
    includedMovementIds: [],
    createdAt: "2026-11-11T20:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "baseline_unavailable");
  assert.equal(result.value.detail, "initial_setup_incomplete");
  assert.equal(result.value.close, null);
});

test("restated close totals use the canonical day aggregate, not a capped page", async () => {
  const { client, rpcCalls, calls } = fakeClient([
    {
      data: {
        complete: true,
        rowCount: 2,
        expenseTotalMinor: 2_100,
        dailyIncludedSpendMinor: 1_100,
        flexibleExpenseTotalMinor: 1_100,
        fixedExpenseTotalMinor: 1_000,
        emergencyExpenseTotalMinor: 0,
        categoryTotals: { coffee: 1_100, bills: 1_000 },
      },
      error: null,
    },
  ]);
  const result = await new SupabaseMoneyPeriodRepository(client).getDayCloseCurrentTotals(
    ACTOR,
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "2026-11-11",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.complete, true);
  assert.equal(result.value.expenseTotalMinor, 2_100);
  assert.equal(result.value.dailyIncludedSpendMinor, 1_100);
  assert.equal(result.value.flexibleExpenseTotalMinor, 1_100);
  assert.equal(result.value.fixedExpenseTotalMinor, 1_000);
  assert.deepEqual(result.value.categoryTotals, { coffee: 1_100, bills: 1_000 });
  assert.deepEqual(rpcCalls, [{
    name: "money_day_expense_totals",
    args: {
      p_period_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p_date: "2026-11-11",
    },
  }]);
  assert.equal(calls.length, 0);
});
