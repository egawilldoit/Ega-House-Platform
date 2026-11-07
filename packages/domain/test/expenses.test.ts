import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPENSE_AMOUNT_MINOR_MAX,
  EXPENSE_CATEGORY_VALUES,
  EXPENSE_CURRENCY,
  EXPENSE_NEED_VS_WANT_VALUES,
  EXPENSE_PAYMENT_METHOD_VALUES,
  expenseMatchesCreateValues,
  isExpenseId,
  parseCreateExpenseInput,
  parseExpenseListQuery,
  parseUpdateExpenseInput,
  type PersonalExpense,
} from "../src/expenses";

const VALID_CREATE = {
  occurredAt: "2026-11-07T09:30:00+01:00",
  amountMinor: 2250,
  category: "coffee",
  note: "  morning coffee  ",
  merchant: "  Cafe Atlas ",
  needVsWant: "want",
  paymentMethod: "card",
  idempotencyKey: "  key-1 ",
};

function expectCreateFailure(input: unknown, field: string) {
  const parsed = parseCreateExpenseInput(input);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.field, field);
}

test("the fixed categories, need-vs-want and payment methods match PO-08", () => {
  assert.deepEqual(EXPENSE_CATEGORY_VALUES, [
    "coffee",
    "groceries",
    "eating_out",
    "transport",
    "bills",
    "subscriptions",
    "household",
    "health",
    "other",
  ]);
  assert.deepEqual(EXPENSE_NEED_VS_WANT_VALUES, ["need", "want"]);
  assert.deepEqual(EXPENSE_PAYMENT_METHOD_VALUES, [
    "cash",
    "card",
    "bank_transfer",
    "mobile_wallet",
    "other",
  ]);
  assert.equal(EXPENSE_CURRENCY, "MAD");
  assert.equal(EXPENSE_AMOUNT_MINOR_MAX, 2147483647);
});

test("create normalizes centimes, trims metadata and canonicalizes the instant", () => {
  const parsed = parseCreateExpenseInput(VALID_CREATE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {
    occurredAt: "2026-11-07T08:30:00.000Z",
    amountMinor: 2250,
    category: "coffee",
    note: "morning coffee",
    merchant: "Cafe Atlas",
    needVsWant: "want",
    paymentMethod: "card",
    idempotencyKey: "key-1",
  });
});

test("create accepts the int4 maximum and clears optional blanks", () => {
  const parsed = parseCreateExpenseInput({
    ...VALID_CREATE,
    amountMinor: EXPENSE_AMOUNT_MINOR_MAX,
    note: "   ",
    merchant: "",
    paymentMethod: undefined,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.amountMinor, EXPENSE_AMOUNT_MINOR_MAX);
  assert.equal(parsed.value.note, null);
  assert.equal(parsed.value.merchant, null);
  assert.equal(parsed.value.paymentMethod, null);
});

test("create rejects unknown keys including caller identity and currency", () => {
  for (const key of ["ownerUserId", "owner_user_id", "userId", "user_id", "currency", "version", "deletedAt"]) {
    expectCreateFailure({ ...VALID_CREATE, [key]: "attacker" }, key);
  }
});

test("create rejects zero, negative, fractional, string and overflowing amounts", () => {
  for (const amount of [0, -1, 22.5, "2250", Number.NaN, Number.POSITIVE_INFINITY]) {
    expectCreateFailure({ ...VALID_CREATE, amountMinor: amount }, "amountMinor");
  }
  expectCreateFailure(
    { ...VALID_CREATE, amountMinor: EXPENSE_AMOUNT_MINOR_MAX + 1 },
    "amountMinor",
  );
});

test("create rejects invalid dates, enums and oversized metadata", () => {
  expectCreateFailure({ ...VALID_CREATE, occurredAt: "2026-11-07" }, "occurredAt");
  expectCreateFailure({ ...VALID_CREATE, occurredAt: "not-a-date" }, "occurredAt");
  expectCreateFailure({ ...VALID_CREATE, occurredAt: 123 }, "occurredAt");
  expectCreateFailure({ ...VALID_CREATE, category: "rent" }, "category");
  expectCreateFailure({ ...VALID_CREATE, needVsWant: "maybe" }, "needVsWant");
  expectCreateFailure({ ...VALID_CREATE, paymentMethod: "cheque" }, "paymentMethod");
  expectCreateFailure({ ...VALID_CREATE, note: "x".repeat(501) }, "note");
  expectCreateFailure({ ...VALID_CREATE, merchant: "x".repeat(121) }, "merchant");
  expectCreateFailure(
    { ...VALID_CREATE, idempotencyKey: "x".repeat(129) },
    "idempotencyKey",
  );
  expectCreateFailure({ ...VALID_CREATE, idempotencyKey: "   " }, "idempotencyKey");
  expectCreateFailure({ ...VALID_CREATE, idempotencyKey: undefined }, "idempotencyKey");
});

test("update requires a positive integer expected version", () => {
  for (const version of [undefined, 0, -1, 1.5, "1", Number.NaN]) {
    const parsed = parseUpdateExpenseInput({ amountMinor: 100, version });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.field, "version");
  }
});

