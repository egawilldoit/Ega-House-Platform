import assert from "node:assert/strict";
import test from "node:test";

import type {
  AuthenticatedActor,
  ExpenseRepository,
  MoneyBudgetPlanCreateInput,
  MoneyBudgetPlanUpdateInput,
  MoneyBudgetRepository,
  MoneyCoffeeVisitCreateInput,
  MoneyCoffeeVisitListQuery,
  MoneyCoffeeVisitRepository,
} from "../src";
import {
  classifyMoneyExpense,
  createAuthenticatedActor,
  deleteMoneyCoffeeVisit,
  getMoneyCoffeeVisitUsage,
  getMoneyCoffeeWindow,
  getMoneyCoffeeWindowForPlan,
  getMoneyPeriodSpending,
  patchMoneyBudgetPlan,
  recordMoneyCoffeeVisit,
} from "../src";
import type {
  MoneyBudgetPlan,
  MoneyCoffeeVisitRecord,
  MoneyCoffeeVisitValues,
  MoneyPeriod,
} from "@ega/domain/money";
import type { PersonalExpense } from "@ega/domain/expenses";

const ACTOR = createAuthenticatedActor("owner-money-05");
const PERIOD = { periodStartDate: "2026-11-09", periodEndDate: "2026-11-30" };

const PERIOD_ROW: MoneyPeriod = {
  id: "period-1",
  startDate: PERIOD.periodStartDate,
  endDate: PERIOD.periodEndDate,
  currency: "MAD",
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-09",
  lifecycle: "tracking",
  initialization: "initialized",
  openingMovementId: null,
  provenance: { opening: null, createdFrom: "web" },
  settings: {},
  version: 1,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
};

function budgetDeps(budgets: MoneyBudgetRepository) {
  return {
    budgets,
    periods: {
      async findByExactRange() {
        return { ok: true as const, value: [PERIOD_ROW] };
      },
    },
  };
}

function budgetPlan(values: MoneyBudgetPlanCreateInput["values"]): MoneyBudgetPlan {
  return {
    id: "plan-1",
    ...values,
    currency: "MAD",
    version: 1,
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
  };
}

class FakeBudgetRepository implements MoneyBudgetRepository {
  plan: MoneyBudgetPlan | null = null;

  async getPlan(): Promise<{ ok: true; value: MoneyBudgetPlan | null }> {
    return { ok: true, value: this.plan };
  }

  async createPlan(
    _actor: AuthenticatedActor,
    input: MoneyBudgetPlanCreateInput,
  ): Promise<{ ok: true; value: MoneyBudgetPlan }> {
    if (this.plan) return { ok: false as never, error: { code: "conflict" } } as never;
    this.plan = budgetPlan(input.values);
    return { ok: true, value: this.plan };
  }

  async updatePlan(
    _actor: AuthenticatedActor,
    _id: string,
    input: MoneyBudgetPlanUpdateInput,
  ): Promise<{ ok: true; value: MoneyBudgetPlan }> {
    if (!this.plan) return { ok: false as never, error: { code: "notFound" } } as never;
    if (this.plan.version !== input.expectedVersion) {
      return { ok: false as never, error: { code: "conflict" } } as never;
    }
    this.plan = {
      ...this.plan,
      ...input.values,
      version: input.expectedVersion + 1,
      updatedAt: input.updatedAt,
    };
    return { ok: true, value: this.plan };
  }
}

function expense(id: string, category: PersonalExpense["category"], amountMinor = 3_000): PersonalExpense {
  return {
    id,
    kind: "expense",
    direction: "out",
    occurredAt: "2026-11-09T09:00:00.000Z",
    bookingDate: "2026-11-09",
    amountMinor,
    currency: "MAD",
    category,
    note: null,
    merchant: null,
    needVsWant: "want",
    paymentMethod: "card",
    purpose: null,
    countsInDaily: true,
    periodId: PERIOD_ROW.id,
    idempotencyKey: `key-${id}`,
    version: 1,
    deletedAt: null,
    createdAt: "2026-11-09T09:00:00.000Z",
    updatedAt: "2026-11-09T09:00:00.000Z",
  };
}

class FakeExpenseRepository implements ExpenseRepository {
  byId = new Map<string, PersonalExpense>();
  categorySpend = 0;
  lastSummaryWindow: {
    startUtcIso: string;
    endUtcExclusiveIso: string;
    startBookingDate?: string | null;
    endBookingDateExclusive?: string | null;
  } | null = null;

