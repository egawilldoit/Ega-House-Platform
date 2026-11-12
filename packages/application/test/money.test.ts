import assert from "node:assert/strict";
import test from "node:test";

import type {
  MoneyLedgerRow,
  MoneyOpening,
  MoneyPeriod,
} from "@ega/domain/money";

import {
  createAuthenticatedActor,
  getMoneyCashPosition,
  projectMoneyReserves,
  type MoneyAggregate,
  type MoneyCreateRecordInput,
  type MoneyIdempotencyReceipt,
  type MoneyMovementRepository,
  type MoneyPeriodRepository,
  type MoneyUpdateRecordInput,
} from "../src";
import {
  createMovement,
  getMoneyMovementTotals,
  listMovements,
  updateMovement,
} from "../src/money/service";

const ACTOR = createAuthenticatedActor("owner-1");
const OTHER_ACTOR = createAuthenticatedActor("owner-2");

test("MONEY-08 current reserve projection preserves disjoint protections and releases matching payments and savings", () => {
  const base = { cutoffDate: "2026-11-12", recordedCashMinor: 68_900,
    unpaidCommitmentsMinor: 10_000, savingsTargetMinor: 20_000,
    savingsFundedMinor: 0, emergencyTargetMinor: 5_000,
    emergencyUsedMinor: 0, complete: true } as const;
  const before = projectMoneyReserves(base);
  assert.equal(before.available, true);
  if (before.available) assert.equal(before.reserves.safeFlexibleMinor, 33_900);
  const paid = projectMoneyReserves({ ...base, recordedCashMinor: 58_900, unpaidCommitmentsMinor: 0 });
  assert.equal(paid.available, true);
  if (paid.available) assert.equal(paid.reserves.safeFlexibleMinor, 33_900);
  const funded = projectMoneyReserves({ ...base, recordedCashMinor: 48_900, savingsFundedMinor: 20_000 });
  assert.equal(funded.available, true);
  if (funded.available) assert.equal(funded.reserves.safeFlexibleMinor, 33_900);
  const emergencySpent = projectMoneyReserves({ ...base, recordedCashMinor: 63_900, emergencyUsedMinor: 5_000 });
  assert.equal(emergencySpent.available, true);
  if (emergencySpent.available) {
    assert.equal(emergencySpent.reserves.remainingEmergencyMinor, 0);
    assert.equal(emergencySpent.reserves.safeFlexibleMinor, 33_900);
  }
  const incomplete = projectMoneyReserves({ ...base, savingsFundedMinor: null });
  assert.deepEqual(incomplete, { available: false, currency: "MAD", reason: "reserve_inputs_incomplete", cutoffDate: base.cutoffDate });
});

type Stored = MoneyLedgerRow & {
  ownerUserId: string;
  createFingerprint: string;
  idempotencyKey: string;
};

const UNUSED = async (): Promise<never> => {
  throw new Error("not used by this test");
};

function movement(overrides: Partial<Stored> = {}): Stored {
  return {
    id: `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`,
    kind: "expense",
    direction: "out",
    amountMinor: 1100,
    currency: "MAD",
    category: "coffee",
    note: null,
    merchant: null,
    needVsWant: "want",
    paymentMethod: null,
    purpose: null,
    countsInDaily: true,
    bookingDate: "2026-11-11",
    occurredAt: null,
    periodId: null,
    version: 1,
    deletedAt: null,
    createdAt: "2026-11-11T10:00:00.000Z",
    updatedAt: "2026-11-11T10:00:00.000Z",
    ownerUserId: ACTOR.userId,
    createFingerprint: "f".repeat(64),
    idempotencyKey: "generated",
    ...overrides,
  };
}

