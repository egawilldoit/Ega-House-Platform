import assert from "node:assert/strict";
import test from "node:test";

import {
  createAuthenticatedActor,
  createExpense,
  createMoneyPeriod,
  getMoneyState,
  rebaseMoneyDayStartBaseline,
  routineEntryGuardFailure,
  updateMoneySettings,
  type ExpenseRepository,
  type MoneyPeriodRepository,
} from "../src/index";
import type { MoneyDayClose, MoneyOpening, MoneyPeriod } from "@ega/domain/money";
import type { PersonalExpense } from "@ega/domain/expenses";

const ACTOR = createAuthenticatedActor("owner-money");
const OTHER = createAuthenticatedActor("owner-other");
const NOW = new Date("2026-11-11T12:00:00.000Z");

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
    async getDayStartBaseline() {
      return { ok: true as const, value: null };
    },
    async getDailyIncludedExpenseTotal(actor, periodId, date) {
      const amount = ledger.filter((row) => row.ownerUserId === actor.userId && row.periodId === periodId && row.bookingDate === date && !row.deletedAt).reduce((sum, row) => sum + row.amountMinor, 0);
      return { ok: true as const, value: { ...dailyTotal, amountMinor: amount || dailyTotal.amountMinor } };
    },
    async getDayCloseForDate() {
      return { ok: true as const, value: null };
    },
    async getReserveInputs() {
      return {
        ok: true as const,
        value: { available: false as const, reason: "reserve_inputs_incomplete" },
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

  return { repository, addExpense, periods, ledger, ensured, setDailyTotal(value: { amountMinor: number; complete: boolean }) { dailyTotal = value; } };
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

test("a retained close makes the active date close-driven", async () => {
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
        value: [{ id: "close-1" } as MoneyDayClose],
      };
    },
  };

  const skipped = await updateMoneySettings(
    ACTOR,
    withClose,
    created.data.period.id,
    { version: created.data.period.version, activeDate: "2026-11-12" },
    { now: NOW, timezone: "Africa/Casablanca" },
  );
  assert.equal(skipped.ok, false);
  if (!skipped.ok) {
    assert.equal(skipped.code, "validation");
    assert.match(skipped.errorMessage, /closing the active day/);
  }

  const unchanged = await updateMoneySettings(
    ACTOR,
    withClose,
    created.data.period.id,
    { version: created.data.period.version, activeDate: created.data.period.activeDate },
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
  }
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
  const repository: ExpenseRepository = {
    async findByIdempotencyKey() {
      return { ok: true as const, value: null };
    },
    async create(actor, input) {
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
        periodId: null,
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
  return { repository, created: () => created };
}

const EXPENSE_BODY = {
  occurredAt: "2026-11-11T12:00:00.000Z",
  amountMinor: 1100,
  category: "coffee",
  needVsWant: "want",
  idempotencyKey: "expense-guard-1",
};

test("routine expense creation is guarded by the tracking period date", async () => {
  const money = makeRepository();
  const expenses = expenseRepository();
  const created = await createMoneyPeriod(ACTOR, money.repository, CREATE_BODY, {
    now: NOW,
    timezone: "Africa/Casablanca",
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const inRange = await createExpense(
    ACTOR,
    expenses.repository,
    EXPENSE_BODY,
    { periods: money.repository },
  );
  assert.equal(inRange.ok, true);

  const outOfRange = await createExpense(
    ACTOR,
    expenses.repository,
    { ...EXPENSE_BODY, occurredAt: "2026-12-02T12:00:00.000Z", idempotencyKey: "expense-guard-2" },
    { periods: money.repository },
  );
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) {
    assert.equal(outOfRange.code, "validation");
    assert.match(outOfRange.errorMessage, /outside the tracking period/);
  }

  // End the tracking period: routine entries are then refused entirely.
  const entry = money.periods.get(created.data.period.id)!;
  money.periods.set(created.data.period.id, {
    ...entry,
    period: { ...entry.period, lifecycle: "rolled_over" },
  });
  const afterRollover = await createExpense(
    ACTOR,
    expenses.repository,
    { ...EXPENSE_BODY, idempotencyKey: "expense-guard-3" },
    { periods: money.repository },
  );
  assert.equal(afterRollover.ok, false);
  if (!afterRollover.ok) {
    assert.match(afterRollover.errorMessage, /historical correction path/);
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