  async get(
    _actor: AuthenticatedActor,
    id: string,
  ): Promise<{ ok: true; value: PersonalExpense | null }> {
    return { ok: true, value: this.byId.get(id) ?? null };
  }

  async summarize(
    _actor: AuthenticatedActor,
    window: {
      startUtcIso: string;
      endUtcExclusiveIso: string;
      startBookingDate?: string | null;
      endBookingDateExclusive?: string | null;
    },
  ): Promise<{
    ok: true;
    value: {
      totalsByCategory: Record<string, number>;
      countsByCategory: Record<string, number>;
      recordCount: number;
      truncated: boolean;
    };
  }> {
    this.lastSummaryWindow = window;
    return {
      ok: true,
      value: {
        totalsByCategory: this.categorySpend > 0 ? { coffee: this.categorySpend } : {},
        countsByCategory: {},
        recordCount: this.categorySpend > 0 ? 1 : 0,
        truncated: false,
      },
    };
  }

  async update(
    _actor: AuthenticatedActor,
    id: string,
    input: { changes: Record<string, unknown>; expectedVersion: number; updatedAt: string },
  ): Promise<{ ok: true; value: PersonalExpense }> {
    const current = this.byId.get(id);
    if (!current) return { ok: false as never, error: { code: "notFound" } } as never;
    if (current.version !== input.expectedVersion) {
      return { ok: false as never, error: { code: "conflict" } } as never;
    }
    const updated: PersonalExpense = {
      ...current,
      ...(input.changes as Partial<PersonalExpense>),
      version: input.expectedVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.byId.set(id, updated);
    return { ok: true, value: updated };
  }

  async findByIdempotencyKey(): Promise<never> {
    throw new Error("not used");
  }
  async create(): Promise<never> {
    throw new Error("not used");
  }
  async list(): Promise<never> {
    throw new Error("not used");
  }
  async softDelete(): Promise<never> {
    throw new Error("not used");
  }
  async count(): Promise<never> {
    throw new Error("not used");
  }
}

class FakeCoffeeRepository implements MoneyCoffeeVisitRepository {
  visits: MoneyCoffeeVisitRecord[] = [];
  lastQuery: MoneyCoffeeVisitListQuery | null = null;

  async findByVisitKey(
    _actor: AuthenticatedActor,
    visitKey: string,
  ): Promise<{ ok: true; value: MoneyCoffeeVisitRecord | null }> {
    return {
      ok: true,
      value: this.visits.find((visit) => visit.visitKey === visitKey) ?? null,
    };
  }

  async createVisit(
    _actor: AuthenticatedActor,
    input: MoneyCoffeeVisitCreateInput,
  ): Promise<{ ok: true; value: MoneyCoffeeVisitRecord }> {
    const expenses = (input as unknown as { expenses?: PersonalExpense[] }).expenses ?? [];
    const visit: MoneyCoffeeVisitRecord = {
      id: `00000000-0000-4000-8000-${String(this.visits.length + 1).padStart(12, "0")}`,
      visitKey: input.values.visitKey,
      visitFingerprint: input.visitFingerprint,
      localDate: input.values.localDate,
      timezone: input.values.timezone,
      note: input.values.note,
      version: 1,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      lines: input.values.expenseIds.map((expenseId) => {
        const linked = expenses.find((item) => item.id === expenseId);
        return {
          expenseId,
          amountMinor: linked?.amountMinor ?? 0,
          category: linked?.category ?? "coffee",
          bookingDate: linked?.bookingDate ?? "2026-11-09",
          deletedAt: linked?.deletedAt ?? null,
        };
      }),
    };
    this.visits.push(visit);
    return { ok: true, value: visit };
  }

  async getVisit(): Promise<{ ok: true; value: MoneyCoffeeVisitRecord | null }> {
    return { ok: true, value: null };
  }

  async listVisits(
    _actor: AuthenticatedActor,
    query: MoneyCoffeeVisitListQuery,
  ): Promise<{ ok: true; value: MoneyCoffeeVisitRecord[] }> {
    this.lastQuery = query;
    return {
      ok: true,
      value: this.visits.filter(
        (visit) => visit.localDate >= query.from && visit.localDate <= query.to,
      ),
    };
  }