test("update validates only submitted fields and can clear metadata", () => {
  const parsed = parseUpdateExpenseInput({
    version: 3,
    amountMinor: 1990,
    note: null,
    merchant: "  ",
    paymentMethod: null,
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {
    expectedVersion: 3,
    amountMinor: 1990,
    note: null,
    merchant: null,
    paymentMethod: null,
  });
});

test("update rejects unknown keys, invalid amounts and an empty change set", () => {
  const unknown = parseUpdateExpenseInput({ version: 1, ownerUserId: "x" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.field, "ownerUserId");

  const invalidAmount = parseUpdateExpenseInput({ version: 1, amountMinor: 22.5 });
  assert.equal(invalidAmount.ok, false);
  if (!invalidAmount.ok) assert.equal(invalidAmount.field, "amountMinor");

  const empty = parseUpdateExpenseInput({ version: 1 });
  assert.equal(empty.ok, false);
});

test("list defaults to 50 rows, offset 0 and no window", () => {
  const parsed = parseExpenseListQuery({});
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.limit, 50);
  assert.equal(parsed.value.offset, 0);
  assert.equal(parsed.value.startUtcIso, null);
  assert.equal(parsed.value.endUtcExclusiveIso, null);
});

test("list bounds limit and offset", () => {
  for (const [query, field] of [
    [{ limit: "0" }, "limit"],
    [{ limit: "101" }, "limit"],
    [{ limit: "1.5" }, "limit"],
    [{ limit: "abc" }, "limit"],
    [{ offset: "-1" }, "offset"],
    [{ offset: "999999999" }, "offset"],
  ] as const) {
    const parsed = parseExpenseListQuery(query);
    assert.equal(parsed.ok, false, JSON.stringify(query));
    if (!parsed.ok) assert.equal(parsed.field, field);
  }
});

test("list resolves inclusive local dates to a half-open UTC window", () => {
  // Asia/Tokyo has no DST, so this exact multi-day window is tzdata-stable;
  // the separate America/New_York test below covers a DST transition.
  const parsed = parseExpenseListQuery(
    { from: "2026-11-01", to: "2026-11-07", timezone: "Asia/Tokyo", limit: "10" },
    {},
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.startUtcIso, "2026-10-31T15:00:00.000Z");
  assert.equal(parsed.value.endUtcExclusiveIso, "2026-11-07T15:00:00.000Z");
  assert.equal(parsed.value.limit, 10);
});

test("list uses the DST-aware local day boundaries", () => {
  const parsed = parseExpenseListQuery(
    { from: "2026-03-08", to: "2026-03-08", timezone: "America/New_York" },
    {},
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.startUtcIso, "2026-03-08T05:00:00.000Z");
  assert.equal(parsed.value.endUtcExclusiveIso, "2026-03-09T04:00:00.000Z");
});

test("list resolves the owner timezone supplied by the application layer", () => {
  const parsed = parseExpenseListQuery(
    { from: "2026-03-08", to: "2026-03-08" },
    { timezone: "America/New_York" },
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.timezone, "America/New_York");
  assert.equal(parsed.value.startUtcIso, "2026-03-08T05:00:00.000Z");
});

test("list requires a timezone when a local window is requested", () => {
  const parsed = parseExpenseListQuery({ from: "2026-11-01" });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.field, "timezone");
});

test("list supports one-sided windows and rejects bad ranges", () => {
  const fromOnly = parseExpenseListQuery(
    { from: "2026-11-01", timezone: "UTC" },
    {},
  );
  assert.equal(fromOnly.ok, true);
  if (fromOnly.ok) {
    assert.equal(fromOnly.value.startUtcIso, "2026-11-01T00:00:00.000Z");
    assert.equal(fromOnly.value.endUtcExclusiveIso, null);
  }

  const reversed = parseExpenseListQuery(
    { from: "2026-11-07", to: "2026-11-01", timezone: "UTC" },
    {},
  );
  assert.equal(reversed.ok, false);

  const tooLong = parseExpenseListQuery(
    { from: "2025-01-01", to: "2026-01-02", timezone: "UTC" },
    {},
  );
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.field, "to");
});

test("list rejects unknown query keys and invalid timezones", () => {
  const unknown = parseExpenseListQuery({ ownerUserId: "x" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.field, "ownerUserId");

  const timezone = parseExpenseListQuery(
    { from: "2026-11-01", timezone: "Mars/Olympus" },
    {},
  );
  assert.equal(timezone.ok, false);
  if (!timezone.ok) assert.equal(timezone.field, "timezone");
});

test("idempotent replay compares canonical values and instants", () => {
  const parsed = parseCreateExpenseInput(VALID_CREATE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const record: PersonalExpense = {
    id: "00000000-0000-4000-8000-000000000001",
    occurredAt: "2026-11-07T08:30:00+00:00",
    amountMinor: 2250,
    currency: "MAD",
    category: "coffee",
    note: "morning coffee",
    merchant: "Cafe Atlas",
    needVsWant: "want",
    paymentMethod: "card",
    idempotencyKey: "key-1",
    version: 1,
    deletedAt: null,
    createdAt: "2026-11-07T08:31:00+00:00",
    updatedAt: "2026-11-07T08:31:00+00:00",
  };

  assert.equal(expenseMatchesCreateValues(record, parsed.value), true);
  assert.equal(
    expenseMatchesCreateValues({ ...record, amountMinor: 2251 }, parsed.value),
    false,
  );
  assert.equal(
    expenseMatchesCreateValues({ ...record, note: "different" }, parsed.value),
    false,
  );
});

test("expense ids must be UUID-shaped", () => {
  assert.equal(isExpenseId("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(isExpenseId("not-a-uuid"), false);
  assert.equal(isExpenseId(undefined), false);
});
