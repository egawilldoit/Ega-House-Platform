import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseMoneyBudgetRepository } from "../src/money/budget-repository";
import { SupabaseMoneyCoffeeRepository } from "../src/money/coffee-repository";

const ACTOR = createAuthenticatedActor("owner-money-05");
const VISIT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EXPENSE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
  const client = {
    from(table: string) {
      const builder = new FakeBuilder(queue, calls);
      builder.steps.push(`from:${table}`);
      calls.push(builder);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
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

test("coffee visit creation writes owner-scoped visit then lines", async () => {
  const { client, calls } = fakeClient([
    { data: { id: VISIT_ID }, error: null },
    { data: null, error: null },
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
        lines: [],
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
  assert.ok(calls[0]!.steps.some((step) => step.includes(ACTOR.userId)));
  const lineInsert = calls[1]!.steps.find((step) => step.startsWith("insert:"));
  assert.ok(lineInsert);
  assert.ok(lineInsert!.includes(ACTOR.userId));
  assert.ok(lineInsert!.includes(EXPENSE_ID));
});