  async deleteVisit(
    _actor: AuthenticatedActor,
    id: string,
    expectedVersion: number,
  ): Promise<
    | { ok: true; value: { id: string; alreadyDeleted: boolean } }
    | { ok: false; error: { code: "notFound" } }
    | { ok: false; error: { code: "conflict" } }
  > {
    const index = this.visits.findIndex((visit) => visit.id === id);
    if (index < 0) return { ok: false, error: { code: "notFound" } };
    if (this.visits[index]!.version !== expectedVersion) {
      return { ok: false, error: { code: "conflict" } };
    }
    this.visits.splice(index, 1);
    return { ok: true, value: { id, alreadyDeleted: false } };
  }

  async listVisitIdsForExpense(
    _actor: AuthenticatedActor,
    expenseId: string,
  ): Promise<{ ok: true; value: string[] }> {
    return {
      ok: true,
      value: this.visits
        .filter((visit) => visit.lines.some((line) => line.expenseId === expenseId))
        .map((visit) => visit.id),
    };
  }
}

/** Keep linked expense data in the fake without a second production owner. */
function seedCoffeeRepository(
  repository: FakeCoffeeRepository,
  expenses: PersonalExpense[],
): void {
  const original = repository.createVisit.bind(repository);
  repository.createVisit = async (actor, input) => {
    const augmented = Object.assign(Object.create(input), { expenses });
    return original(actor, augmented as MoneyCoffeeVisitCreateInput);
  };
}

function visitValues(expenseIds: string[], visitKey = "visit-key-1"): MoneyCoffeeVisitValues {
  return {
    visitKey,
    localDate: "2026-11-09",
    timezone: "Africa/Casablanca",
    expenseIds,
    note: null,
  };
}

test("period allocation patch creates then merges with version fencing", async () => {
  const budgets = new FakeBudgetRepository();
  const created = await patchMoneyBudgetPlan(ACTOR, budgetDeps(budgets), {
    ...PERIOD,
    version: 0,
    allocations: { coffee: 7_000 },
    savingsTargetMinor: 20_000,
    coffeeWeeklyVisitLimit: 5,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.data.version, 1);
  assert.equal(created.data.allocations.coffee, 7_000);

  const merged = await patchMoneyBudgetPlan(ACTOR, budgetDeps(budgets), {
    ...PERIOD,
    version: 1,
    allocations: { groceries: 12_000, coffee: null },
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(merged.data.version, 2);
  assert.equal(merged.data.allocations.coffee, undefined);
  assert.equal(merged.data.allocations.groceries, 12_000);
  assert.equal(merged.data.savingsTargetMinor, 20_000);

  const stale = await patchMoneyBudgetPlan(ACTOR, budgetDeps(budgets), {
    ...PERIOD,
    version: 1,
    allocations: { fun: 1_000 },
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, "conflict");
});

test("routine spending never changes an existing budget plan", async () => {
  const budgets = new FakeBudgetRepository();
  await patchMoneyBudgetPlan(ACTOR, budgetDeps(budgets), {
    ...PERIOD,
    version: 0,
    allocations: { coffee: 7_000 },
    savingsTargetMinor: 20_000,
  });
  const before = JSON.parse(JSON.stringify(budgets.plan));
  const plan = budgets.plan;
  assert.ok(plan);

  // Run real routine spend paths between the snapshot and the reread: counting
  // a coffee visit and classifying the purchase. Neither may touch the plan.
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  expenses.byId.set(purchase.id, purchase);
  seedCoffeeRepository(coffee, [purchase]);
  await recordMoneyCoffeeVisit(ACTOR, { expenses, coffee }, visitValues([purchase.id]));
  await classifyMoneyExpense(ACTOR, { expenses, coffee }, {
    expenseId: purchase.id,
    version: 1,
    category: "groceries",
  });

  const reread = await budgets.getPlan();
  assert.equal(reread.ok, true);
  if (!reread.ok) return;
  assert.deepEqual(JSON.parse(JSON.stringify(reread.value)), before);
  assert.equal(plan.version, 1);
});

test("an ordinary coffee purchase records exactly one replayable counted visit", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  expenses.byId.set(purchase.id, purchase);
  seedCoffeeRepository(coffee, [purchase]);

  const first = await recordMoneyCoffeeVisit(
    ACTOR,
    { expenses, coffee },
    visitValues([purchase.id]),
  );
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.data.replayed, false);
  assert.equal(first.data.visit.lines.length, 1);

  const replay = await recordMoneyCoffeeVisit(
    ACTOR,
    { expenses, coffee },
    visitValues([purchase.id]),
  );
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.data.replayed, true);
  assert.equal(coffee.visits.length, 1);

  const changed = await recordMoneyCoffeeVisit(
    ACTOR,
    { expenses, coffee },
    { ...visitValues([purchase.id]), note: "different visit" },
  );
  assert.equal(changed.ok, false);
  if (!changed.ok) assert.equal(changed.code, "conflict");
});

test("multiple purchase lines in one visit count once and sum their canonical amounts", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const first = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  const second = expense("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "coffee", 1_800);
  expenses.byId.set(first.id, first);
  expenses.byId.set(second.id, second);
  seedCoffeeRepository(coffee, [first, second]);

  const recorded = await recordMoneyCoffeeVisit(
    ACTOR,
    { expenses, coffee },
    visitValues([first.id, second.id], "multi-line"),
  );
  assert.equal(recorded.ok, true);
  assert.equal(coffee.visits.length, 1);

  const window = await getMoneyCoffeeWindow(
    ACTOR,
    { expenses, coffee },
    {
      localDate: "2026-11-11",
      timezone: "Africa/Casablanca",
      ...PERIOD,
      spendLimitMinor: 5_000,
      visitLimit: 1,
    },
  );
  assert.equal(window.ok, true);
  if (!window.ok) return;
  assert.equal(window.data.countedVisitCount, 1);
  assert.equal(window.data.countedVisitSpendMinor, 4_300);
  assert.equal(window.data.remainingSpendMinor, 700);
  assert.equal(window.data.spendOvershootMinor, 0);
  assert.equal(window.data.visitOvershoot, 0);
  // The fake expense repository reports no category-coffee total separately.
  assert.equal(window.data.categoryCoffeeSpendMinor, 0);
});

test("coffee classified as groceries is rejected as a counted visit and leaves usage unchanged", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const groceries = expense("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "groceries", 2_500);
  expenses.byId.set(groceries.id, groceries);

  const recorded = await recordMoneyCoffeeVisit(
    ACTOR,
    { expenses, coffee },
    visitValues([groceries.id]),
  );
  assert.equal(recorded.ok, false);
  if (!recorded.ok) assert.equal(recorded.code, "validation");
  assert.equal(coffee.visits.length, 0);
});

test("category edit reports affected visit ids and reduces counted coffee usage", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  expenses.byId.set(purchase.id, purchase);
  seedCoffeeRepository(coffee, [purchase]);
  await recordMoneyCoffeeVisit(ACTOR, { expenses, coffee }, visitValues([purchase.id]));

  const classified = await classifyMoneyExpense(
    ACTOR,
    { expenses, coffee },
    { expenseId: purchase.id, version: 1, category: "groceries" },
  );
  assert.equal(classified.ok, true);
  if (!classified.ok) return;
  assert.equal(classified.data.previousCategory, "coffee");
  assert.equal(classified.data.countedCoffeeUsageChanged, true);
  assert.equal(classified.data.countedCoffeeVisitIds.length, 1);

  // The stored line still references canonical spending, but a non-coffee
  // category no longer contributes counted usage. The fake materializes the
  // live joined category the SQL adapter would read.
  const updated = expenses.byId.get(purchase.id);
  assert.equal(updated?.category, "groceries");
  coffee.visits[0]!.lines[0] = {
    ...coffee.visits[0]!.lines[0]!,
    category: "groceries",
  };
  const window = await getMoneyCoffeeWindow(
    ACTOR,
    { expenses, coffee },
    {
      localDate: "2026-11-09",
      timezone: "Africa/Casablanca",
      periodStartDate: PERIOD.periodStartDate,
      periodEndDate: PERIOD.periodEndDate,
    },
  );
  assert.equal(window.ok, true);
  if (!window.ok) return;
  assert.equal(window.data.countedVisitCount, 0);
  assert.equal(window.data.countedVisitSpendMinor, 0);

  // Classifying back to coffee restores counted usage and reports the change.
  const restored = await classifyMoneyExpense(
    ACTOR,
    { expenses, coffee },
    { expenseId: purchase.id, version: 2, category: "coffee" },
  );
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.data.countedCoffeeUsageChanged, true);
  coffee.visits[0]!.lines[0] = {
    ...coffee.visits[0]!.lines[0]!,
    category: "coffee",
  };
  const restoredWindow = await getMoneyCoffeeWindow(
    ACTOR,
    { expenses, coffee },
    {
      localDate: "2026-11-09",
      timezone: "Africa/Casablanca",
      periodStartDate: PERIOD.periodStartDate,
      periodEndDate: PERIOD.periodEndDate,
    },
  );
  assert.equal(restoredWindow.ok, true);
  if (!restoredWindow.ok) return;
  assert.equal(restoredWindow.data.countedVisitCount, 1);
  assert.equal(restoredWindow.data.countedVisitSpendMinor, 2_500);
});

