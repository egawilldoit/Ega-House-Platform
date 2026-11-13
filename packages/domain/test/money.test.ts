import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_DIRECTIONS,
  MONEY_KINDS,
  MONEY_PURPOSES,
  MONEY_PERIOD_INITIALIZATIONS,
  MONEY_PERIOD_LIFECYCLES,
  MONEY_DEFAULT_TIMEZONE,
  canonicalMoneyOpeningPayload,
  calculateMoneyDailyReference,
  calculateMoneyReserves,
  canonicalMovementCreatePayload,
  classifyDateInPeriod,
  defaultCountsInDaily,
  isMoneyAmountMinor,
  moneyTimezoneOrDefault,
  parseCreateMoneyPeriodInput,
  parseCreateMovementInput,
  parseMoneyListQuery,
  parseMoneySettings,
  parseMoneyStateQuery,
  parseUpdateMovementInput,
  parseUpdateMoneySettingsInput,
  periodAcceptsRoutineEntries,
  periodsOverlap,
  validateOpeningAgainstPeriod,
  type MoneyPeriod,
} from "../src/money";

test("MONEY-08 protects disjoint reserves and releases matched funding once", () => {
  const before = calculateMoneyReserves({ recordedCashMinor: 68_900, unpaidCommitmentsMinor: 10_000, savingsTargetMinor: 20_000, savingsFundedMinor: 0, emergencyTargetMinor: 5_000, emergencyUsedMinor: 0 });
  assert.equal(before.safeFlexibleMinor, 33_900);
  assert.equal(calculateMoneyReserves({ recordedCashMinor: 58_900, unpaidCommitmentsMinor: 0, savingsTargetMinor: 20_000, savingsFundedMinor: 0, emergencyTargetMinor: 5_000, emergencyUsedMinor: 0 }).safeFlexibleMinor, 33_900);
  assert.equal(calculateMoneyReserves({ recordedCashMinor: 48_900, unpaidCommitmentsMinor: 10_000, savingsTargetMinor: 20_000, savingsFundedMinor: 20_000, emergencyTargetMinor: 5_000, emergencyUsedMinor: 0 }).safeFlexibleMinor, 33_900);
});

test("MONEY-08 daily reference floors centimes and subtracts counted spending once", () => {
  const result = calculateMoneyDailyReference({ startCashMinor: 68_900, startCommitmentsMinor: 10_000, startSavingsTargetMinor: 20_000, savingsFundedBeforeMinor: 0, startEmergencyTargetMinor: 5_000, emergencyUsedBeforeMinor: 0, periodEnd: "2026-11-10", selectedDate: "2026-11-01", dailyIncludedExpenseMinor: 1_100, periodLifecycle: "tracking" });
  assert.equal(result.available, true);
  if (result.available) { assert.equal(result.referenceMinor, 3_390); assert.equal(result.dailyRemainingMinor, 2_290); }
  assert.equal(calculateMoneyDailyReference({ startCashMinor: null, startCommitmentsMinor: 0, startSavingsTargetMinor: 0, savingsFundedBeforeMinor: 0, startEmergencyTargetMinor: 0, emergencyUsedBeforeMinor: 0, periodEnd: "2026-11-10", selectedDate: "2026-11-01", dailyIncludedExpenseMinor: 0, periodLifecycle: "tracking" }).available, false);
});

test("MONEY-08 ended periods retain historical daily results without a current allowance", () => {
  const result = calculateMoneyDailyReference({ startCashMinor: 1_000, startCommitmentsMinor: 0, startSavingsTargetMinor: 0, savingsFundedBeforeMinor: 0, startEmergencyTargetMinor: 0, emergencyUsedBeforeMinor: 0, periodEnd: "2026-11-10", selectedDate: "2026-11-10", dailyIncludedExpenseMinor: 250, periodLifecycle: "ended" });
  assert.equal(result.available, true);
  if (result.available) {
    assert.equal(result.historical, true);
    assert.equal(result.allowanceAvailable, false);
    assert.equal(result.referenceMinor, 1_000);
    assert.equal(result.dailyRemainingMinor, 750);
  }
});

