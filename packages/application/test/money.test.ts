import assert from "node:assert/strict";
import test from "node:test";

import type { MoneyLedgerRow } from "@ega/domain/money";

import {
  createAuthenticatedActor,
  type MoneyAggregate,
  type MoneyCreateRecordInput,
  type MoneyIdempotencyReceipt,
  type MoneyPeriodRead,
  type MoneyRepository,
  type MoneyUpdateRecordInput,
} from "../src";
import { createMovement, getMoneyState, listMovements, updateMovement } from "../src/money/service";
import { computeMoneyState } from "../src/money/summary";

const ACTOR = createAuthenticatedActor("owner-1");
const OTHER_ACTOR = createAuthenticatedActor("owner-2");

type Stored = MoneyLedgerRow & {
  ownerUserId: string;
  createFingerprint: string;
  idempotencyKey: string;
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

function makeRepository(options: { period?: MoneyPeriodRead } = {}) {
  const rows: Stored[] = [];
  let period: MoneyPeriodRead = options.period ?? { available: false, period: null };
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

  const repository: MoneyRepository = {
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
            bookingDate: row.bookingDate,
          })),
          truncated: false,
        },
      };
    },
    async getPeriod(actor) {
      if (actor.userId !== ACTOR.userId && period.available) {
        return { ok: true, value: { available: true, period: null } };
      }
      return { ok: true, value: period };
    },
  };

  return {
    repository,
    rows,
    setPeriod(value: MoneyPeriodRead) {
      period = value;
    },
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
  const { repository } = makeRepository();
  const first = await createMovement(ACTOR, repository, incomeInput());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.data.movement.kind, "income");
  assert.equal(first.data.movement.direction, "in");
  assert.equal(first.data.movement.countsInDaily, false);
  assert.equal(first.data.movement.category, null);
  assert.equal(first.data.movement.occurredAt, null);
  assert.equal(first.data.replayed, false);

  const retry = await createMovement(ACTOR, repository, incomeInput());
  assert.equal(retry.ok, true);
  if (retry.ok) {
    assert.equal(retry.data.replayed, true);
    assert.equal(retry.data.movement.id, first.data.movement.id);
  }

  const conflict = await createMovement(ACTOR, repository, incomeInput({ amountMinor: 21_000 }));
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "conflict");
});

test("opening 500 + income 200 - coffee 11 gives recorded cash 689 and expense spending 11", async () => {
  const { repository, rows } = makeRepository();
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
    movement({ amountMinor: 1100, bookingDate: "2026-11-11", idempotencyKey: "coffee" }),
  );

  const result = await getMoneyState(
    ACTOR,
    repository,
    { cutoff: "2026-11-11", timezone: "Africa/Casablanca" },
    { now: new Date("2026-11-11T12:00:00.000Z") },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.state.recordedCashMinor, 68_900);
  assert.equal(result.data.state.expenseTotalMinor, 1100);
  assert.equal(result.data.state.dailyIncludedSpendMinor, 1100);
  assert.equal(result.data.state.openingMinor, 50_000);
  assert.equal(result.data.state.inflowsMinor, 20_000);
  assert.equal(result.data.state.outflowsMinor, 1100);
  // No period is available in this base, so cash is reported as recorded but
  // not falsely confirmed.
  assert.equal(result.data.state.completeness.confirmed, false);
  assert.ok(result.data.state.completeness.reasons.includes("period_table_unavailable"));
});

test("an excluded expense still lowers cash and raises expense totals while daily included spending stays 0", async () => {
  const { repository, rows } = makeRepository();
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

  const result = await getMoneyState(
    ACTOR,
    repository,
    { cutoff: "2026-11-11" },
    { now: new Date("2026-11-11T12:00:00.000Z") },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.state.recordedCashMinor, 48_900);
  assert.equal(result.data.state.expenseTotalMinor, 1100);
  assert.equal(result.data.state.dailyIncludedSpendMinor, 0);
});