test("classifying an unlinked coffee expense does not claim counted usage changed", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  expenses.byId.set(purchase.id, purchase);
  const result = await classifyMoneyExpense(
    ACTOR,
    { expenses, coffee },
    { expenseId: purchase.id, version: 1, category: "groceries" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.countedCoffeeVisitIds.length, 0);
  assert.equal(result.data.countedCoffeeUsageChanged, false);
});

test("coffee window clips to a partial week and asks only for in-period dates", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const inWeek = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  expenses.byId.set(inWeek.id, inWeek);
  seedCoffeeRepository(coffee, [inWeek]);
  await recordMoneyCoffeeVisit(ACTOR, { expenses, coffee }, visitValues([inWeek.id]));
  // Move the visit into the clipped in-period portion of the week (the fake
  // repository filters by owner-local date exactly like the SQL adapter).
  const movedVisit = coffee.visits[0]!;
  coffee.visits[0] = {
    ...movedVisit,
    localDate: "2026-11-11",
    lines: movedVisit.lines.map((line) => ({ ...line, bookingDate: "2026-11-11" })),
  };

  const window = await getMoneyCoffeeWindow(
    ACTOR,
    { expenses, coffee },
    {
      localDate: "2026-11-11",
      timezone: "Africa/Casablanca",
      periodStartDate: "2026-11-10",
      periodEndDate: PERIOD.periodEndDate,
    },
  );
  assert.equal(window.ok, true);
  if (!window.ok) return;
  assert.equal(window.data.weekStart, "2026-11-10");
  assert.equal(window.data.weekEnd, "2026-11-15");
  assert.equal(window.data.clippedToPeriod, true);
  assert.deepEqual(coffee.lastQuery, {
    from: "2026-11-10",
    to: "2026-11-15",
    limit: 200,
    offset: 0,
  });
  assert.equal(window.data.countedVisitCount, 1);
  // The canonical category summary must use booking dates, not UTC instants, so
  // date-only coffee rows are included and the window is timezone-stable.
  assert.deepEqual(expenses.lastSummaryWindow?.startBookingDate, "2026-11-10");
  assert.deepEqual(expenses.lastSummaryWindow?.endBookingDateExclusive, "2026-11-16");
});

