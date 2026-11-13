import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRoutineEntryAllowed,
  closeMoneyDay,
  createAuthenticatedActor,
  getMoneyDayCloseView,
  moneyDayCloseFingerprint,
  type MoneyDayCloseRecordInput,
  type MoneyMovementRepository,
  type MoneyPeriodRepository,
} from "../src/index";
import { parseMoneyDayCloseInput } from "@ega/domain/money";
import type {
  MoneyDayClose,
  MoneyDayCloseSnapshot,
  MoneyLedgerRow,
  MoneyPeriod,
} from "@ega/domain/money";

const ACTOR = createAuthenticatedActor("owner-close");
const PERIOD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makePeriod(patch: Partial<MoneyPeriod> = {}): MoneyPeriod {
  return {
    id: PERIOD_ID,
    startDate: "2026-11-09",
    endDate: "2026-11-30",
    currency: "MAD",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-29",
    lifecycle: "tracking",
    initialization: "initialized",
    openingMovementId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    provenance: { opening: null, createdFrom: "web" },
    settings: {},
    version: 3,
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-29T00:00:00.000Z",
    ...patch,
  };
}

function snapshot(patch: Partial<MoneyDayCloseSnapshot> = {}): MoneyDayCloseSnapshot {
  return {
    currency: "MAD",
    expenseTotalMinor: 1100,
    dailyIncludedSpendMinor: 1100,
    flexibleExpenseTotalMinor: 1100,
    fixedExpenseTotalMinor: 0,
    emergencyExpenseTotalMinor: 0,
    categoryTotals: { coffee: 1100 },
    recordedCashMinor: 48900,
    recordedCashBasis: "recorded",
    dayStartBaseline: {
      date: "2026-11-29",
      version: 1,
      availability: "available",
      policyVersionId: null,
      cashMinor: 50000,
      commitmentsMinor: 0,
      savingsTargetMinor: 0,
      savingsFundedMinor: 0,
      emergencyTargetMinor: 0,
      emergencyUsedMinor: 0,
    },
    dailyReference: {
      available: true,
      algorithm: "safe-flexible-start-of-day-v1",
      daysRemaining: 2,
      safePoolMinor: 50000,
      referenceMinor: 25000,
      dailyRemainingMinor: 23900,
    },
    reserves: {
      recordedCashMinor: 48900,
      unpaidCommitmentsMinor: 0,
      savingsTargetMinor: 0,
      fundedSavingsMinor: 0,
      unfundedSavingsMinor: 0,
      emergencyTargetMinor: 0,
      emergencyUsedMinor: 0,
      remainingEmergencyMinor: 0,
      safeFlexibleMinor: 50000,
    },
    ...patch,
  };
}

function makeClose(patch: Partial<MoneyDayClose> = {}): MoneyDayClose {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    periodId: PERIOD_ID,
    closeDate: "2026-11-29",
    status: "closed",
    note: "Closed with chicken",
    operationId: OPERATION,
    closeFingerprint: "a".repeat(64),
    expectedPeriodVersion: 3,
    periodVersionAfter: 4,
    activeDateAfter: "2026-11-30",
    lifecycleAfter: "tracking",
    isFinalDay: false,
    algorithmVersion: "safe-flexible-start-of-day-v1",
    policyVersionId: null,
    policyVersion: null,
    baselineVersion: 1,
    includedMovementIds: [],
    snapshot: snapshot(),
    createdAt: "2026-11-29T20:00:00.000Z",
    ...patch,
  };
}

function movement(id: string, amountMinor: number, bookingDate: string): MoneyLedgerRow {
  return {
    id,
    kind: "expense",
    direction: "out",
    amountMinor,
    currency: "MAD",
    category: "eating_out",
    note: "chicken",
    merchant: null,
    needVsWant: "need",
    paymentMethod: null,
    purpose: "flexible",
    countsInDaily: true,
    bookingDate,
    occurredAt: null,
    periodId: PERIOD_ID,
    version: 1,
    deletedAt: null,
    createdAt: `${bookingDate}T12:00:00.000Z`,
    updatedAt: `${bookingDate}T12:00:00.000Z`,
  };
}

type Harness = {
  repository: Pick<
    MoneyPeriodRepository,
    "findTracking" | "findById" | "list" | "closeDay"
  > & {
    getDayCloseByOperation: NonNullable<MoneyPeriodRepository["getDayCloseByOperation"]>;
    getDayStartBaseline: NonNullable<MoneyPeriodRepository["getDayStartBaseline"]>;
  };
  movements: MoneyMovementRepository;
  calls: {
    close: MoneyDayCloseRecordInput[];
    created: string[];
  };
};