const VALID_CREATE = {
  startDate: "2026-11-09",
  endDate: "2026-11-30",
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-11",
  opening: {
    amountMinor: 50_000,
    source: "user_entered",
    cutoffDate: "2026-11-08",
    evidence: null,
    note: "cash counted at start",
  },
  settings: { dailyTargetMinor: 20_000 },
};

const INCOME = {
  kind: "income",
  amountMinor: 20_000,
  bookingDate: "2026-11-09",
  note: "  Salary  ",
  idempotencyKey: " income-1 ",
};

function period(overrides: Partial<MoneyPeriod> = {}): MoneyPeriod {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    startDate: "2026-11-09",
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

function expectCreateFailure(input: unknown, field: string) {
  const parsed = parseCreateMovementInput(input);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.field, field);
}

test("the shared movement vocabulary is frozen exactly as the contract requires", () => {
  assert.deepEqual(MONEY_KINDS, [
    "expense",
    "income",
    "opening",
    "savings_transfer",
    "reconciliation_adjustment",
  ]);
  assert.deepEqual(MONEY_DIRECTIONS, ["in", "out"]);
  assert.deepEqual(MONEY_PURPOSES, ["fixed", "flexible", "emergency"]);
  assert.deepEqual(MONEY_PERIOD_LIFECYCLES, ["tracking", "ended", "rolled_over"]);
  assert.deepEqual(MONEY_PERIOD_INITIALIZATIONS, [
    "uninitialized",
    "initialized",
    "reconciled",
  ]);
  assert.equal(MONEY_DEFAULT_TIMEZONE, "Africa/Casablanca");
});

test("opening zero is valid while every normal amount stays positive", () => {
  assert.equal(isMoneyAmountMinor(0, { allowZero: true }), true);
  assert.equal(isMoneyAmountMinor(0, { allowZero: false }), false);
  assert.equal(isMoneyAmountMinor(1100, { allowZero: false }), true);
  assert.equal(isMoneyAmountMinor(11.5, { allowZero: true }), false);
  assert.equal(isMoneyAmountMinor(-1, { allowZero: true }), false);
});

test("create normalizes a partial period and defaults active date to the owner's today", () => {
  const parsed = parseCreateMoneyPeriodInput(
    { startDate: "2026-11-09", endDate: "2026-11-30" },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.activeDate, "2026-11-11");
    assert.equal(parsed.value.timezone, "Africa/Casablanca");
    assert.equal(parsed.value.opening, null);
    assert.deepEqual(parsed.value.settings, {});
  }
});