test("period spending uses the inclusive period dates rather than the calendar month", async () => {
  const expenses = new FakeExpenseRepository();
  expenses.categorySpend = 4_300;
  const result = await getMoneyPeriodSpending(ACTOR, expenses, {
    periodStartDate: "2026-11-09",
    periodEndDate: "2026-11-30",
    timezone: "Africa/Casablanca",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.totalsByCategory.coffee, 4_300);
  assert.equal(result.data.periodStartDate, "2026-11-09");
  assert.equal(result.data.truncated, false);
  assert.equal(expenses.lastSummaryWindow?.startBookingDate, "2026-11-09");
  assert.equal(expenses.lastSummaryWindow?.endBookingDateExclusive, "2026-12-01");
});

test("coffee limits resolve from the canonical period plan, not caller input", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  expenses.byId.set(purchase.id, purchase);
  seedCoffeeRepository(coffee, [purchase]);
  await recordMoneyCoffeeVisit(ACTOR, { expenses, coffee }, visitValues([purchase.id]));

  const result = await getMoneyCoffeeWindowForPlan(
    ACTOR,
    { expenses, coffee },
    {
      localDate: "2026-11-09",
      timezone: "Africa/Casablanca",
      periodStartDate: PERIOD.periodStartDate,
      periodEndDate: PERIOD.periodEndDate,
      plan: {
        coffeeWeeklySpendLimitMinor: 2_000,
        coffeeWeeklyVisitLimit: 1,
      },
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.countedVisitSpendMinor, 2_500);
  assert.equal(result.data.spendOvershootMinor, 500);
  assert.equal(result.data.remainingVisits, 0);
});

test("a counted visit cannot move a purchase to another booking day", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const purchase = {
    ...expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500),
    bookingDate: "2026-11-08",
  };
  expenses.byId.set(purchase.id, purchase);
  seedCoffeeRepository(coffee, [purchase]);
  const result = await recordMoneyCoffeeVisit(
    ACTOR,
    { expenses, coffee },
    { ...visitValues([purchase.id]), localDate: "2026-11-09" },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "validation");
  assert.equal(coffee.visits.length, 0);
});

