import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_KINDS,
  MONEY_PERIOD_INITIALIZATIONS,
  MONEY_PERIOD_LIFECYCLES,
  MONEY_DEFAULT_TIMEZONE,
  canonicalMoneyOpeningPayload,
  classifyDateInPeriod,
  isMoneyAmountMinor,
  moneyTimezoneOrDefault,
  parseCreateMoneyPeriodInput,
  parseMoneySettings,
  parseUpdateMoneySettingsInput,
  periodAcceptsRoutineEntries,
  periodsOverlap,
  validateOpeningAgainstPeriod,
  type MoneyPeriod,
} from "../src/money";

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

test("the shared movement vocabulary is frozen exactly as the contract requires", () => {
  assert.deepEqual(MONEY_KINDS, [
    "expense",
    "income",
    "opening",
    "savings_transfer",
    "reconciliation_adjustment",
  ]);
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