test("a real savings transfer reduces cash once and funds savings once; a corrections restores invariants", async () => {
  const { repository, rows } = makeRepository();
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

  const created = await createMovement(ACTOR, repository, {
    kind: "savings_transfer",
    amountMinor: 20_000,
    bookingDate: "2026-11-10",
    idempotencyKey: "savings-1",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const before = await getMoneyState(ACTOR, repository, { cutoff: "2026-11-11" });
  assert.equal(before.ok, true);
  if (!before.ok) return;
  assert.equal(before.data.state.recordedCashMinor, 30_000);
  assert.equal(before.data.state.savingsFundedMinor, 20_000);
  assert.equal(before.data.state.expenseTotalMinor, 0);

  // A target edit is not a movement, so nothing changes. A correction to the
  // transfer restores cash and funded savings together.
  const corrected = await repository.update(ACTOR, created.data.movement.id, {
    changes: { amountMinor: 15_000 },
    expectedVersion: 1,
    updatedAt: "2026-11-11T12:00:00.000Z",
  });
  assert.equal(corrected.ok, true);

  const after = await getMoneyState(ACTOR, repository, { cutoff: "2026-11-11" });
  assert.equal(after.ok, true);
  if (!after.ok) return;
  assert.equal(after.data.state.recordedCashMinor, 35_000);
  assert.equal(after.data.state.savingsFundedMinor, 15_000);
});

test("a cutoff never includes a later booking date (backdated running balances remain explained)", async () => {
  const { repository, rows } = makeRepository();
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

  const atNine = await getMoneyState(ACTOR, repository, { cutoff: "2026-11-09" });
  assert.equal(atNine.ok, true);
  if (!atNine.ok) return;
  assert.equal(atNine.data.state.recordedCashMinor, 70_000);
  assert.equal(atNine.data.state.expenseTotalMinor, 0);

  const atEleven = await getMoneyState(ACTOR, repository, { cutoff: "2026-11-11" });
  assert.equal(atEleven.ok, true);
  if (atEleven.ok) {
    assert.equal(atEleven.data.state.recordedCashMinor, 68_900);
    assert.equal(atEleven.data.state.expenseTotalMinor, 1100);
  }
});

test("a confirmed balance needs period context and a known opening", async () => {
  const rows = [
    {
      id: "1",
      kind: "opening" as const,
      direction: "in" as const,
      amountMinor: 50_000,
      countsInDaily: false,
      bookingDate: "2026-11-01",
    },
  ];
  const basePeriod = {
    id: "period-1",
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    currency: "MAD" as const,
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-11",
    lifecycle: "tracking" as const,
    initialization: "initialized" as const,
    openingMovementId: "1",
    provenance: { source: "manual" },
    version: 1,
  };

  const confirmed = computeMoneyState(
    { rows, truncated: false },
    {
      cutoff: "2026-11-11",
      timezone: "Africa/Casablanca",
      period: { available: true, period: basePeriod },
    },
  );
  assert.equal(confirmed.completeness.confirmed, true);
  assert.deepEqual(confirmed.completeness.reasons, []);
  assert.equal(confirmed.period.provenance?.source, "manual");

  const noOpening = computeMoneyState(
    { rows: [], truncated: false },
    {
      cutoff: "2026-11-11",
      timezone: "Africa/Casablanca",
      period: { available: true, period: basePeriod },
    },
  );
  assert.equal(noOpening.completeness.confirmed, false);
  assert.ok(noOpening.completeness.reasons.includes("unknown_opening"));

  const unavailable = computeMoneyState(
    { rows, truncated: false },
    {
      cutoff: "2026-11-11",
      timezone: null,
      period: { available: false, period: null },
    },
  );
  assert.equal(unavailable.completeness.confirmed, false);
  assert.ok(unavailable.completeness.reasons.includes("period_table_unavailable"));

  const truncated = computeMoneyState(
    { rows, truncated: true },
    {
      cutoff: "2026-11-11",
      timezone: "Africa/Casablanca",
      period: { available: true, period: basePeriod },
    },
  );
  assert.equal(truncated.completeness.confirmed, false);
  assert.ok(truncated.completeness.reasons.includes("history_truncated"));
});

test("create rejects a booking date outside the tracking period instead of moving it", async () => {
  const { repository } = makeRepository({
    period: {
      available: true,
      period: {
        id: "period-1",
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        currency: "MAD",
        timezone: "Africa/Casablanca",
        activeDate: "2026-11-11",
        lifecycle: "tracking",
        initialization: "initialized",
        openingMovementId: null,
        provenance: null,
        version: 1,
      },
    },
  });

  const outside = await createMovement(ACTOR, repository, incomeInput({ bookingDate: "2026-12-01" }));
  assert.equal(outside.ok, false);
  if (!outside.ok) {
    assert.equal(outside.code, "validation");
    assert.match(outside.errorMessage, /outside the tracking period/);
  }

  const inside = await createMovement(ACTOR, repository, incomeInput({ bookingDate: "2026-11-20" }));
  assert.equal(inside.ok, true);
  if (inside.ok) assert.equal(inside.data.movement.periodId, "period-1");
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
  const { repository } = makeRepository();
  const created = await createMovement(ACTOR, repository, incomeInput());
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const invalid = await updateMovement(
    ACTOR,
    repository,
    created.data.movement.id,
    { version: 1, category: "coffee" },
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "validation");

  const valid = await updateMovement(
    ACTOR,
    repository,
    created.data.movement.id,
    { version: 1, amountMinor: 21_000, countsInDaily: true },
  );
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.data.amountMinor, 21_000);
    assert.equal(valid.data.countsInDaily, true);
    assert.equal(valid.data.version, 2);
  }
});

test("getMoneyState defensively reports a missing period table", async () => {
  const { repository, rows } = makeRepository();
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
  const result = await getMoneyState(ACTOR, repository, {}, { timezone: "UTC" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.state.period.available, false);
  assert.equal(result.data.state.completeness.confirmed, false);
  assert.equal(result.data.state.recordedCashMinor, 50_000);
});

void OTHER_ACTOR;