function harness(options: {
  period?: MoneyPeriod;
  existingClose?: MoneyDayClose | null;
  baselineUnavailable?: boolean;
  failSecondPurchase?: boolean;
  closeAttempt?: Awaited<ReturnType<NonNullable<MoneyPeriodRepository["closeDay"]>>>;
} = {}): Harness {
  const period = options.period ?? makePeriod();
  const calls = { close: [] as MoneyDayCloseRecordInput[], created: [] as string[] };
  const repository: Harness["repository"] = {
    async findTracking() {
      return { ok: true, value: period.lifecycle === "tracking" ? period : null };
    },
    async findById(_actor, id) {
      return { ok: true, value: id === period.id ? period : null };
    },
    async list() {
      return { ok: true, value: [period] };
    },
    async getDayCloseByOperation() {
      return { ok: true, value: options.existingClose ?? null };
    },
    async getDayStartBaseline(_actor, _periodId, date) {
      return {
        ok: true,
        value: options.baselineUnavailable
          ? {
              date,
              version: 1,
              availability: "unavailable",
              unavailableReason: "initial_setup_incomplete",
              cashMinor: null,
              commitmentsMinor: null,
              savingsTargetMinor: null,
              savingsFundedMinor: null,
              emergencyTargetMinor: null,
              emergencyUsedMinor: null,
            }
          : {
              date,
              version: 1,
              availability: "available",
              unavailableReason: null,
              cashMinor: 50_000,
              commitmentsMinor: 0,
              savingsTargetMinor: 12_000,
              savingsFundedMinor: 0,
              emergencyTargetMinor: 3_000,
              emergencyUsedMinor: 0,
            },
      };
    },
    async closeDay(_actor, input) {
      calls.close.push(input);
      if (options.closeAttempt) return options.closeAttempt;
      return {
        ok: true,
        value: {
          status: "closed",
          detail: null,
          close: makeClose({
            closeFingerprint: input.closeFingerprint,
            includedMovementIds: input.includedMovementIds,
            note: input.note,
          }),
          period: { ...period, activeDate: "2026-11-30", version: 4 },
        },
      };
    },
  };
  const movements: MoneyMovementRepository = {
    async findByIdempotencyKey() {
      return { ok: true, value: null };
    },
    async create(_actor, input) {
      calls.created.push(input.values.idempotencyKey);
      if (options.failSecondPurchase && calls.created.length === 2) {
        return { ok: false, error: { code: "conflict" } };
      }
      return {
        ok: true,
        value: movement(
          `eeeeeeee-eeee-4eee-8eee-${String(calls.created.length).padStart(12, "0")}`,
          input.values.amountMinor,
          input.values.bookingDate,
        ),
      };
    },
    async get() {
      return { ok: true, value: null };
    },
    async list() {
      return { ok: true, value: [] };
    },
    async update() {
      return { ok: false, error: { code: "unknown" } };
    },
    async aggregate() {
      return { ok: true, value: { rows: [], truncated: false } };
    },
  };
  return { repository, movements, calls };
}

const INPUT = {
  version: 3,
  operationId: OPERATION,
  note: "Closed with chicken",
  finalPurchases: [
    {
      amountMinor: 2500,
      category: "eating_out",
      needVsWant: "need",
      purpose: "flexible",
      idempotencyKey: "close-purchase-1",
    },
  ],
};

test("records final purchases before closing and advances once", async () => {
  const { repository, movements, calls } = harness();
  const result = await closeMoneyDay(ACTOR, { periods: repository, movements }, INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.period.activeDate, "2026-11-30");
  assert.equal(result.data.replayed, false);
  assert.equal(result.data.committedPurchases.length, 1);
  assert.deepEqual(calls.close[0]!.includedMovementIds, [
    "eeeeeeee-eeee-4eee-8eee-000000000001",
  ]);
  assert.match(calls.close[0]!.closeFingerprint, /^[0-9a-f]{64}$/);
});