test("a period outside today requires an explicit active date", () => {
  const parsed = parseCreateMoneyPeriodInput(
    { startDate: "2026-10-01", endDate: "2026-10-31" },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.field, "activeDate");

  const explicit = parseCreateMoneyPeriodInput(
    { startDate: "2026-10-01", endDate: "2026-10-31", activeDate: "2026-10-31" },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(explicit.ok, true);
});

test("invalid ranges, oversized ranges and invalid timezones are actionable", () => {
  const reversed = parseCreateMoneyPeriodInput(
    { startDate: "2026-11-30", endDate: "2026-11-09", activeDate: "2026-11-30" },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(reversed.ok, false);

  const oversized = parseCreateMoneyPeriodInput(
    { startDate: "2025-01-01", endDate: "2026-11-30", activeDate: "2025-01-01" },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.field, "endDate");

  const badZone = parseCreateMoneyPeriodInput(
    { ...VALID_CREATE, timezone: "Mars/Olympus" },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(badZone.ok, false);
  if (!badZone.ok) assert.equal(badZone.field, "timezone");
});

test("an unknown opening stores no invented amount, and zero stays known", () => {
  const unknown = parseCreateMoneyPeriodInput(
    { startDate: "2026-11-09", endDate: "2026-11-30" },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(unknown.ok, true);
  if (unknown.ok) assert.equal(unknown.value.opening, null);

  const zero = parseCreateMoneyPeriodInput(
    {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      opening: { amountMinor: 0, source: "user_entered" },
    },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(zero.ok, true);
  if (zero.ok) assert.equal(zero.value.opening?.amountMinor, 0);
});

test("verified opening requires evidence and a cutoff, never a claimed bank check", () => {
  const missingEvidence = parseCreateMoneyPeriodInput(
    {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      opening: { amountMinor: 100, source: "verified_source", cutoffDate: "2026-11-08" },
    },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(missingEvidence.ok, false);
  if (!missingEvidence.ok) assert.equal(missingEvidence.field, "opening.evidence");

  const missingCutoff = parseCreateMoneyPeriodInput(
    {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      opening: {
        amountMinor: 100,
        source: "verified_source",
        evidence: "statement 2026-11-08",
      },
    },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(missingCutoff.ok, false);
  if (!missingCutoff.ok) assert.equal(missingCutoff.field, "opening.cutoffDate");

  const futureCutoff = parseCreateMoneyPeriodInput(
    {
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      opening: {
        amountMinor: 100,
        source: "verified_source",
        cutoffDate: "2026-11-10",
        evidence: "statement",
      },
    },
    { today: "2026-11-11", timezone: "Africa/Casablanca" },
  );
  assert.equal(futureCutoff.ok, false);
});

test("settings are bounded JSON and reject prototype keys", () => {
  const parsed = parseMoneySettings({ nested: { value: [1, "two", true, null] } });
  assert.equal(parsed.ok, true);

  assert.equal(parseMoneySettings([1, 2]).ok, false);
  assert.equal(
    parseMoneySettings(JSON.parse('{"__proto__":{"polluted":true}}')).ok,
    false,
  );
  assert.equal(parseMoneySettings({ value: Number.NaN }).ok, false);
  assert.equal(parseMoneySettings({ value: "x".repeat(20_000) }).ok, false);
});

test("settings align known target amounts with the persisted integer centimes", () => {
  assert.equal(parseMoneySettings({ savingsTargetMinor: 0 }).ok, true);
  assert.equal(parseMoneySettings({ emergencyTargetMinor: 2_147_483_647 }).ok, true);
  assert.equal(parseMoneySettings({ savingsTargetMinor: null, emergencyTargetMinor: null }).ok, true);
  for (const invalid of [-1, 1.5, "100", 2_147_483_648]) {
    const savings = parseMoneySettings({ savingsTargetMinor: invalid });
    const emergency = parseMoneySettings({ emergencyTargetMinor: invalid });
    assert.equal(savings.ok, false);
    assert.equal(emergency.ok, false);
    assert.match(!savings.ok ? savings.message : "", /whole non-negative/);
    assert.match(!emergency.ok ? emergency.message : "", /whole non-negative/);
  }
});

test("update requires a version and at least one change", () => {
  assert.equal(parseUpdateMoneySettingsInput({}).ok, false);
  assert.equal(parseUpdateMoneySettingsInput({ version: 1 }).ok, false);
  const parsed = parseUpdateMoneySettingsInput({
    version: 3,
    activeDate: "2026-11-10",
    settings: { dailyTargetMinor: 15_000 },
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.expectedVersion, 3);
    assert.equal(parsed.value.activeDate, "2026-11-10");
  }
});

test("period overlap and date classification use inclusive boundaries", () => {
  assert.equal(
    periodsOverlap(
      { startDate: "2026-11-01", endDate: "2026-11-30" },
      { startDate: "2026-11-30", endDate: "2026-12-15" },
    ),
    true,
  );
  assert.equal(
    periodsOverlap(
      { startDate: "2026-11-01", endDate: "2026-11-29" },
      { startDate: "2026-11-30", endDate: "2026-12-15" },
    ),
    false,
  );
  assert.equal(classifyDateInPeriod("2026-11-08", period()), "before_period");
  assert.equal(classifyDateInPeriod("2026-11-30", period()), "in_period");
  assert.equal(classifyDateInPeriod("2026-12-01", period()), "after_period");
});

test("only tracking periods accept routine entries", () => {
  assert.equal(periodAcceptsRoutineEntries(period()), true);
  assert.equal(periodAcceptsRoutineEntries(period({ lifecycle: "ended" })), false);
  assert.equal(
    periodAcceptsRoutineEntries(period({ lifecycle: "rolled_over" })),
    false,
  );
});

test("opening cutoff validation and canonical payloads are stable", () => {
  const opening = {
    amountMinor: 500,
    source: "verified_source" as const,
    cutoffDate: "2026-11-08",
    evidence: "bank statement 2026-11-08",
    note: null,
  };
  assert.equal(validateOpeningAgainstPeriod(opening, "2026-11-09"), null);
  assert.notEqual(validateOpeningAgainstPeriod(opening, "2026-11-07"), null);
  assert.equal(
    canonicalMoneyOpeningPayload(opening),
    JSON.stringify([500, "verified_source", "2026-11-08", "bank statement 2026-11-08", null]),
  );
  assert.equal(moneyTimezoneOrDefault(null), "Africa/Casablanca");
  assert.equal(moneyTimezoneOrDefault("UTC"), "UTC");
});

test("countsInDaily defaults true for expenses and false for the other kinds", () => {
  assert.equal(defaultCountsInDaily("expense"), true);
  assert.equal(defaultCountsInDaily("income"), false);
  assert.equal(defaultCountsInDaily("opening"), false);
  assert.equal(defaultCountsInDaily("savings_transfer"), false);
  assert.equal(defaultCountsInDaily("reconciliation_adjustment"), false);
});

test("income is a positive inflow with no invented expense fields", () => {
  const parsed = parseCreateMovementInput(INCOME);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {
    kind: "income",
    direction: "in",
    amountMinor: 20_000,
    category: null,
    note: "Salary",
    merchant: null,
    needVsWant: null,
    paymentMethod: null,
    purpose: null,
    countsInDaily: false,
    bookingDate: "2026-11-09",
    occurredAt: null,
    idempotencyKey: "income-1",
  });
});

test("a date-only booking keeps occurrence time unknown while a timestamp keeps its instant and day", () => {
  const dateOnly = parseCreateMovementInput(INCOME);
  assert.equal(dateOnly.ok, true);
  if (dateOnly.ok) assert.equal(dateOnly.value.occurredAt, null);

  const timestamped = parseCreateMovementInput({
    ...INCOME,
    occurredAt: "2026-11-09T23:30:00+01:00",
  });
  assert.equal(timestamped.ok, true);
  if (timestamped.ok) {
    assert.equal(timestamped.value.occurredAt, "2026-11-09T22:30:00.000Z");
    // The written local calendar day is preserved, not shifted to UTC.
    assert.equal(timestamped.value.bookingDate, "2026-11-09");
  }
});

test("an explicit booking date wins over the timestamp calendar day", () => {
  const parsed = parseCreateMovementInput({
    ...INCOME,
    occurredAt: "2026-11-09T23:30:00+01:00",
    bookingDate: "2026-11-10",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.bookingDate, "2026-11-10");
});

test("a booking day or timestamp is required", () => {
  expectCreateFailure({ ...INCOME, bookingDate: undefined }, "bookingDate");
});

test("a savings transfer leaves spendable cash as an outflow", () => {
  const parsed = parseCreateMovementInput({
    kind: "savings_transfer",
    amountMinor: 50_000,
    bookingDate: "2026-11-10",
    idempotencyKey: "save-1",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.direction, "out");
    assert.equal(parsed.value.countsInDaily, false);
    assert.equal(parsed.value.category, null);
  }
});

test("reconciliation adjustments require an explicit direction", () => {
  expectCreateFailure(
    {
      kind: "reconciliation_adjustment",
      amountMinor: 100,
      bookingDate: "2026-11-10",
      idempotencyKey: "adj-1",
    },
    "direction",
  );
  const parsed = parseCreateMovementInput({
    kind: "reconciliation_adjustment",
    direction: "out",
    amountMinor: 100,
    bookingDate: "2026-11-10",
    idempotencyKey: "adj-1",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.countsInDaily, false);
});

test("opening cash is not a manual movement (MONEY-03 owns the single opening row)", () => {
  expectCreateFailure(
    {
      kind: "opening",
      amountMinor: 50_000,
      bookingDate: "2026-11-01",
      idempotencyKey: "opening-1",
    },
    "kind",
  );
});

test("expenses keep their category and need/want, and defaults can be overridden explicitly", () => {
  const parsed = parseCreateMovementInput({
    kind: "expense",
    amountMinor: 1100,
    category: "coffee",
    needVsWant: "want",
    purpose: "emergency",
    countsInDaily: false,
    bookingDate: "2026-11-11",
    idempotencyKey: "coffee-11",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.category, "coffee");
    assert.equal(parsed.value.needVsWant, "want");
    assert.equal(parsed.value.purpose, "emergency");
    assert.equal(parsed.value.countsInDaily, false);
  }
});

test("non-expense movements reject fictional category, need/want and purpose", () => {
  expectCreateFailure({ ...INCOME, category: "coffee" }, "category");
  expectCreateFailure({ ...INCOME, needVsWant: "need" }, "needVsWant");
  expectCreateFailure({ ...INCOME, purpose: "fixed" }, "purpose");
});

test("movement parsing rejects unknown keys, bad amounts and a mismatched direction", () => {
  expectCreateFailure({ ...INCOME, ownerUserId: "someone" }, "ownerUserId");
  expectCreateFailure({ ...INCOME, amountMinor: 0 }, "amountMinor");
  expectCreateFailure({ ...INCOME, amountMinor: 10.5 }, "amountMinor");
  expectCreateFailure({ ...INCOME, direction: "out" }, "direction");
  expectCreateFailure({ ...INCOME, bookingDate: "2026-11-31" }, "bookingDate");
  expectCreateFailure({ ...INCOME, occurredAt: "2026-11-09" }, "occurredAt");
});

test("the create fingerprint binds every semantic field including the daily flag", () => {
  const base = parseCreateMovementInput(INCOME);
  assert.equal(base.ok, true);
  if (!base.ok) return;
  const fingerprint = canonicalMovementCreatePayload(base.value);
  assert.equal(fingerprint, canonicalMovementCreatePayload({ ...base.value }));
  assert.notEqual(
    fingerprint,
    canonicalMovementCreatePayload({ ...base.value, countsInDaily: true }),
  );
  assert.notEqual(
    fingerprint,
    canonicalMovementCreatePayload({ ...base.value, bookingDate: "2026-11-10" }),
  );
  assert.notEqual(
    fingerprint,
    canonicalMovementCreatePayload({ ...base.value, occurredAt: "2026-11-09T10:00:00.000Z" }),
  );
  assert.notEqual(
    fingerprint,
    canonicalMovementCreatePayload({ ...base.value, amountMinor: 20_001 }),
  );
});

test("update parsing keeps kind immutable and accepts explicit daily overrides", () => {
  const parsed = parseUpdateMovementInput({
    version: 2,
    amountMinor: 21_000,
    countsInDaily: true,
    occurredAt: null,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.countsInDaily, true);
  assert.equal(parsed.value.occurredAt, null);

  const kindChange = parseUpdateMovementInput({ version: 1, kind: "income" });
  assert.equal(kindChange.ok, false);
  if (!kindChange.ok) assert.equal(kindChange.field, "kind");

  const empty = parseUpdateMovementInput({ version: 1 });
  assert.equal(empty.ok, false);
});

test("list queries use inclusive booking dates, a cutoff, kind and bounded pagination", () => {
  const parsed = parseMoneyListQuery(
    {
      from: "2026-11-01",
      to: "2026-11-09",
      cutoff: "2026-11-09",
      kind: "income",
      limit: "10",
      offset: "5",
    },
    { timezone: "Africa/Casablanca" },
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {
    limit: 10,
    offset: 5,
    from: "2026-11-01",
    to: "2026-11-09",
    cutoff: "2026-11-09",
    timezone: "Africa/Casablanca",
    kind: "income",
  });

  const inverted = parseMoneyListQuery({ from: "2026-11-10", to: "2026-11-09" });
  assert.equal(inverted.ok, false);
  const beforeEnd = parseMoneyListQuery({ to: "2026-11-09", cutoff: "2026-11-08" });
  assert.equal(beforeEnd.ok, false);
  const badKind = parseMoneyListQuery({ kind: "transfer" });
  assert.equal(badKind.ok, false);
});

test("state queries accept an optional cutoff and validated timezone", () => {
  const parsed = parseMoneyStateQuery(
    { cutoff: "2026-11-11", timezone: "Africa/Casablanca" },
    { timezone: "UTC" },
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, {
      cutoff: "2026-11-11",
      timezone: "Africa/Casablanca",
    });
  }
  const invalid = parseMoneyStateQuery({ timezone: "Not/AZone" });
  assert.equal(invalid.ok, false);
});
