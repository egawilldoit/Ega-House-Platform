import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_DIRECTIONS,
  MONEY_KINDS,
  MONEY_PURPOSES,
  canonicalMovementCreatePayload,
  defaultCountsInDaily,
  parseCreateMovementInput,
  parseMoneyListQuery,
  parseMoneyStateQuery,
  parseUpdateMovementInput,
} from "../src/money";

const INCOME = {
  kind: "income",
  amountMinor: 20_000,
  bookingDate: "2026-11-09",
  note: "  Salary  ",
  idempotencyKey: " income-1 ",
};

function expectCreateFailure(input: unknown, field: string) {
  const parsed = parseCreateMovementInput(input);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.field, field);
}

test("the frozen money kinds, directions and purposes are stable", () => {
  assert.deepEqual(MONEY_KINDS, [
    "expense",
    "income",
    "opening",
    "savings_transfer",
    "reconciliation_adjustment",
  ]);
  assert.deepEqual(MONEY_DIRECTIONS, ["in", "out"]);
  assert.deepEqual(MONEY_PURPOSES, ["fixed", "flexible", "emergency"]);
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