test("a failed final purchase prevents the close and keeps committed items recoverable", async () => {
  const { repository, movements, calls } = harness({ failSecondPurchase: true });
  const result = await closeMoneyDay(
    ACTOR,
    { periods: repository, movements },
    {
      ...INPUT,
      finalPurchases: [
        ...INPUT.finalPurchases,
        {
          amountMinor: 1100,
          category: "coffee",
          needVsWant: "want",
          idempotencyKey: "close-purchase-2",
        },
      ],
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "final_purchase_failed");
  assert.equal(result.committedPurchases?.length, 1);
  assert.equal(result.failedPurchaseIndex, 1);
  assert.match(result.errorMessage, /day was not closed/);
  assert.equal(calls.close.length, 0);
});

test("an ambiguous retry returns the retained close without recording purchases twice", async () => {
  const parsed = parseMoneyDayCloseInput(INPUT);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const retained = makeClose({
    closeFingerprint: moneyDayCloseFingerprint(parsed.value, {
      periodId: PERIOD_ID,
      date: "2026-11-29",
    }),
    note: INPUT.note,
  });
  const { repository, movements, calls } = harness({ existingClose: retained });
  const result = await closeMoneyDay(ACTOR, { periods: repository, movements }, INPUT);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.replayed, true);
  assert.equal(result.data.close.id, retained.id);
  assert.deepEqual(calls.created, []);
  assert.deepEqual(calls.close, []);
});

test("a changed request under the same operation conflicts", async () => {
  const retained = makeClose({ closeFingerprint: "f".repeat(64) });
  const { repository, movements } = harness({ existingClose: retained });
  const result = await closeMoneyDay(ACTOR, { periods: repository, movements }, INPUT);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "operation_conflict");
});

test("a lagging active date is not replaced and a later day cannot be skipped", async () => {
  const { repository, movements } = harness();
  const skipped = await closeMoneyDay(
    ACTOR,
    { periods: repository, movements },
    { ...INPUT, version: 3, date: "2026-11-30" },
  );
  assert.equal(skipped.ok, false);
  if (!skipped.ok) assert.equal(skipped.reason, "close_date_not_active");

  const lagging = await closeMoneyDay(
    ACTOR,
    { periods: repository, movements },
    { ...INPUT, version: 3, date: "2026-11-28" },
  );
  assert.equal(lagging.ok, false);
  if (!lagging.ok) assert.equal(lagging.reason, "close_date_not_active");
});

test("retained close evidence is compared with restated live totals", async () => {
  const period = makePeriod();
  const close = makeClose();
  const view = await getMoneyDayCloseView(
    ACTOR,
    {
      periods: {
        async sumLedgerByDirection() {
          return {
            ok: true,
            value: {
              inflowsMinor: 0,
              outflowsMinor: 2100,
              recordCount: 1,
              truncated: false,
            },
          };
        },
        async getDayCloseCurrentTotals() {
          return {
            ok: true,
            value: {
              complete: true,
              expenseTotalMinor: 2100,
              dailyIncludedSpendMinor: 2100,
              flexibleExpenseTotalMinor: 2100,
              fixedExpenseTotalMinor: 0,
              emergencyExpenseTotalMinor: 0,
              categoryTotals: { coffee: 1100, eating_out: 1000 },
            },
          };
        },
      },
    },
    period,
    { amountMinor: 50000 },
    close,
  );
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.equal(view.data.comparison.available, true);
  if (!view.data.comparison.available) return;
  assert.equal(view.data.comparison.changed, true);
  assert.ok(view.data.comparison.changedFields.includes("expenseTotal"));
  assert.ok(view.data.comparison.changedFields.includes("categoryTotals"));
  assert.ok(view.data.comparison.changedFields.includes("recordedCash"));
  assert.equal(view.data.comparison.restated.recordedCashMinor, 47900);
});

test("after the final day, routine entries require an explicit rollover or correction", async () => {
  const ended = makePeriod({ lifecycle: "ended", activeDate: "2026-11-30" });
  const result = await assertRoutineEntryAllowed(
    ACTOR,
    {
      async findTracking() {
        return { ok: true, value: null };
      },
      async list() {
        return { ok: true, value: [ended] };
      },
    },
    "2026-11-30",
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.errorMessage, /explicit historical correction path/);
  }
});

test("an unavailable baseline refuses the close before recording final purchases", async () => {
  const { repository, movements, calls } = harness({ baselineUnavailable: true });
  const result = await closeMoneyDay(ACTOR, { periods: repository, movements }, INPUT);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "baseline_unavailable");
  assert.match(result.errorMessage, /day-start baseline/);
  assert.deepEqual(calls.created, []);
  assert.deepEqual(calls.close, []);
});
