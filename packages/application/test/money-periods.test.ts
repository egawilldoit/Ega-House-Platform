import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthenticatedActor,
  createExpense,
  createMoneyPeriod,
  getCurrentMoneyReserves,
  getMoneyState,
  updateExpense,
  rebaseMoneyDayStartBaseline,
  routineEntryGuardFailure,
  updateMoneySettings,
  type ExpenseRepository,
  type MoneyBudgetRepository,
  type MoneyDayStartBaseline,
  type MoneyPeriodRepository,
  type MoneyReserveInputs,
} from "../src/index";
import type { MoneyDayClose, MoneyOpening, MoneyPeriod } from "@ega/domain/money";
import type { PersonalExpense } from "@ega/domain/expenses";

const ACTOR = createAuthenticatedActor("owner-money");
const OTHER = createAuthenticatedActor("owner-other");
const NOW = new Date("2026-11-11T12:00:00.000Z");

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

test("rebases a day-start baseline through the explicit use case", async () => {
  let calls = 0;
  const result = await rebaseMoneyDayStartBaseline(ACTOR, {
    async rebaseDayStartBaseline() {
      calls += 1;
      return { ok: true, value: { date: "2026-11-12", version: 2, availability: "unavailable", unavailableReason: "first_day", cashMinor: null, commitmentsMinor: null, savingsTargetMinor: null, savingsFundedMinor: null, emergencyTargetMinor: null, emergencyUsedMinor: null } };
    },
  }, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

type LedgerRow = {
  id: string;
  ownerUserId: string;
  kind: "expense" | "opening";
  direction: "in" | "out";
  amountMinor: number;
  bookingDate: string;
  periodId: string | null;
  deletedAt: string | null;
};

function makeRepository() {
  const periods = new Map<string, { period: MoneyPeriod; ownerUserId: string }>();
  const openings = new Map<string, { opening: MoneyOpening; ownerUserId: string }>();
  const ledger: LedgerRow[] = [];
  const ensured: Array<{ ownerUserId: string; periodId: string; date: string }> = [];
  let dailyTotal = { amountMinor: 0, complete: true };
  let reserveInputs: MoneyReserveInputs = {
    available: false,
    reason: "reserve_inputs_incomplete",
  };
  const reserveInputsByCutoff = new Map<string, MoneyReserveInputs>();
  const reserveReads: string[] = [];
  const baselines = new Map<string, MoneyDayStartBaseline>();
  const baselineReads: string[] = [];
  let rebaseCalls = 0;
  let sequence = 0;

  function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  }

  function ownerPeriods(actor: { userId: string }) {
    return [...periods.values()]
      .filter((entry) => entry.ownerUserId === actor.userId)
      .map((entry) => entry.period);
  }

  const repository: MoneyPeriodRepository = {
    async ensureDayStartBaseline(actor, periodId, date) {
      ensured.push({ ownerUserId: actor.userId, periodId, date });
      return { ok: true as const, value: { date, version: 1, availability: "available" as const, unavailableReason: null, cashMinor: 50000, commitmentsMinor: 0, savingsTargetMinor: 0, savingsFundedMinor: 0, emergencyTargetMinor: 0, emergencyUsedMinor: 0 } };
    },
    async getDayStartBaseline(_actor, _periodId, date) {
      baselineReads.push(date);
      return { ok: true as const, value: baselines.get(date) ?? null };
    },
    async getDailyIncludedExpenseTotal(actor, periodId, date) {
      const amount = ledger.filter((row) => row.ownerUserId === actor.userId && row.periodId === periodId && row.bookingDate === date && !row.deletedAt).reduce((sum, row) => sum + row.amountMinor, 0);
      return { ok: true as const, value: { ...dailyTotal, amountMinor: amount || dailyTotal.amountMinor } };
    },
    async rebaseDayStartBaseline(actor, periodId) {
      rebaseCalls += 1;
      const entry = periods.get(periodId);
      if (
        entry &&
        entry.ownerUserId === actor.userId &&
        !entry.period.dayStartSetupCompleted
      ) {
        periods.set(periodId, {
          ownerUserId: entry.ownerUserId,
          period: {
            ...entry.period,
            dayStartSetupCompleted: true,
            version: entry.period.version + 1,
          },
        });
      }
      return {
        ok: true as const,
        value: {
          date: entry?.period.activeDate ?? "2026-11-11",
          version: 1,
          availability: "available" as const,
          unavailableReason: null,
          cashMinor: 0,
          commitmentsMinor: 0,
          savingsTargetMinor: 0,
          savingsFundedMinor: 0,
          emergencyTargetMinor: 0,
          emergencyUsedMinor: 0,
        },
      };
    },
    async getDayCloseForDate() {
      return { ok: true as const, value: null };
    },
    async getReserveInputs(_actor, _periodId, cutoff) {
      reserveReads.push(cutoff);
      return {
        ok: true as const,
        value: reserveInputsByCutoff.get(cutoff) ?? reserveInputs,
      };
    },
    async findTracking(actor) {
      return {
        ok: true as const,
        value:
          ownerPeriods(actor).find((period) => period.lifecycle === "tracking") ??
          null,
      };
    },
    async findById(actor, id) {
      const entry = periods.get(id);
      return {
        ok: true as const,
        value: entry?.ownerUserId === actor.userId ? entry.period : null,
      };
    },
    async findByExactRange(actor, range) {
      return {
        ok: true as const,
        value: ownerPeriods(actor).filter(
          (period) =>
            period.startDate === range.startDate &&
            period.endDate === range.endDate,
        ),
      };
    },
    async findOverlapping(actor, range) {
      return {
        ok: true as const,
        value: ownerPeriods(actor).filter(
          (period) =>
            period.startDate <= range.endDate && range.startDate <= period.endDate,
        ),
      };
    },
    async list(actor, limit) {
      return {
        ok: true as const,
        value: ownerPeriods(actor)
          .sort((left, right) => right.endDate.localeCompare(left.endDate))
          .slice(0, limit),
      };
    },
    async create(actor, input) {
      if (ownerPeriods(actor).some((period) => period.lifecycle === "tracking")) {
        return { ok: false as const, error: { code: "conflict" as const } };
      }
      if (
        ownerPeriods(actor).some(
          (period) =>
            period.startDate <= input.values.endDate &&
            input.values.startDate <= period.endDate,
        )
      ) {
        return { ok: false as const, error: { code: "conflict" as const } };
      }
      const id = nextId("aaaaaaaa");
      const values = input.values;
      let opening: MoneyOpening | null = null;
      if (values.opening) {
        opening = {
          id: nextId("bbbbbbbb"),
          amountMinor: values.opening.amountMinor,
          currency: "MAD",
          bookingDate: values.startDate,
          version: 1,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        };
        openings.set(opening.id, { opening, ownerUserId: actor.userId });
        ledger.push({
          id: opening.id,
          ownerUserId: actor.userId,
          kind: "opening",
          direction: "in",
          amountMinor: opening.amountMinor,
          bookingDate: opening.bookingDate,
          periodId: id,
          deletedAt: null,
        });
      }
      const period: MoneyPeriod = {
        id,
        startDate: values.startDate,
        endDate: values.endDate,
        currency: "MAD",
        timezone: values.timezone,
        activeDate: values.activeDate,
        lifecycle: "tracking",
        initialization: opening
          ? values.opening!.source === "verified_source"
            ? "reconciled"
            : "initialized"
          : "uninitialized",
        openingMovementId: opening?.id ?? null,
        dayStartSetupCompleted: false,
        provenance: input.provenance,
        settings: values.settings,
        version: opening ? 2 : 1,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      periods.set(id, { period, ownerUserId: actor.userId });
      return { ok: true as const, value: period };
    },
    async update(actor, id, input) {
      const entry = periods.get(id);
      if (!entry || entry.ownerUserId !== actor.userId) {
        return { ok: false as const, error: { code: "notFound" as const } };
      }
      if (entry.period.version !== input.expectedVersion) {
        return { ok: false as const, error: { code: "conflict" as const } };
      }
      let period = entry.period;
      let openingMovementId = period.openingMovementId;
      if (input.opening) {
        let opening = openingMovementId ? openings.get(openingMovementId)?.opening ?? null : null;
        if (opening) {
          opening = {
            ...opening,
            amountMinor: input.opening.values.amountMinor,
            version: opening.version + 1,
            updatedAt: input.updatedAt,
          };
          openings.set(opening.id, { opening, ownerUserId: actor.userId });
          const ledgerRow = ledger.find((row) => row.id === opening!.id);
          if (ledgerRow) ledgerRow.amountMinor = opening.amountMinor;
        } else {
          opening = {
            id: nextId("cccccccc"),
            amountMinor: input.opening.values.amountMinor,
            currency: "MAD",
            bookingDate: period.startDate,
            version: 1,
            createdAt: input.updatedAt,
            updatedAt: input.updatedAt,
          };
          openings.set(opening.id, { opening, ownerUserId: actor.userId });
          ledger.push({
            id: opening.id,
            ownerUserId: actor.userId,
            kind: "opening",
            direction: "in",
            amountMinor: opening.amountMinor,
            bookingDate: opening.bookingDate,
            periodId: period.id,
            deletedAt: null,
          });
          openingMovementId = opening.id;
        }
        period = {
          ...period,
          initialization: input.opening.initialization,
          provenance: input.opening.provenance,
          openingMovementId,
        };
      }
      const next: MoneyPeriod = {
        ...period,
        activeDate: input.activeDate ?? period.activeDate,
        settings: input.settings ?? period.settings,
        version: period.version + 1,
        updatedAt: input.updatedAt,
      };
      periods.set(id, { period: next, ownerUserId: actor.userId });
      return { ok: true as const, value: next };
    },
    async getOpening(actor, id) {
      const entry = openings.get(id);
      return {
        ok: true as const,
        value: entry?.ownerUserId === actor.userId ? entry.opening : null,
      };
    },
    async sumLedgerByDirection(actor, window) {
      const rows = ledger.filter(
        (row) =>
          row.ownerUserId === actor.userId &&
          row.kind !== "opening" &&
          row.deletedAt === null &&
          row.bookingDate >= window.startDate &&
          row.bookingDate <= window.endDateInclusive,
      );
      return {
        ok: true as const,
        value: {
          inflowsMinor: rows
            .filter((row) => row.direction === "in")
            .reduce((sum, row) => sum + row.amountMinor, 0),
          outflowsMinor: rows
            .filter((row) => row.direction === "out")
            .reduce((sum, row) => sum + row.amountMinor, 0),
          recordCount: rows.length,
          truncated: false,
        },
      };
    },
    async ledgerOverview(actor, range) {
      const rows = ledger.filter(
        (row) => row.ownerUserId === actor.userId && row.kind === "expense",
      );
      return {
        ok: true as const,
        value: {
          totalExpenseCount: rows.length,
          assignedToPeriodCount:
            range.periodId === null
              ? 0
              : rows.filter((row) => row.periodId === range.periodId).length,
          inPeriodUnassignedCount:
            range.periodId === null
              ? 0
              : rows.filter(
                  (row) =>
                    row.periodId === null &&
                    row.bookingDate >= range.startDate &&
                    row.bookingDate <= range.endDate,
                ).length,
        },
      };
    },
  };

  function addExpense(
    ownerUserId: string,
    amountMinor: number,
    bookingDate: string,
    periodId: string | null = null,
  ) {
    ledger.push({
      id: nextId("dddddddd"),
      ownerUserId,
      kind: "expense",
      direction: "out",
      amountMinor,
      bookingDate,
      periodId,
      deletedAt: null,
    });
  }

  return {
    repository,
    addExpense,
    periods,
    ledger,
    ensured,
    baselineReads,
    reserveReads,
    setDailyTotal(value: { amountMinor: number; complete: boolean }) { dailyTotal = value; },
    setReserveInputs(value: MoneyReserveInputs, cutoff?: string) {
      if (cutoff) reserveInputsByCutoff.set(cutoff, value);
      else reserveInputs = value;
    },
    setBaseline(date: string, value: MoneyDayStartBaseline | null) {
      if (value) baselines.set(date, value);
      else baselines.delete(date);
    },
    rebaseCalls: () => rebaseCalls,
  };
}

const CREATE_BODY = {
  startDate: "2026-11-09",
  endDate: "2026-11-30",
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-11",
  opening: {
    amountMinor: 50_000,
    source: "user_entered" as const,
    cutoffDate: "2026-11-08",
    evidence: null,
    note: "cash counted",
  },
};

test("money reads never invoke the routine-entry resolution", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(ACTOR, money.repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const state = await getMoneyState(
    ACTOR,
    {
      ...money.repository,
      async findOverlapping() {
        throw new Error("a read must never resolve a routine write");
      },
    },
    {},
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (state.ok) assert.equal(state.data.period?.id, created.data.period.id);
});

test("an empty account has no invented period or opening, and cash is unknown", async () => {
  const { repository } = makeRepository();
  const state = await getMoneyState(ACTOR, repository, {}, { now: NOW, timezone: "Africa/Casablanca" });
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.data.period, null);
  assert.equal(state.data.opening.status, "unknown");
  assert.equal(state.data.cash.available, false);
  assert.equal(state.data.localToday, "2026-11-11");
  assert.equal(state.data.dateResolution.basis, "local_today_no_period");
});

test("selected-day read does not materialize missing baseline and reports it unavailable", async () => {
  const { repository, ensured } = makeRepository();
  await createMoneyPeriod(ACTOR, repository, CREATE_BODY, { now: NOW });
  const state = await getMoneyState(ACTOR, repository, {}, { now: NOW, timezone: "Africa/Casablanca" });
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.data.dayStartBaseline, null);
  assert.equal(state.data.dayStartBaselineUnavailable, true);
  assert.deepEqual(ensured, []);
});

test("historical explicit reads do not materialize missing day-start history", async () => {
  const { repository, ensured } = makeRepository();
  await createMoneyPeriod(ACTOR, repository, CREATE_BODY, { now: NOW });
  const state = await getMoneyState(ACTOR, repository, { date: "2026-11-10" }, { now: NOW, timezone: "Africa/Casablanca" });
  assert.equal(state.ok, true);
  assert.deepEqual(ensured, []);
});

test("a partial period creates one known opening and reports cash through the active date", async () => {
  const { repository, addExpense } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.data.period.startDate, "2026-11-09");
  assert.equal(created.data.period.endDate, "2026-11-30");
  assert.equal(created.data.period.activeDate, "2026-11-11");
  assert.equal(created.data.period.initialization, "initialized");
  assert.equal(created.data.period.openingMovementId !== null, true);

  addExpense(ACTOR.userId, 1100, "2026-11-11", created.data.period.id);
  addExpense(ACTOR.userId, 2500, "2026-11-12", created.data.period.id);
  addExpense(ACTOR.userId, 9999, "2026-11-20", null); // after the active date
  addExpense(OTHER.userId, 7777, "2026-11-11", null); // another owner

  const state = await getMoneyState(
    ACTOR,
    repository,
    {},
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.data.opening.status, "known");
  if (state.data.opening.status === "known") {
    assert.equal(state.data.opening.amountMinor, 50_000);
  }
  assert.equal(state.data.cash.available, true);
  if (state.data.cash.available) {
    assert.equal(state.data.cash.openingMinor, 50_000);
    assert.equal(state.data.cash.outflowsMinor, 1100);
    assert.equal(state.data.cash.recordedCashMinor, 48_900);
    assert.equal(state.data.cash.cutoffDate, "2026-11-11");
  }
});

test("known zero is a real opening; unknown stays uninitialized without a ledger row", async () => {
  const zeroRepo = makeRepository();
  const zero = await createMoneyPeriod(
    ACTOR,
    zeroRepo.repository,
    { ...CREATE_BODY, opening: { amountMinor: 0, source: "user_entered" } },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(zero.ok, true);
  if (zero.ok) {
    assert.equal(zero.data.period.initialization, "initialized");
    assert.notEqual(zero.data.period.openingMovementId, null);
  }

  const unknownRepo = makeRepository();
  const unknown = await createMoneyPeriod(
    ACTOR,
    unknownRepo.repository,
    { ...CREATE_BODY, opening: undefined },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(unknown.ok, true);
  if (unknown.ok) {
    assert.equal(unknown.data.period.initialization, "uninitialized");
    assert.equal(unknown.data.period.openingMovementId, null);
  }
  const state = await getMoneyState(
    ACTOR,
    unknownRepo.repository,
    {},
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (state.ok) {
    assert.equal(state.data.opening.status, "unknown");
    assert.equal(state.data.cash.available, false);
  }
});

test("verified evidence upgrades to reconciled; a downgrade is refused", async () => {
  const { repository } = makeRepository();
  const verified = await createMoneyPeriod(
    ACTOR,
    repository,
    {
      ...CREATE_BODY,
      opening: {
        amountMinor: 50_000,
        source: "verified_source",
        cutoffDate: "2026-11-08",
        evidence: "bank statement 2026-11-08",
        note: null,
      },
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.data.period.initialization, "reconciled");

  const downgrade = await updateMoneySettings(
    ACTOR,
    repository,
    verified.data.period.id,
    {
      version: verified.data.period.version,
      opening: { amountMinor: 51_000, source: "user_entered", cutoffDate: null, evidence: null, note: null },
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(downgrade.ok, false);
  if (!downgrade.ok) assert.equal(downgrade.code, "validation");
});

test("changing the active date keeps boundaries and transactions and increments once", async () => {
  const { repository, addExpense, ledger } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  addExpense(ACTOR.userId, 1100, "2026-11-11", created.data.period.id);

  const updated = await updateMoneySettings(
    ACTOR,
    repository,
    created.data.period.id,
    { version: created.data.period.version, activeDate: "2026-11-10" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.data.startDate, "2026-11-09");
  assert.equal(updated.data.endDate, "2026-11-30");
  assert.equal(updated.data.activeDate, "2026-11-10");
  assert.equal(updated.data.version, created.data.period.version + 1);
  assert.equal(ledger.filter((row) => row.kind === "expense").length, 1);
  assert.equal(ledger.find((row) => row.kind === "expense")?.amountMinor, 1100);
});

test("a retained close bounds a rewind without making the active date close-driven", async () => {
  const { repository } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const withClose = {
    ...repository,
    async listDayCloses() {
      return {
        ok: true as const,
        value: [
          {
            id: "close-1",
            closeDate: "2026-11-10",
          } as MoneyDayClose,
        ],
      };
    },
  };

  // Skipping unclosed days is a normal calendar move after a close.
  const skipped = await updateMoneySettings(
    ACTOR,
    withClose,
    created.data.period.id,
    { version: created.data.period.version, activeDate: "2026-11-12" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(skipped.ok, true);
  if (skipped.ok) assert.equal(skipped.data.activeDate, "2026-11-12");

  // Moving to the closed date itself would reopen attested history.
  const closedDate = await updateMoneySettings(
    ACTOR,
    withClose,
    created.data.period.id,
    { version: skipped.ok ? skipped.data.version : created.data.period.version, activeDate: "2026-11-10" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(closedDate.ok, false);
  if (!closedDate.ok) {
    assert.equal(closedDate.code, "validation");
    assert.match(closedDate.errorMessage, /retained close/);
  }

  // An earlier unclosed day after the retained close is still reachable.
  const earlier = await updateMoneySettings(
    ACTOR,
    withClose,
    created.data.period.id,
    { version: skipped.ok ? skipped.data.version : created.data.period.version, activeDate: "2026-11-11" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(earlier.ok, true);

  const unchanged = await updateMoneySettings(
    ACTOR,
    withClose,
    created.data.period.id,
    {
      version: earlier.ok ? earlier.data.version : created.data.period.version,
      activeDate: "2026-11-11",
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(unchanged.ok, true);
});

test("a stale version conflicts without changing the stored period", async () => {
  const { repository } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const first = await updateMoneySettings(
    ACTOR,
    repository,
    created.data.period.id,
    { version: created.data.period.version, activeDate: "2026-11-10" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(first.ok, true);
  const stale = await updateMoneySettings(
    ACTOR,
    repository,
    created.data.period.id,
    { version: created.data.period.version, activeDate: "2026-11-09" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, "conflict");
  const stored = await repository.findById(ACTOR, created.data.period.id);
  assert.equal(stored.ok, true);
  if (stored.ok) {
    assert.equal(stored.value?.activeDate, "2026-11-10");
    assert.equal(stored.value?.version, created.data.period.version + 1);
  }
});

test("out-of-period active dates and routine entries are actionable", async () => {
  const { repository } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const outOfRange = await updateMoneySettings(
    ACTOR,
    repository,
    created.data.period.id,
    { version: created.data.period.version, activeDate: "2026-12-01" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) {
    assert.equal(outOfRange.code, "validation");
    assert.match(outOfRange.errorMessage, /between 2026-11-09 and 2026-11-30/);
  }

  const message = routineEntryGuardFailure(created.data.period, "2026-12-01");
  assert.match(String(message), /outside the tracking period/);
  assert.equal(routineEntryGuardFailure(created.data.period, "2026-11-11"), null);
});

test("overlapping tracking periods are rejected and exact retries replay", async () => {
  const { repository } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
    surface: "mcp",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const replay = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
    surface: "mcp",
  });
  assert.equal(replay.ok, true);
  if (replay.ok) {
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.period.id, created.data.period.id);
  }

  const conflict = await createMoneyPeriod(
    ACTOR,
    repository,
    {
      ...CREATE_BODY,
      startDate: "2026-11-15",
      endDate: "2026-12-15",
      activeDate: "2026-11-15",
      opening: undefined,
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "conflict");
});

test("local today and active date resolve separately when they differ", async () => {
  const { repository } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: new Date("2026-11-11T12:00:00.000Z"),
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const lagging = await updateMoneySettings(
    ACTOR,
    repository,
    created.data.period.id,
    { version: created.data.period.version, activeDate: "2026-11-09" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(lagging.ok, true);

  const later = new Date("2026-11-13T12:00:00.000Z");
  const state = await getMoneyState(
    ACTOR,
    repository,
    {},
    { now: later, timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.data.localToday, "2026-11-13");
  assert.equal(state.data.period?.activeDate, "2026-11-09");
  assert.equal(state.data.dateResolution.datesDiffer, true);
  assert.equal(state.data.dateResolution.basis, "active_day");
  assert.equal(state.data.dateResolution.resolvedDate, "2026-11-09");
  assert.equal(state.data.dateResolution.projectionCutoffDate, "2026-11-13");
  assert.equal(state.data.dateResolution.projectionBasis, "local_today");
  assert.equal(state.data.cash.cutoffDate, "2026-11-13");

  const todayMode = await getMoneyState(
    ACTOR,
    repository,
    { mode: "today" },
    { now: later, timezone: "Africa/Casablanca" },
  );
  assert.equal(todayMode.ok, true);
  if (todayMode.ok) {
    assert.equal(todayMode.data.dateResolution.resolvedDate, "2026-11-13");
    assert.equal(todayMode.data.dateResolution.basis, "local_today");
    assert.equal(todayMode.data.dateResolution.projectionCutoffDate, "2026-11-13");
    assert.equal(todayMode.data.dateResolution.projectionBasis, "local_today");
  }

  const activeDay = await getMoneyState(
    ACTOR,
    repository,
    { mode: "active_day" },
    { now: later, timezone: "Africa/Casablanca" },
  );
  assert.equal(activeDay.ok, true);
  if (activeDay.ok) {
    assert.equal(activeDay.data.dateResolution.resolvedDate, "2026-11-09");
    assert.equal(activeDay.data.dateResolution.projectionCutoffDate, "2026-11-09");
    assert.equal(activeDay.data.dateResolution.projectionBasis, "active_day");
    assert.equal(activeDay.data.cash.cutoffDate, "2026-11-09");
  }

  const explicit = await getMoneyState(
    ACTOR,
    repository,
    { date: "2026-11-12" },
    { now: later, timezone: "Africa/Casablanca" },
  );
  assert.equal(explicit.ok, true);
  if (explicit.ok) {
    assert.equal(explicit.data.dateResolution.resolvedDate, "2026-11-12");
    assert.equal(explicit.data.dateResolution.basis, "explicit_date");
    assert.equal(explicit.data.dateResolution.periodRelation, "in_period");
    assert.equal(explicit.data.dateResolution.projectionCutoffDate, "2026-11-12");
    assert.equal(explicit.data.dateResolution.projectionBasis, "explicit_date");
    assert.equal(explicit.data.cash.cutoffDate, "2026-11-12");
  }

  const outside = await getMoneyState(
    ACTOR,
    repository,
    { date: "2026-12-02" },
    { now: later, timezone: "Africa/Casablanca" },
  );
  assert.equal(outside.ok, true);
  if (outside.ok) {
    assert.equal(outside.data.dateResolution.projectionCutoffDate, "2026-12-02");
    assert.equal(outside.data.dateResolution.periodRelation, "after_period");
    assert.equal(outside.data.cash.available, false);
    if (!outside.data.cash.available) {
      assert.equal(outside.data.cash.reason, "cutoff_outside_period");
      assert.equal(outside.data.cash.cutoffDate, "2026-12-02");
    }
  }
});

test("owner time context and period timezone stay separately named when they diverge", async () => {
  const { repository } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: new Date("2026-11-11T12:00:00.000Z"),
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  // 03:00Z is still November 23 in Los Angeles but already November 24 in
  // Casablanca. The read exposes both authorities instead of silently using
  // one for the other; booking/write dates stay period-authoritative.
  const state = await getMoneyState(
    ACTOR,
    repository,
    {},
    {
      now: new Date("2026-11-24T03:00:00.000Z"),
      timezone: "America/Los_Angeles",
    },
  );
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.data.timezone, "America/Los_Angeles");
  assert.equal(state.data.dateResolution.timezone, "America/Los_Angeles");
  assert.equal(state.data.dateResolution.periodTimezone, "Africa/Casablanca");
  assert.equal(state.data.localToday, "2026-11-23");
  assert.equal(state.data.dateResolution.projectionCutoffDate, "2026-11-23");
  assert.equal(state.data.dateResolution.projectionBasis, "local_today");
  assert.equal(state.data.period?.timezone, "Africa/Casablanca");
});

test("stale active cursor keeps the current projection at owner-local today", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(
    ACTOR,
    money.repository,
    {
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      timezone: "Africa/Casablanca",
      activeDate: "2026-11-21",
      opening: {
        amountMinor: 100_000,
        source: "user_entered",
        cutoffDate: "2026-11-01",
        evidence: null,
        note: null,
      },
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const periodId = created.data.period.id;
  // The owner explicitly completes the initial obligation setup; derived
  // guidance is unavailable before this point.
  const completed = await rebaseMoneyDayStartBaseline(
    ACTOR,
    money.repository,
    periodId,
  );
  assert.equal(completed.ok, true);
  const tracking = await money.repository.findTracking(ACTOR);
  assert.equal(tracking.ok, true);
  if (!tracking.ok || !tracking.value) return;
  const rebaseCallsAfterSetup = money.rebaseCalls();
  money.addExpense(ACTOR.userId, 5_000, "2026-11-23", periodId);
  // The canonical exclusive start-of-day read (Nov 22) is what derives the
  // day-start inputs; the current read (Nov 23) carries the expense.
  money.setReserveInputs({
    available: true,
    recordedCashMinor: 100_000,
    unpaidCommitmentsMinor: 0,
    savingsFundedMinor: 0,
    emergencyUsedMinor: 0,
  }, "2026-11-22");
  money.setReserveInputs({
    available: true,
    recordedCashMinor: 95_000,
    unpaidCommitmentsMinor: 0,
    savingsFundedMinor: 0,
    emergencyUsedMinor: 0,
  });
  const budgets = {
    async getPlan() {
      return {
        ok: true as const,
        value: { savingsTargetMinor: 10_000, emergencyTargetMinor: 5_000 },
      };
    },
  } as unknown as MoneyBudgetRepository;
  const later = new Date("2026-11-23T12:00:00.000Z");

  const state = await getMoneyState(
    ACTOR,
    money.repository,
    {},
    { now: later, timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.data.localToday, "2026-11-23");
  assert.equal(state.data.period?.activeDate, "2026-11-21");
  assert.equal(state.data.dateResolution.resolvedDate, "2026-11-21");
  assert.equal(state.data.dateResolution.projectionCutoffDate, "2026-11-23");
  assert.equal(state.data.dateResolution.projectionBasis, "local_today");
  assert.equal(state.data.cash.available, true);
  if (state.data.cash.available) {
    assert.equal(state.data.cash.cutoffDate, "2026-11-23");
    assert.equal(state.data.cash.recordedCashMinor, 95_000);
  }
  // A missing baseline is not a write and not a zero.
  assert.equal(state.data.dayStartBaseline, null);
  assert.equal(state.data.dayStartBaselineUnavailable, true);
  assert.equal(state.data.closedDayCount, 0);
  assert.deepEqual(state.data.recentCloses, []);

  const reserves = await getCurrentMoneyReserves(ACTOR, {
    period: tracking.value,
    periods: money.repository,
    budgets,
    cutoffDate: state.data.dateResolution.projectionCutoffDate,
    localToday: state.data.localToday,
  });
  assert.equal(reserves.ok, true);
  if (!reserves.ok) return;
  assert.equal(reserves.data.available, true);
  if (!reserves.data.available) return;
  assert.equal(reserves.data.cutoffDate, "2026-11-23");
  assert.equal(reserves.data.reserves.recordedCashMinor, 95_000);
  assert.equal(reserves.data.reserves.safeFlexibleMinor, 80_000);

  const daily = reserves.data.dailyReference;
  assert.equal(daily.available, true);
  if (!daily.available) return;
  assert.equal(daily.date, "2026-11-23");
  assert.equal(daily.basis, "derived_start_of_day");
  assert.equal(daily.historical, false);
  assert.equal(daily.allowanceAvailable, true);
  assert.equal(daily.dailyIncludedExpenseMinor, 5_000);
  assert.equal(daily.daysRemaining, 8);
  assert.equal(daily.safePoolMinor, 85_000);
  assert.equal(daily.referenceMinor, 10_625);
  assert.equal(daily.dailyRemainingMinor, 5_625);
  assert.ok(money.reserveReads.includes("2026-11-22"));
  assert.ok(money.reserveReads.includes("2026-11-23"));

  // Independent integer-centime oracle, not a reimplementation of the app.
  const days = Math.floor(
    (Date.parse("2026-11-30T00:00:00Z") - Date.parse("2026-11-23T00:00:00Z")) /
      86_400_000,
  ) + 1;
  const expectedSafeFlexible = 95_000 - 10_000 - 5_000;
  const expectedSafePool = expectedSafeFlexible + 5_000;
  const expectedReference = Math.floor(expectedSafePool / days);
  assert.equal(days, 8);
  assert.equal(expectedSafeFlexible, reserves.data.reserves.safeFlexibleMinor);
  assert.equal(expectedSafePool, daily.safePoolMinor);
  assert.equal(expectedReference, daily.referenceMinor);
  assert.equal(expectedReference - 5_000, daily.dailyRemainingMinor);

  // Reload is observational: the cursor, ledger and baseline evidence do not move.
  const ledgerBefore = money.ledger.length;
  const reloaded = await getMoneyState(
    ACTOR,
    money.repository,
    {},
    { now: later, timezone: "Africa/Casablanca" },
  );
  assert.equal(reloaded.ok, true);
  if (!reloaded.ok) return;
  assert.equal(reloaded.data.period?.activeDate, "2026-11-21");
  assert.equal(reloaded.data.period?.version, tracking.value.version);
  assert.equal(money.ledger.length, ledgerBefore);
  assert.deepEqual(money.ensured, []);
  assert.equal(money.rebaseCalls(), rebaseCallsAfterSetup);
});

test("derived day-start guidance reads the exclusive prior day, not current inputs", async () => {
  const base = {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-21",
    opening: {
      amountMinor: 100_000,
      source: "user_entered" as const,
      cutoffDate: "2026-11-01",
      evidence: null,
      note: null,
    },
  };
  const cases = [
    {
      name: "expense-only day",
      start: { cash: 100_000, commitments: 0, funded: 0, used: 0 },
      current: { cash: 95_000, commitments: 0, funded: 0, used: 0 },
      savingsTarget: 10_000,
      emergencyTarget: 5_000,
      daily: 5_000,
      safePool: 85_000,
      reference: 10_625,
      remaining: 5_625,
    },
    {
      name: "income received during the day does not lift today's day-start reference",
      start: { cash: 100_000, commitments: 0, funded: 0, used: 0 },
      current: { cash: 115_000, commitments: 0, funded: 0, used: 0 },
      savingsTarget: 10_000,
      emergencyTarget: 5_000,
      daily: 5_000,
      safePool: 85_000,
      reference: 10_625,
      remaining: 5_625,
    },
    {
      name: "a fixed obligation paid during the day was already protected at day start",
      start: { cash: 100_000, commitments: 3_000, funded: 0, used: 0 },
      current: { cash: 97_000, commitments: 0, funded: 0, used: 0 },
      savingsTarget: 10_000,
      emergencyTarget: 5_000,
      daily: 0,
      safePool: 82_000,
      reference: 10_250,
      remaining: 10_250,
    },
    {
      name: "a savings transfer during the day is neutral to the day-start pool",
      start: { cash: 100_000, commitments: 0, funded: 0, used: 0 },
      current: { cash: 98_000, commitments: 0, funded: 2_000, used: 0 },
      savingsTarget: 10_000,
      emergencyTarget: 5_000,
      daily: 0,
      safePool: 85_000,
      reference: 10_625,
      remaining: 10_625,
    },
    {
      name: "emergency spending reduces the day-start pool only through its daily class",
      start: { cash: 100_000, commitments: 0, funded: 0, used: 0 },
      current: { cash: 99_500, commitments: 0, funded: 0, used: 500 },
      savingsTarget: 10_000,
      emergencyTarget: 5_000,
      daily: 500,
      safePool: 85_000,
      reference: 10_625,
      remaining: 10_125,
    },
    {
      name: "a current-plan savings target change is guidance, not retained history",
      start: { cash: 100_000, commitments: 0, funded: 0, used: 0 },
      current: { cash: 100_000, commitments: 0, funded: 0, used: 0 },
      savingsTarget: 20_000,
      emergencyTarget: 5_000,
      daily: 0,
      safePool: 75_000,
      reference: 9_375,
      remaining: 9_375,
    },
    {
      name: "a current-plan emergency protection change is guidance",
      start: { cash: 100_000, commitments: 0, funded: 0, used: 0 },
      current: { cash: 100_000, commitments: 0, funded: 0, used: 0 },
      savingsTarget: 10_000,
      emergencyTarget: 10_000,
      daily: 0,
      safePool: 80_000,
      reference: 10_000,
      remaining: 10_000,
    },
  ];

  for (const entry of cases) {
    const money = makeRepository();
    const created = await createMoneyPeriod(ACTOR, money.repository, base, {
      now: NOW,
      timezone: "Africa/Casablanca",
    });
    assert.equal(created.ok, true, entry.name);
    if (!created.ok) continue;
    const completed = await rebaseMoneyDayStartBaseline(
      ACTOR,
      money.repository,
      created.data.period.id,
    );
    assert.equal(completed.ok, true, entry.name);
    const tracking = await money.repository.findTracking(ACTOR);
    if (!tracking.ok || !tracking.value) {
      assert.fail(`${entry.name}: tracking period is missing after setup`);
    }
    money.setReserveInputs({
      available: true,
      recordedCashMinor: entry.start.cash,
      unpaidCommitmentsMinor: entry.start.commitments,
      savingsFundedMinor: entry.start.funded,
      emergencyUsedMinor: entry.start.used,
    }, "2026-11-22");
    money.setReserveInputs({
      available: true,
      recordedCashMinor: entry.current.cash,
      unpaidCommitmentsMinor: entry.current.commitments,
      savingsFundedMinor: entry.current.funded,
      emergencyUsedMinor: entry.current.used,
    });
    money.setDailyTotal({ amountMinor: entry.daily, complete: true });

    const reserves = await getCurrentMoneyReserves(ACTOR, {
      period: tracking.value,
      periods: money.repository,
      budgets: {
        async getPlan() {
          return {
            ok: true as const,
            value: {
              savingsTargetMinor: entry.savingsTarget,
              emergencyTargetMinor: entry.emergencyTarget,
            },
          };
        },
      } as unknown as MoneyBudgetRepository,
      cutoffDate: "2026-11-23",
      localToday: "2026-11-23",
    });
    assert.equal(reserves.ok, true, entry.name);
    if (!reserves.ok || !reserves.data.available) continue;
    assert.equal(reserves.data.dailyReference.available, true, entry.name);
    if (!reserves.data.dailyReference.available) continue;
    assert.equal(
      reserves.data.dailyReference.basis,
      "derived_start_of_day",
      entry.name,
    );
    assert.equal(reserves.data.dailyReference.daysRemaining, 8, entry.name);
    assert.equal(
      reserves.data.dailyReference.safePoolMinor,
      entry.safePool,
      entry.name,
    );
    assert.equal(
      reserves.data.dailyReference.referenceMinor,
      entry.reference,
      entry.name,
    );
    assert.equal(
      reserves.data.dailyReference.dailyRemainingMinor,
      entry.remaining,
      entry.name,
    );
    assert.ok(money.reserveReads.includes("2026-11-22"));
    assert.ok(money.reserveReads.includes("2026-11-23"));
    assert.deepEqual(money.ensured, []);
    assert.equal(money.rebaseCalls(), 1);
  }
});

test("derived day-start guidance stays unavailable until setup is explicitly completed", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(ACTOR, money.repository, {
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-21",
    opening: {
      amountMinor: 100_000,
      source: "user_entered",
      cutoffDate: "2026-11-01",
      evidence: null,
      note: null,
    },
  }, { now: NOW, timezone: "Africa/Casablanca" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.data.period.dayStartSetupCompleted, false);
  money.setReserveInputs({
    available: true,
    recordedCashMinor: 100_000,
    unpaidCommitmentsMinor: 0,
    savingsFundedMinor: 0,
    emergencyUsedMinor: 0,
  });

  const reserves = await getCurrentMoneyReserves(ACTOR, {
    period: created.data.period,
    periods: money.repository,
    budgets: {
      async getPlan() {
        return {
          ok: true as const,
          value: { savingsTargetMinor: 10_000, emergencyTargetMinor: 5_000 },
        };
      },
    } as unknown as MoneyBudgetRepository,
    cutoffDate: "2026-11-23",
    localToday: "2026-11-23",
  });
  assert.equal(reserves.ok, true);
  if (!reserves.ok || !reserves.data.available) return;
  assert.equal(reserves.data.dailyReference.available, false);
  if (!reserves.data.dailyReference.available) {
    assert.equal(
      reserves.data.dailyReference.reason,
      "initial_setup_incomplete",
    );
  }
  // No prior-day ledger guess is made before the owner confirms the
  // obligation set.
  assert.equal(money.reserveReads.includes("2026-11-22"), false);
});

test("a retained day-start baseline keeps its evidence and targets", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(
    ACTOR,
    money.repository,
    {
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      timezone: "Africa/Casablanca",
      activeDate: "2026-11-21",
      opening: {
        amountMinor: 100_000,
        source: "user_entered",
        cutoffDate: "2026-11-01",
        evidence: null,
        note: null,
      },
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  money.setBaseline("2026-11-23", {
    date: "2026-11-23",
    version: 3,
    availability: "available",
    unavailableReason: null,
    cashMinor: 100_000,
    commitmentsMinor: 0,
    savingsTargetMinor: 10_000,
    savingsFundedMinor: 0,
    emergencyTargetMinor: 5_000,
    emergencyUsedMinor: 0,
  });
  money.setReserveInputs({
    available: true,
    recordedCashMinor: 115_000,
    unpaidCommitmentsMinor: 0,
    savingsFundedMinor: 0,
    emergencyUsedMinor: 0,
  });
  money.setDailyTotal({ amountMinor: 5_000, complete: true });

  const reserves = await getCurrentMoneyReserves(ACTOR, {
    period: created.data.period,
    periods: money.repository,
    budgets: {
      async getPlan() {
        return {
          ok: true as const,
          value: { savingsTargetMinor: 30_000, emergencyTargetMinor: 15_000 },
        };
      },
    } as unknown as MoneyBudgetRepository,
    cutoffDate: "2026-11-23",
    localToday: "2026-11-23",
  });
  assert.equal(reserves.ok, true);
  if (!reserves.ok || !reserves.data.available) return;
  // Current reserves use the live plan; the daily reference uses retained
  // day-start evidence and must not be rewritten by later changes.
  assert.equal(reserves.data.reserves.safeFlexibleMinor, 70_000);
  const daily = reserves.data.dailyReference;
  assert.equal(daily.available, true);
  if (!daily.available) return;
  assert.equal(daily.basis, "day_start_baseline");
  assert.equal(daily.safePoolMinor, 85_000);
  assert.equal(daily.referenceMinor, 10_625);
  assert.equal(daily.dailyRemainingMinor, 5_625);
  assert.deepEqual(money.baselineReads, ["2026-11-23"]);
  assert.deepEqual(money.ensured, []);
});

test("a retained day-start baseline survives a missing current budget plan", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(ACTOR, money.repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  money.setBaseline("2026-11-23", {
    date: "2026-11-23",
    version: 3,
    availability: "available",
    unavailableReason: null,
    cashMinor: 100_000,
    commitmentsMinor: 0,
    savingsTargetMinor: 10_000,
    savingsFundedMinor: 0,
    emergencyTargetMinor: 5_000,
    emergencyUsedMinor: 0,
  });
  money.setReserveInputs({
    available: true,
    recordedCashMinor: 115_000,
    unpaidCommitmentsMinor: 0,
    savingsFundedMinor: 0,
    emergencyUsedMinor: 0,
  });
  money.setDailyTotal({ amountMinor: 5_000, complete: true });

  const reserves = await getCurrentMoneyReserves(ACTOR, {
    period: created.data.period,
    periods: money.repository,
    budgets: {
      async getPlan() {
        return { ok: true as const, value: null };
      },
    } as unknown as MoneyBudgetRepository,
    cutoffDate: "2026-11-23",
    localToday: "2026-11-23",
  });
  assert.equal(reserves.ok, true);
  if (!reserves.ok) return;
  // Current reserves still need the live plan, so they stay explicitly
  // unavailable instead of inventing targets.
  assert.equal(reserves.data.available, false);
  if (reserves.data.available) return;
  assert.equal(reserves.data.reason, "reserve_inputs_incomplete");
  // Retained day-start guidance is independent evidence and must survive the
  // missing plan; it keeps its own historical targets.
  const daily = reserves.data.dailyReference;
  assert.equal(daily.available, true);
  if (!daily.available) return;
  assert.equal(daily.basis, "day_start_baseline");
  assert.equal(daily.safePoolMinor, 85_000);
  assert.equal(daily.referenceMinor, 10_625);
  assert.equal(daily.dailyRemainingMinor, 5_625);
  assert.deepEqual(money.baselineReads, ["2026-11-23"]);
});

test("historical and start-of-period cutoffs never fabricate a derived baseline", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(ACTOR, money.repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  // Complete setup so these assertions isolate the historical-cutoff rule
  // instead of the separate initial-setup gate.
  const completed = await rebaseMoneyDayStartBaseline(
    ACTOR,
    money.repository,
    created.data.period.id,
  );
  assert.equal(completed.ok, true);
  const tracking = await money.repository.findTracking(ACTOR);
  if (!tracking.ok || !tracking.value) return;
  money.setReserveInputs({
    available: true,
    recordedCashMinor: 50_000,
    unpaidCommitmentsMinor: 0,
    savingsFundedMinor: 0,
    emergencyUsedMinor: 0,
  });
  const budgets = {
    async getPlan() {
      return {
        ok: true as const,
        value: { savingsTargetMinor: 0, emergencyTargetMinor: 0 },
      };
    },
  } as unknown as MoneyBudgetRepository;

  // An explicit historical date without retained evidence stays unavailable.
  const historical = await getCurrentMoneyReserves(ACTOR, {
    period: tracking.value,
    periods: money.repository,
    budgets,
    cutoffDate: "2026-11-10",
    localToday: "2026-11-13",
  });
  assert.equal(historical.ok, true);
  if (!historical.ok || !historical.data.available) return;
  assert.equal(historical.data.dailyReference.available, false);
  if (!historical.data.dailyReference.available) {
    assert.equal(historical.data.dailyReference.reason, "day_start_baseline_missing");
  }
  assert.ok(!money.reserveReads.includes("2026-11-09"));

  // The first day has no prior-day ledger read; its baseline must come from an
  // explicit setup/close action rather than a guessed opening.
  money.reserveReads.length = 0;
  const firstDay = await getCurrentMoneyReserves(ACTOR, {
    period: tracking.value,
    periods: money.repository,
    budgets,
    cutoffDate: "2026-11-01",
    localToday: "2026-11-01",
  });
  assert.equal(firstDay.ok, true);
  if (!firstDay.ok || !firstDay.data.available) return;
  assert.equal(firstDay.data.dailyReference.available, false);
  if (!firstDay.data.dailyReference.available) {
    assert.equal(firstDay.data.dailyReference.reason, "day_start_baseline_missing");
  }
  assert.deepEqual(money.reserveReads, ["2026-11-01"]);
});

test("an ended period projects to its end date, not the active cursor", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(ACTOR, money.repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const completed = await rebaseMoneyDayStartBaseline(
    ACTOR,
    money.repository,
    created.data.period.id,
  );
  assert.equal(completed.ok, true);
  const entry = money.periods.get(created.data.period.id)!;
  money.periods.set(created.data.period.id, {
    ...entry,
    period: {
      ...entry.period,
      lifecycle: "ended",
      version: entry.period.version + 1,
    },
  });
  money.setReserveInputs({
    available: true,
    recordedCashMinor: 48_900,
    unpaidCommitmentsMinor: 0,
    savingsFundedMinor: 0,
    emergencyUsedMinor: 0,
  });

  const state = await getMoneyState(
    ACTOR,
    money.repository,
    {},
    { now: new Date("2026-11-13T12:00:00.000Z"), timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (!state.ok) return;
  assert.equal(state.data.period?.activeDate, "2026-11-11");
  assert.equal(state.data.dateResolution.projectionCutoffDate, "2026-11-30");
  assert.equal(state.data.dateResolution.projectionBasis, "period_end");
  assert.equal(state.data.dateResolution.projectionClampedToPeriod, false);
  assert.equal(state.data.cash.cutoffDate, "2026-11-30");

  const reserves = await getCurrentMoneyReserves(ACTOR, {
    period: state.data.period!,
    periods: money.repository,
    budgets: {
      async getPlan() {
        return {
          ok: true as const,
          value: { savingsTargetMinor: 0, emergencyTargetMinor: 0 },
        };
      },
    } as unknown as MoneyBudgetRepository,
    cutoffDate: state.data.dateResolution.projectionCutoffDate,
    localToday: state.data.localToday,
  });
  assert.equal(reserves.ok, true);
  if (!reserves.ok || !reserves.data.available) return;
  assert.equal(reserves.data.cutoffDate, "2026-11-30");
  // The final day has no retained baseline and is not "today", so the
  // historical reference stays unavailable instead of being invented.
  assert.equal(reserves.data.dailyReference.available, false);
  if (!reserves.data.dailyReference.available) {
    assert.equal(reserves.data.dailyReference.reason, "day_start_baseline_missing");
  }
});

test("current daily guidance stays unavailable for incomplete or missing inputs", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(ACTOR, money.repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const completed = await rebaseMoneyDayStartBaseline(
    ACTOR,
    money.repository,
    created.data.period.id,
  );
  assert.equal(completed.ok, true);
  const state = await getMoneyState(
    ACTOR,
    money.repository,
    {},
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (!state.ok || !state.data.period) return;
  const budgets = {
    async getPlan() {
      return {
        ok: true as const,
        value: { savingsTargetMinor: 0, emergencyTargetMinor: 0 },
      };
    },
  } as unknown as MoneyBudgetRepository;

  money.setReserveInputs({
    available: true,
    recordedCashMinor: 50_000,
    unpaidCommitmentsMinor: 0,
    savingsFundedMinor: 0,
    emergencyUsedMinor: 0,
  });
  money.setDailyTotal({ amountMinor: 0, complete: false });
  const incompleteTotal = await getCurrentMoneyReserves(ACTOR, {
    period: state.data.period,
    periods: money.repository,
    budgets,
    cutoffDate: "2026-11-11",
    localToday: "2026-11-11",
  });
  assert.equal(incompleteTotal.ok, true);
  if (!incompleteTotal.ok || !incompleteTotal.data.available) return;
  assert.equal(incompleteTotal.data.reserves.safeFlexibleMinor, 50_000);
  assert.equal(incompleteTotal.data.dailyReference.available, false);
  if (!incompleteTotal.data.dailyReference.available) {
    assert.equal(
      incompleteTotal.data.dailyReference.reason,
      "daily_expense_total_unavailable",
    );
  }

  money.setDailyTotal({ amountMinor: 0, complete: true });
  money.setBaseline("2026-11-11", {
    date: "2026-11-11",
    version: 1,
    availability: "unavailable",
    unavailableReason: "initial_setup_incomplete",
    cashMinor: null,
    commitmentsMinor: null,
    savingsTargetMinor: null,
    savingsFundedMinor: null,
    emergencyTargetMinor: null,
    emergencyUsedMinor: null,
  });
  const incompleteBaseline = await getCurrentMoneyReserves(ACTOR, {
    period: state.data.period,
    periods: money.repository,
    budgets,
    cutoffDate: "2026-11-11",
    localToday: "2026-11-11",
  });
  assert.equal(incompleteBaseline.ok, true);
  if (!incompleteBaseline.ok || !incompleteBaseline.data.available) return;
  assert.equal(incompleteBaseline.data.dailyReference.available, false);
  if (!incompleteBaseline.data.dailyReference.available) {
    assert.equal(
      incompleteBaseline.data.dailyReference.reason,
      "initial_setup_incomplete",
    );
  }

  money.setBaseline("2026-11-11", null);
  money.setReserveInputs({ available: false, reason: "opening_unknown" }, "2026-11-10");
  const unavailableStartOfDay = await getCurrentMoneyReserves(ACTOR, {
    period: state.data.period,
    periods: money.repository,
    budgets,
    cutoffDate: "2026-11-11",
    localToday: "2026-11-11",
  });
  assert.equal(unavailableStartOfDay.ok, true);
  if (!unavailableStartOfDay.ok || !unavailableStartOfDay.data.available) return;
  assert.equal(unavailableStartOfDay.data.dailyReference.available, false);
  if (!unavailableStartOfDay.data.dailyReference.available) {
    assert.equal(
      unavailableStartOfDay.data.dailyReference.reason,
      "opening_unknown",
    );
  }

  money.setReserveInputs({ available: false, reason: "opening_unknown" });
  const unavailableReserve = await getCurrentMoneyReserves(ACTOR, {
    period: state.data.period,
    periods: money.repository,
    budgets,
    cutoffDate: "2026-11-11",
    localToday: "2026-11-11",
  });
  assert.equal(unavailableReserve.ok, true);
  if (!unavailableReserve.ok) return;
  assert.equal(unavailableReserve.data.available, false);
  if (unavailableReserve.data.available) return;
  assert.equal(unavailableReserve.data.reason, "opening_unknown");
  assert.equal(unavailableReserve.data.dailyReference.available, false);
  assert.deepEqual(money.ensured, []);
  assert.equal(money.rebaseCalls(), 1);
});

test("opening corrections keep one ledger row and append reviewable provenance", async () => {
  const { repository, ledger } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const corrected = await updateMoneySettings(
    ACTOR,
    repository,
    created.data.period.id,
    {
      version: created.data.period.version,
      opening: {
        amountMinor: 55_000,
        source: "user_entered",
        cutoffDate: "2026-11-08",
        evidence: null,
        note: "recounted",
      },
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(corrected.ok, true);
  if (!corrected.ok) return;
  assert.equal(corrected.data.openingMovementId, created.data.period.openingMovementId);
  assert.equal(ledger.filter((row) => row.kind === "opening").length, 1);
  const corrections = corrected.data.provenance.opening?.corrections ?? [];
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].previousAmountMinor, 50_000);
  assert.equal(corrections[0].amountMinor, 55_000);
  assert.equal(corrections[0].ledgerVersion, 2);

  const state = await getMoneyState(
    ACTOR,
    repository,
    {},
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (state.ok && state.data.opening.status === "known") {
    assert.equal(state.data.opening.amountMinor, 55_000);
  }
});

test("unassigned legacy rows inside the period are surfaced, never called reconciled", async () => {
  const { repository, addExpense } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  addExpense(ACTOR.userId, 1100, "2026-11-10", null);

  const state = await getMoneyState(
    ACTOR,
    repository,
    {},
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(state.ok, true);
  if (!state.ok || !state.data.legacy.available) return;
  assert.equal(state.data.legacy.inPeriodUnassignedCount, 1);
  assert.equal(state.data.legacy.reviewRequired, true);
  assert.equal(
    state.data.legacy.bookingDateAssignment,
    "derived_from_occurred_at_in_owner_timezone",
  );
});

test("periods and openings are isolated between owners", async () => {
  const { repository } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const foreign = await getMoneyState(
    OTHER,
    repository,
    { periodId: created.data.period.id },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, "notFound");

  const foreignState = await getMoneyState(
    OTHER,
    repository,
    {},
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(foreignState.ok, true);
  if (foreignState.ok) assert.equal(foreignState.data.period, null);
});

function expenseRepository() {
  let created: PersonalExpense | null = null;
  let lastCreate:
    | Readonly<{
        periodId: string | null;
        requiresContinuation: boolean;
        bookingDate: string | undefined;
      }>
    | null = null;
  const repository: ExpenseRepository = {
    async findByIdempotencyKey() {
      return { ok: true as const, value: null };
    },
    async create(actor, input) {
      lastCreate = {
        periodId: input.periodId ?? null,
        requiresContinuation: input.requiresContinuation === true,
        bookingDate: input.periodBookingDate ?? input.values.bookingDate,
      };
      created = {
        id: "eeeeeeee-0000-4000-8000-000000000001",
        kind: "expense",
        direction: "out",
        occurredAt: input.values.occurredAt,
        bookingDate: input.values.bookingDate,
        amountMinor: input.values.amountMinor,
        currency: "MAD",
        category: input.values.category,
        note: input.values.note,
        merchant: input.values.merchant,
        needVsWant: input.values.needVsWant,
        paymentMethod: input.values.paymentMethod,
        purpose: null,
        countsInDaily: true,
        periodId: input.periodId ?? null,
        idempotencyKey: input.values.idempotencyKey,
        version: 1,
        deletedAt: null,
        createdAt: "2026-11-11T12:00:00.000Z",
        updatedAt: "2026-11-11T12:00:00.000Z",
      };
      return { ok: true as const, value: created };
    },
    async get() {
      return { ok: true as const, value: created };
    },
    async list() {
      return { ok: true as const, value: [] };
    },
    async update() {
      return { ok: true as const, value: created! };
    },
    async softDelete() {
      return {
        ok: true as const,
        value: { id: "", deletedAt: "", alreadyDeleted: true },
      };
    },
    async summarize() {
      return {
        ok: true as const,
        value: {
          totalsByCategory: {},
          countsByCategory: {},
          recordCount: 0,
          truncated: false,
        },
      };
    },
    async count() {
      return { ok: true as const, value: 0 };
    },
  };
  return {
    repository,
    created: () => created,
    lastCreate: () => lastCreate,
  };
}

const EXPENSE_BODY = {
  occurredAt: "2026-11-11T12:00:00.000Z",
  amountMinor: 1100,
  category: "coffee",
  needVsWant: "want",
  idempotencyKey: "expense-guard-1",
};

test("routine expense creation delegates continuation to the atomic insert", async () => {
  const money = makeRepository();
  const expenses = expenseRepository();
  // The tracking window ends before owner-local today (2026-11-11 in
  // Africa/Casablanca), so the continuation branch itself is reachable.
  const created = await createMoneyPeriod(
    ACTOR,
    money.repository,
    {
      ...CREATE_BODY,
      startDate: "2026-11-01",
      endDate: "2026-11-05",
      activeDate: "2026-11-05",
      opening: { ...CREATE_BODY.opening, cutoffDate: "2026-10-31" },
    },
    {
      now: NOW,
      timezone: "Africa/Casablanca",
    },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const inRange = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-03T12:00:00.000Z",
      idempotencyKey: "expense-guard-in-range",
    },
    { periods: money.repository, now: NOW },
  );
  assert.equal(inRange.ok, true);
  if (inRange.ok) {
    assert.equal(inRange.data.expense.periodId, created.data.period.id);
  }
  assert.deepEqual(expenses.lastCreate(), {
    periodId: created.data.period.id,
    requiresContinuation: false,
    bookingDate: "2026-11-03",
  });

  // A date before the tracking window is a historical correction, never an
  // automatically invented earlier period.
  const beforeWindow = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-10-30T12:00:00.000Z",
      idempotencyKey: "expense-guard-before",
    },
    { periods: money.repository, now: NOW },
  );
  assert.equal(beforeWindow.ok, false);
  if (!beforeWindow.ok) {
    assert.equal(beforeWindow.code, "validation");
    assert.match(beforeWindow.errorMessage, /outside the tracking period/);
  }

  // A future booking must not supersede the current window: only dates up to
  // owner-local today in the source period timezone may continue the calendar.
  const future = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-12T12:00:00.000Z",
      idempotencyKey: "expense-guard-future",
    },
    { periods: money.repository, now: NOW },
  );
  assert.equal(future.ok, false);
  if (!future.ok) {
    assert.equal(future.code, "validation");
    assert.match(future.errorMessage, /in the future/);
  }
  assert.equal(
    money.periods.get(created.data.period.id)?.period.lifecycle,
    "tracking",
  );

  // A date after the tracking window that is not in the future is not
  // continued by the read guard. The request carries `requiresContinuation`,
  // so the repository can continue and insert in one database transaction.
  const afterWindow = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-08T12:00:00.000Z",
      idempotencyKey: "expense-guard-continue",
    },
    { periods: money.repository, now: NOW },
  );
  assert.equal(afterWindow.ok, true);
  assert.deepEqual(expenses.lastCreate(), {
    periodId: null,
    requiresContinuation: true,
    bookingDate: "2026-11-08",
  });
  // The read guard alone never superseded the source.
  assert.equal(
    money.periods.get(created.data.period.id)?.period.lifecycle,
    "tracking",
  );
});

test("a final-day closed period continues the calendar for a later routine date", async () => {
  const money = makeRepository();
  const expenses = expenseRepository();
  const created = await createMoneyPeriod(
    ACTOR,
    money.repository,
    {
      ...CREATE_BODY,
      startDate: "2026-11-01",
      endDate: "2026-11-05",
      activeDate: "2026-11-05",
      opening: { ...CREATE_BODY.opening, cutoffDate: "2026-10-31" },
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const sourceId = created.data.period.id;
  const source = money.periods.get(sourceId)!;
  money.periods.set(sourceId, {
    ownerUserId: ACTOR.userId,
    period: {
      ...source.period,
      lifecycle: "ended",
      version: source.period.version + 1,
    },
  });

  // The closed range itself stays a historical correction: continuing the
  // calendar must never reopen the final day that owns the close evidence.
  const insideClosed = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-05T12:00:00.000Z",
      idempotencyKey: "expense-guard-ended-inside",
    },
    { periods: money.repository, now: NOW },
  );
  assert.equal(insideClosed.ok, false);
  if (!insideClosed.ok) {
    assert.equal(insideClosed.code, "validation");
    assert.match(insideClosed.errorMessage, /belongs to the ended period/);
  }

  // A future date still cannot continue the calendar before its day arrives.
  const future = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-12T12:00:00.000Z",
      idempotencyKey: "expense-guard-ended-future",
    },
    { periods: money.repository, now: NOW },
  );
  assert.equal(future.ok, false);
  if (!future.ok) {
    assert.equal(future.code, "validation");
    assert.match(future.errorMessage, /in the future/);
  }

  // With no tracking period, a later non-future date asks the database to
  // continue from the latest ended period and insert the row atomically.
  const continued = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-08T12:00:00.000Z",
      idempotencyKey: "expense-guard-ended-continue",
    },
    { periods: money.repository, now: NOW },
  );
  assert.equal(continued.ok, true);
  assert.deepEqual(expenses.lastCreate(), {
    periodId: null,
    requiresContinuation: true,
    bookingDate: "2026-11-08",
  });
  // The read guard never mutates or reclassifies the ended source.
  assert.equal(
    money.periods.get(sourceId)?.period.lifecycle,
    "ended",
  );
});

test("a non-finalized superseded period still accepts its own routine dates", async () => {
  const money = makeRepository();
  const expenses = expenseRepository();
  const created = await createMoneyPeriod(ACTOR, money.repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const sourceId = created.data.period.id;
  const source = money.periods.get(sourceId)!;
  money.periods.set(sourceId, {
    ownerUserId: ACTOR.userId,
    period: {
      ...source.period,
      lifecycle: "superseded",
      version: source.period.version + 1,
    },
  });
  money.periods.set("ffffffff-ffff-4fff-8fff-ffffffffffff", {
    ownerUserId: ACTOR.userId,
    period: {
      ...source.period,
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      activeDate: "2026-12-01",
      lifecycle: "tracking",
      initialization: "uninitialized",
      openingMovementId: null,
      provenance: {
        opening: null,
        createdFrom: "web",
        continuedFrom: sourceId,
      },
    },
  });

  const backfill = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-20T12:00:00.000Z",
      idempotencyKey: "expense-guard-superseded",
    },
    { periods: money.repository },
  );
  assert.equal(backfill.ok, true);
  if (backfill.ok) assert.equal(backfill.data.expense.periodId, sourceId);
  assert.deepEqual(expenses.lastCreate(), {
    periodId: sourceId,
    requiresContinuation: false,
    bookingDate: "2026-11-20",
  });

  // Once the superseded period is finalized, its range is historical only.
  const finalized = money.periods.get(sourceId)!;
  money.periods.set(sourceId, {
    ownerUserId: ACTOR.userId,
    period: { ...finalized.period, lifecycle: "rolled_over" },
  });
  const afterFinalization = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-20T12:00:00.000Z",
      idempotencyKey: "expense-guard-finalized",
    },
    { periods: money.repository },
  );
  assert.equal(afterFinalization.ok, false);
  if (!afterFinalization.ok) {
    assert.equal(afterFinalization.code, "validation");
  }
});

test("a timestamped backfill derives its day in the superseded period timezone", async () => {
  const money = makeRepository();
  const expenses = expenseRepository();
  // The retained source owns Pacific/Kiritimati, while the later tracking
  // period uses America/Los_Angeles. The instant is 1 November in the source
  // period but 31 October in the tracking zone, a date that no period owns.
  // Resolving the day in the tracking zone would reject a valid backfill.
  const created = await createMoneyPeriod(
    ACTOR,
    money.repository,
    {
      ...CREATE_BODY,
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      timezone: "Pacific/Kiritimati",
      activeDate: "2026-11-01",
      opening: { ...CREATE_BODY.opening, cutoffDate: "2026-10-31" },
    },
    { now: NOW, timezone: "Pacific/Kiritimati" },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const sourceId = created.data.period.id;
  const source = money.periods.get(sourceId)!;
  money.periods.set(sourceId, {
    ownerUserId: ACTOR.userId,
    period: {
      ...source.period,
      lifecycle: "superseded",
      version: source.period.version + 1,
    },
  });
  money.periods.set("ffffffff-ffff-4fff-8fff-ffffffffffff", {
    ownerUserId: ACTOR.userId,
    period: {
      ...source.period,
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      activeDate: "2026-12-01",
      timezone: "America/Los_Angeles",
      lifecycle: "tracking",
      initialization: "uninitialized",
      openingMovementId: null,
      provenance: {
        opening: null,
        createdFrom: "web",
        continuedFrom: sourceId,
      },
    },
  });

  const backfill = await createExpense(
    ACTOR,
    expenses.repository,
    {
      ...EXPENSE_BODY,
      occurredAt: "2026-11-01T05:00:00.000Z",
      idempotencyKey: "expense-guard-superseded-timezone",
    },
    { periods: money.repository, now: NOW },
  );
  assert.equal(backfill.ok, true);
  if (backfill.ok) assert.equal(backfill.data.expense.periodId, sourceId);
  assert.deepEqual(expenses.lastCreate(), {
    periodId: sourceId,
    requiresContinuation: false,
    bookingDate: "2026-11-01",
  });
});

test("a non-finalized superseded period initializes only its missing opening", async () => {
  const money = makeRepository();
  const created = await createMoneyPeriod(
    ACTOR,
    money.repository,
    { ...CREATE_BODY, opening: undefined },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const sourceId = created.data.period.id;
  const source = money.periods.get(sourceId)!;
  const continuedFrom = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const superseded = {
    ...source.period,
    lifecycle: "superseded" as const,
    version: source.period.version + 1,
    provenance: { ...source.period.provenance, continuedFrom },
  };
  money.periods.set(sourceId, { ownerUserId: ACTOR.userId, period: superseded });

  // Active dates stay closed on a non-finalized superseded range.
  const activeMove = await updateMoneySettings(
    ACTOR,
    money.repository,
    sourceId,
    { version: superseded.version, activeDate: "2026-11-10" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(activeMove.ok, false);
  if (!activeMove.ok) {
    assert.equal(activeMove.code, "validation");
    assert.match(activeMove.errorMessage, /Only its missing opening can be initialized/);
  }

  // The one allowed path records the canonical opening and keeps the range
  // superseded; it never touches the active date.
  const initialized = await updateMoneySettings(
    ACTOR,
    money.repository,
    sourceId,
    {
      version: superseded.version,
      opening: {
        amountMinor: 50_000,
        source: "user_entered",
        cutoffDate: null,
        evidence: null,
        note: "Initialized after automatic continuation",
      },
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(initialized.ok, true);
  if (!initialized.ok) return;
  assert.equal(initialized.data.lifecycle, "superseded");
  assert.equal(initialized.data.initialization, "initialized");
  assert.notEqual(initialized.data.openingMovementId, null);
  assert.equal(initialized.data.activeDate, superseded.activeDate);
  assert.equal(initialized.data.provenance.continuedFrom, continuedFrom);

  // Once the opening exists, the superseded range is no longer a settings
  // target; later corrections require the explicit historical path.
  const correction = await updateMoneySettings(
    ACTOR,
    money.repository,
    sourceId,
    {
      version: initialized.data.version,
      opening: {
        amountMinor: 51_000,
        source: "user_entered",
        cutoffDate: null,
        evidence: null,
        note: "Second attempt",
      },
    },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(correction.ok, false);
  if (!correction.ok) assert.equal(correction.code, "validation");
});

test("a pre-period expense cannot move its booking date into the tracking window", async () => {
  const money = makeRepository();
  const expenses = expenseRepository();
  const createdPeriod = await createMoneyPeriod(ACTOR, money.repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(createdPeriod.ok, true);
  if (!createdPeriod.ok) return;

  const seeded = await expenses.repository.create(ACTOR, {
    values: {
      occurredAt: "2026-11-07T09:30:00.000Z",
      bookingDate: "2026-11-07",
      amountMinor: 1_100,
      category: "coffee",
      note: null,
      merchant: null,
      needVsWant: "want",
      paymentMethod: null,
      idempotencyKey: "pre-period-expense",
    },
    createFingerprint: "f".repeat(64),
    periodId: null,
    countsInDaily: true,
  });
  assert.equal(seeded.ok, true);
  if (!seeded.ok) return;

  const moved = await updateExpense(
    ACTOR,
    expenses.repository,
    seeded.value.id,
    { version: 1, bookingDate: "2026-11-10" },
    { periods: money.repository },
  );
  assert.equal(moved.ok, false);
  if (!moved.ok) {
    assert.match(moved.errorMessage, /original booking date/);
  }
});

test("an account with no period keeps the existing expense creation path", async () => {
  const money = makeRepository();
  const expenses = expenseRepository();
  const created = await createExpense(
    ACTOR,
    expenses.repository,
    EXPENSE_BODY,
    { periods: money.repository },
  );
  assert.equal(created.ok, true);
});

test("an ended period refuses routine settings and the state exposes lifecycle", async () => {
  const { repository, periods } = makeRepository();
  const created = await createMoneyPeriod(ACTOR, repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const entry = periods.get(created.data.period.id)!;
  periods.set(created.data.period.id, {
    ...entry,
    period: { ...entry.period, lifecycle: "ended", version: entry.period.version + 1 },
  });

  const refused = await updateMoneySettings(
    ACTOR,
    repository,
    created.data.period.id,
    { version: entry.period.version + 1, activeDate: "2026-11-10" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.errorMessage, /historical correction path/);
});