function periodRecord(overrides: Partial<MoneyPeriod> = {}): MoneyPeriod {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    currency: "MAD",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-11",
    lifecycle: "tracking",
    initialization: "initialized",
    openingMovementId: "00000000-0000-4000-8000-000000000002",
    provenance: {
      opening: {
        source: "user_entered",
        recordedAt: "2026-11-11T10:00:00.000Z",
        cutoffDate: "2026-11-08",
        evidence: null,
        note: null,
        corrections: [],
      },
      createdFrom: "web",
    },
    settings: {},
    version: 1,
    createdAt: "2026-11-11T10:00:00.000Z",
    updatedAt: "2026-11-11T10:00:00.000Z",
    ...overrides,
  };
}

const OPENING_500: MoneyOpening = {
  id: "00000000-0000-4000-8000-000000000002",
  amountMinor: 50_000,
  currency: "MAD",
  bookingDate: "2026-11-01",
  version: 1,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

function makeRepository(options: { periods?: MoneyPeriod[] } = {}) {
  const rows: Stored[] = [];
  const periods = options.periods ?? [];
  let sequence = 0;

  function publicRow(row: Stored): MoneyLedgerRow {
    const {
      ownerUserId: _owner,
      createFingerprint: _fp,
      idempotencyKey: _key,
      ...rest
    } = row;
    return rest;
  }

  const repository: MoneyMovementRepository = {
    async findByIdempotencyKey(actor, key) {
      const found = rows.find(
        (row) => row.ownerUserId === actor.userId && row.idempotencyKey === key,
      );
      if (!found) return { ok: true, value: null };
      const receipt: MoneyIdempotencyReceipt = {
        movement: publicRow(found),
        createFingerprint: found.createFingerprint,
      };
      return { ok: true, value: receipt };
    },
    async create(actor, input: MoneyCreateRecordInput) {
      sequence += 1;
      const row = movement({
        id: `11111111-1111-4111-8111-${String(sequence).padStart(12, "0")}`,
        kind: input.values.kind,
        direction: input.values.direction,
        amountMinor: input.values.amountMinor,
        category: input.values.category,
        note: input.values.note,
        merchant: input.values.merchant,
        needVsWant: input.values.needVsWant,
        paymentMethod: input.values.paymentMethod,
        purpose: input.values.purpose,
        countsInDaily: input.values.countsInDaily,
        bookingDate: input.values.bookingDate,
        occurredAt: input.values.occurredAt,
        periodId: input.periodId,
        ownerUserId: actor.userId,
        createFingerprint: input.createFingerprint,
        idempotencyKey: input.values.idempotencyKey,
      });
      rows.push(row);
      return { ok: true, value: publicRow(row) };
    },
    async get(actor, id) {
      const row = rows.find((item) => item.id === id && item.ownerUserId === actor.userId);
      return { ok: true, value: row && !row.deletedAt ? publicRow(row) : null };
    },
    async list(actor, query) {
      const filtered = rows.filter((row) => {
        if (row.ownerUserId !== actor.userId || row.deletedAt) return false;
        if (query.from && row.bookingDate < query.from) return false;
        if (query.to && row.bookingDate > query.to) return false;
        if (query.cutoff && row.bookingDate > query.cutoff) return false;
        if (query.kind && row.kind !== query.kind) return false;
        return true;
      });
      filtered.sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1));
      return {
        ok: true,
        value: filtered.slice(query.offset, query.offset + query.limit).map(publicRow),
      };
    },
    async update(actor, id, input: MoneyUpdateRecordInput) {
      const index = rows.findIndex(
        (row) => row.id === id && row.ownerUserId === actor.userId,
      );
      if (index < 0) return { ok: false, error: { code: "notFound" } };
      const current = rows[index]!;
      if (current.version !== input.expectedVersion) {
        return { ok: false, error: { code: "conflict" } };
      }
      const next: Stored = {
        ...current,
        ...input.changes,
        version: current.version + 1,
        updatedAt: input.updatedAt,
      };
      rows[index] = next;
      return { ok: true, value: publicRow(next) };
    },
    async aggregate(actor, query): Promise<{ ok: true; value: MoneyAggregate }> {
      const filtered = rows.filter(
        (row) =>
          row.ownerUserId === actor.userId &&
          !row.deletedAt &&
          row.bookingDate <= query.cutoff &&
          (!query.startDate || row.bookingDate >= query.startDate),
      );
      return {
        ok: true,
        value: {
          rows: filtered.map((row) => ({
            id: row.id,
            kind: row.kind,
            direction: row.direction,
            amountMinor: row.amountMinor,
            countsInDaily: row.countsInDaily,
            purpose: row.purpose,
            bookingDate: row.bookingDate,
          })),
          truncated: false,
        },
      };
    },
  };

  const periodRepository: MoneyPeriodRepository = {
    async findTracking(actor) {
      return {
        ok: true,
        value:
          periods.find(
            (candidate) =>
              candidate.lifecycle === "tracking" &&
              candidate.id !== "other-owner-period",
          ) ?? null,
      };
    },
    async list(_actor, limit) {
      return { ok: true, value: periods.slice(0, limit) };
    },
    async sumLedgerByDirection(actor, window) {
      let inflowsMinor = 0;
      let outflowsMinor = 0;
      let recordCount = 0;
      for (const row of rows) {
        if (row.ownerUserId !== actor.userId || row.deletedAt) continue;
        if (row.kind === "opening") continue;
        if (row.bookingDate < window.startDate) continue;
        if (row.bookingDate > window.endDateInclusive) continue;
        recordCount += 1;
        if (row.direction === "in") inflowsMinor += row.amountMinor;
        else outflowsMinor += row.amountMinor;
      }
      return { ok: true, value: { inflowsMinor, outflowsMinor, recordCount, truncated: false } };
    },
    findById: UNUSED,
    findByExactRange: UNUSED,
    findOverlapping: UNUSED,
    create: UNUSED,
    update: UNUSED,
    getOpening: UNUSED,
    ledgerOverview: UNUSED,
  };

  return {
    repository,
    periodRepository,
    rows,
  };
}

function incomeInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "income",
    amountMinor: 20_000,
    bookingDate: "2026-11-09",
    note: "salary",
    idempotencyKey: "income-1",
    ...overrides,
  };
}

function expenseInput(overrides: Record<string, unknown> = {}) {
  return {
    kind: "expense",
    amountMinor: 1100,
    category: "coffee",
    needVsWant: "want",
    bookingDate: "2026-11-11",
    idempotencyKey: "coffee-1",
    ...overrides,
  };
}

test("createMovement stamps income as a posted inflow and replays a stable key", async () => {
  const { repository, periodRepository } = makeRepository();
  const first = await createMovement(ACTOR, repository, incomeInput(), {
    periods: periodRepository,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.data.movement.kind, "income");
  assert.equal(first.data.movement.direction, "in");
  assert.equal(first.data.movement.countsInDaily, false);
  assert.equal(first.data.movement.category, null);
  assert.equal(first.data.movement.occurredAt, null);
  assert.equal(first.data.replayed, false);

  const retry = await createMovement(ACTOR, repository, incomeInput(), {
    periods: periodRepository,
  });
  assert.equal(retry.ok, true);
  if (retry.ok) {
    assert.equal(retry.data.replayed, true);
    assert.equal(retry.data.movement.id, first.data.movement.id);
  }

  const conflict = await createMovement(
    ACTOR,
    repository,
    incomeInput({ amountMinor: 21_000 }),
    { periods: periodRepository },
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "conflict");
});

test("opening 500 + income 200 - coffee 11 gives recorded cash 689 and expense spending 11", async () => {
  const { repository, periodRepository, rows } = makeRepository();
  rows.push(
    movement({
      kind: "opening",
      direction: "in",
      amountMinor: 50_000,
      category: null,
      needVsWant: null,
      countsInDaily: false,
      bookingDate: "2026-11-01",
      idempotencyKey: "opening",
    }),
    movement({
      kind: "income",
      direction: "in",
      amountMinor: 20_000,
      category: null,
      needVsWant: null,
      countsInDaily: false,
      bookingDate: "2026-11-09",
      idempotencyKey: "salary",
    }),
    movement({ amountMinor: 1100, purpose: "emergency", bookingDate: "2026-11-11", idempotencyKey: "coffee" }),
    movement({ amountMinor: 300, direction: "in", purpose: "emergency", bookingDate: "2026-11-11", idempotencyKey: "refund" }),
  );

  // Recorded cash is MONEY-03's canonical calculation.
  const period = periodRecord({ activeDate: "2026-11-11" });
  const cash = await getMoneyCashPosition(ACTOR, periodRepository, period, OPENING_500);
  assert.equal(cash.ok, true);
  if (!cash.ok) return;
  assert.equal(cash.data.available, true);
  if (!cash.data.available) return;
  assert.equal(cash.data.recordedCashMinor, 69_200);
  assert.equal(cash.data.openingMinor, 50_000);
  assert.equal(cash.data.inflowsMinor, 20_300);
  assert.equal(cash.data.outflowsMinor, 1100);

  // Movement totals are the disjoint MONEY-04 projection of the same rows.
  const totals = await getMoneyMovementTotals(
    ACTOR,
    repository,
    { cutoff: "2026-11-11", timezone: "Africa/Casablanca" },
    { cutoff: "2026-11-11", startDate: null },
  );
  assert.equal(totals.ok, true);
  if (!totals.ok) return;
  assert.equal(totals.data.totals.expenseTotalMinor, 1400);
  assert.equal(totals.data.totals.emergencyUsedMinor, 800);
  assert.equal(totals.data.totals.dailyIncludedSpendMinor, 1400);
  assert.equal(totals.data.totals.counts.movements, 4);
  assert.equal(totals.data.cutoff, "2026-11-11");
});

test("an excluded expense still lowers cash and raises expense totals while daily included spending stays 0", async () => {
  const { repository, periodRepository, rows } = makeRepository();
  rows.push(
    movement({
      kind: "opening",
      direction: "in",
      amountMinor: 50_000,
      category: null,
      needVsWant: null,
      countsInDaily: false,
      bookingDate: "2026-11-01",
    }),
    movement({ amountMinor: 1100, countsInDaily: false, idempotencyKey: "excluded" }),
  );

  const cash = await getMoneyCashPosition(
    ACTOR,
    periodRepository,
    periodRecord(),
    OPENING_500,
  );
  assert.equal(cash.ok, true);
  if (!cash.ok || !cash.data.available) return;
  assert.equal(cash.data.recordedCashMinor, 48_900);

  const totals = await getMoneyMovementTotals(
    ACTOR,
    repository,
    { cutoff: "2026-11-11" },
    { cutoff: "2026-11-11" },
  );
  assert.equal(totals.ok, true);
  if (!totals.ok) return;
  assert.equal(totals.data.totals.expenseTotalMinor, 1100);
  assert.equal(totals.data.totals.dailyIncludedSpendMinor, 0);
});

test("a real savings transfer reduces cash once and funds savings once; a correction restores invariants", async () => {
  const { repository, periodRepository, rows } = makeRepository();
  rows.push(
    movement({
      kind: "opening",
      direction: "in",
      amountMinor: 50_000,
      category: null,
      needVsWant: null,
      countsInDaily: false,
      bookingDate: "2026-11-01",
    }),
  );

  const created = await createMovement(
    ACTOR,
    repository,
    {
      kind: "savings_transfer",
      amountMinor: 20_000,
      bookingDate: "2026-11-10",
      idempotencyKey: "savings-1",
    },
    { periods: periodRepository },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const before = await getMoneyCashPosition(
    ACTOR,
    periodRepository,
    periodRecord(),
    OPENING_500,
  );
  assert.equal(before.ok, true);
  if (!before.ok || !before.data.available) return;
  assert.equal(before.data.recordedCashMinor, 30_000);

  const beforeTotals = await getMoneyMovementTotals(
    ACTOR,
    repository,
    { cutoff: "2026-11-11" },
    { cutoff: "2026-11-11" },
  );
  assert.equal(beforeTotals.ok, true);
  if (!beforeTotals.ok) return;
  assert.equal(beforeTotals.data.totals.savingsFundedMinor, 20_000);
  assert.equal(beforeTotals.data.totals.expenseTotalMinor, 0);

  // A target edit is not a movement, so nothing changes. A correction to the
  // transfer restores cash and funded savings together.
  const corrected = await updateMovement(
    ACTOR,
    repository,
    created.data.movement.id,
    { version: 1, amountMinor: 15_000 },
    { periods: periodRepository },
  );
  assert.equal(corrected.ok, true);

  const after = await getMoneyCashPosition(
    ACTOR,
    periodRepository,
    periodRecord(),
    OPENING_500,
  );
  assert.equal(after.ok, true);
  if (!after.ok || !after.data.available) return;
  assert.equal(after.data.recordedCashMinor, 35_000);

  const afterTotals = await getMoneyMovementTotals(
    ACTOR,
    repository,
    { cutoff: "2026-11-11" },
    { cutoff: "2026-11-11" },
  );
  assert.equal(afterTotals.ok, true);
  if (!afterTotals.ok) return;
  assert.equal(afterTotals.data.totals.savingsFundedMinor, 15_000);
});

test("a cutoff never includes a later booking date (backdated running balances remain explained)", async () => {
  const { repository, periodRepository, rows } = makeRepository();
  rows.push(
    movement({
      kind: "opening",
      direction: "in",
      amountMinor: 50_000,
      category: null,
      needVsWant: null,
      countsInDaily: false,
      bookingDate: "2026-11-01",
    }),
    movement({
      kind: "income",
      direction: "in",
      amountMinor: 20_000,
      category: null,
      needVsWant: null,
      countsInDaily: false,
      bookingDate: "2026-11-09",
    }),
    movement({ amountMinor: 1100, bookingDate: "2026-11-11" }),
  );

  const atNine = await getMoneyCashPosition(
    ACTOR,
    periodRepository,
    periodRecord({ activeDate: "2026-11-09" }),
    OPENING_500,
  );
  assert.equal(atNine.ok, true);
  if (!atNine.ok || !atNine.data.available) return;
  assert.equal(atNine.data.recordedCashMinor, 70_000);

  const atNineTotals = await getMoneyMovementTotals(
    ACTOR,
    repository,
    { cutoff: "2026-11-09" },
    { cutoff: "2026-11-09" },
  );
  assert.equal(atNineTotals.ok, true);
  if (atNineTotals.ok) assert.equal(atNineTotals.data.totals.expenseTotalMinor, 0);

  const atEleven = await getMoneyCashPosition(
    ACTOR,
    periodRepository,
    periodRecord(),
    OPENING_500,
  );
  assert.equal(atEleven.ok, true);
  if (atEleven.ok && atEleven.data.available) {
    assert.equal(atEleven.data.recordedCashMinor, 68_900);
  }

  const atElevenTotals = await getMoneyMovementTotals(
    ACTOR,
    repository,
    { cutoff: "2026-11-11" },
    { cutoff: "2026-11-11" },
  );
  assert.equal(atElevenTotals.ok, true);
  if (atElevenTotals.ok) {
    assert.equal(atElevenTotals.data.totals.expenseTotalMinor, 1100);
  }
});

test("recorded cash is unavailable (never zero) when the opening is unknown", async () => {
  const { periodRepository } = makeRepository();
  const cash = await getMoneyCashPosition(
    ACTOR,
    periodRepository,
    periodRecord(),
    null,
  );
  assert.equal(cash.ok, true);
  if (!cash.ok) return;
  assert.equal(cash.data.available, false);
  if (!cash.data.available) {
    assert.match(cash.data.reason, /Opening cash is unknown/);
  }
});

test("create rejects a booking date outside the tracking period instead of moving it", async () => {
  const period = periodRecord({ id: "period-1" });
  const { repository, periodRepository } = makeRepository({ periods: [period] });

  const outside = await createMovement(
    ACTOR,
    repository,
    incomeInput({ bookingDate: "2026-12-01" }),
    { periods: periodRepository },
  );
  assert.equal(outside.ok, false);
  if (!outside.ok) {
    assert.equal(outside.code, "validation");
    assert.match(outside.errorMessage, /outside the tracking period/);
  }

  const inside = await createMovement(
    ACTOR,
    repository,
    incomeInput({ bookingDate: "2026-11-20" }),
    { periods: periodRepository },
  );
  assert.equal(inside.ok, true);
  if (inside.ok) assert.equal(inside.data.movement.periodId, "period-1");
});

test("update rejects moving the booking date outside the tracking period", async () => {
  const period = periodRecord({ id: "period-1" });
  const { repository, periodRepository } = makeRepository({ periods: [period] });
  const created = await createMovement(ACTOR, repository, incomeInput(), {
    periods: periodRepository,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const outside = await updateMovement(
    ACTOR,
    repository,
    created.data.movement.id,
    { version: 1, bookingDate: "2026-12-02" },
    { periods: periodRepository },
  );
  assert.equal(outside.ok, false);
  if (!outside.ok) assert.equal(outside.code, "validation");
});

test("listMovements returns the effective cutoff and only that owner's rows", async () => {
  const { repository, rows } = makeRepository();
  rows.push(
    movement({ bookingDate: "2026-11-09", idempotencyKey: "a" }),
    movement({ bookingDate: "2026-11-11", idempotencyKey: "b" }),
    movement({ bookingDate: "2026-11-12", idempotencyKey: "c" }),
    movement({ ownerUserId: OTHER_ACTOR.userId, bookingDate: "2026-11-11", idempotencyKey: "other" }),
  );

  const result = await listMovements(
    ACTOR,
    repository,
    { cutoff: "2026-11-11" },
    { timezone: "Africa/Casablanca", now: new Date("2026-11-11T12:00:00.000Z") },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.cutoff, "2026-11-11");
  assert.deepEqual(
    result.data.movements.map((row) => row.bookingDate),
    ["2026-11-11", "2026-11-09"],
  );
});

test("updateMovement rejects expense-only fields on non-expense kinds", async () => {
  const { repository, periodRepository } = makeRepository();
  const created = await createMovement(ACTOR, repository, incomeInput(), {
    periods: periodRepository,
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const invalid = await updateMovement(
    ACTOR,
    repository,
    created.data.movement.id,
    { version: 1, category: "coffee" },
    { periods: periodRepository },
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "validation");

  const valid = await updateMovement(
    ACTOR,
    repository,
    created.data.movement.id,
    { version: 1, amountMinor: 21_000, countsInDaily: true },
    { periods: periodRepository },
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.data.amountMinor, 21_000);
    assert.equal(valid.data.countsInDaily, true);
    assert.equal(valid.data.version, 2);
  }
});

test("a truncated aggregate is reported as an incomplete reading, not a full total", async () => {
  const totals = await getMoneyMovementTotals(
    ACTOR,
    {
      findByIdempotencyKey: UNUSED,
      create: UNUSED,
      get: UNUSED,
      list: UNUSED,
      update: UNUSED,
      async aggregate() {
        return {
          ok: true,
          value: {
            rows: [
              {
                id: "1",
                kind: "expense",
                direction: "out",
                amountMinor: 1100,
                countsInDaily: true,
                purpose: "emergency",
                bookingDate: "2026-11-11",
              },
            ],
            truncated: true,
          },
        };
      },
    },
    { cutoff: "2026-11-11" },
    { cutoff: "2026-11-11" },
  );
  assert.equal(totals.ok, true);
  if (!totals.ok) return;
  assert.equal(totals.data.totals.truncated, true);
  assert.equal(totals.data.totals.expenseTotalMinor, 1100);
});

void expenseInput;