test("a re-dated purchase still replays its original visit by key", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  expenses.byId.set(purchase.id, purchase);
  seedCoffeeRepository(coffee, [purchase]);
  const values = visitValues([purchase.id]);
  const first = await recordMoneyCoffeeVisit(ACTOR, { expenses, coffee }, values);
  assert.equal(first.ok, true);
  expenses.byId.set(purchase.id, { ...purchase, bookingDate: "2026-11-10" });
  const replay = await recordMoneyCoffeeVisit(ACTOR, { expenses, coffee }, values);
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.data.replayed, true);
  assert.equal(coffee.visits.length, 1);
});

test("a counted line whose booking day no longer matches stops counting", async () => {
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  seedCoffeeRepository(coffee, [purchase]);
  const expenses = new FakeExpenseRepository();
  expenses.byId.set(purchase.id, purchase);
  await recordMoneyCoffeeVisit(ACTOR, { expenses, coffee }, visitValues([purchase.id]));
  coffee.visits[0]!.lines[0] = {
    ...coffee.visits[0]!.lines[0]!,
    bookingDate: "2026-11-10",
  };
  const result = await getMoneyCoffeeVisitUsage(
    ACTOR,
    coffee,
    { from: "2026-11-09", to: "2026-11-09" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.countedVisitCount, 0);
  assert.equal(result.data.countedVisitSpendMinor, 0);
});

test("coffee visit delete is version-fenced and idempotent", async () => {
  const expenses = new FakeExpenseRepository();
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  expenses.byId.set(purchase.id, purchase);
  seedCoffeeRepository(coffee, [purchase]);
  await recordMoneyCoffeeVisit(ACTOR, { expenses, coffee }, visitValues([purchase.id]));
  const visit = coffee.visits[0]!;

  const stale = await deleteMoneyCoffeeVisit(ACTOR, coffee, {
    id: visit.id,
    version: visit.version + 1,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, "conflict");
  assert.equal(coffee.visits.length, 1);

  const removed = await deleteMoneyCoffeeVisit(ACTOR, coffee, {
    id: visit.id,
    version: visit.version,
  });
  assert.equal(removed.ok, true);
  if (!removed.ok) return;
  assert.equal(removed.data.alreadyDeleted, false);
  assert.equal(coffee.visits.length, 0);

  const retry = await deleteMoneyCoffeeVisit(ACTOR, coffee, {
    id: visit.id,
    version: visit.version,
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.data.alreadyDeleted, true);
});

test("period coffee usage is not limited to the current week", async () => {
  const coffee = new FakeCoffeeRepository();
  const purchase = expense("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "coffee", 2_500);
  seedCoffeeRepository(coffee, [purchase]);
  await recordMoneyCoffeeVisit(ACTOR, {
    expenses: (() => {
      const expenses = new FakeExpenseRepository();
      expenses.byId.set(purchase.id, purchase);
      return expenses;
    })(),
    coffee,
  }, visitValues([purchase.id]));
  const firstVisit = coffee.visits[0]!;
  coffee.visits[0] = {
    ...firstVisit,
    localDate: "2026-11-02",
    lines: firstVisit.lines.map((line) => ({ ...line, bookingDate: "2026-11-02" })),
  };
  coffee.visits.push({
    ...coffee.visits[0]!,
    id: "visit-2",
    visitKey: "visit-key-2",
    localDate: "2026-11-20",
    lines: coffee.visits[0]!.lines.map((line) => ({
      ...line,
      bookingDate: "2026-11-20",
    })),
  });
  const result = await getMoneyCoffeeVisitUsage(
    ACTOR,
    coffee,
    { from: "2026-11-09", to: "2026-11-30" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.countedVisitCount, 1);
  assert.equal(result.data.countedVisitSpendMinor, 2_500);
  assert.equal(coffee.lastQuery?.from, "2026-11-09");
  assert.equal(coffee.lastQuery?.to, "2026-11-30");
});
