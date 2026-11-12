import assert from "node:assert/strict";
import test from "node:test";

import {
  OBLIGATION_PAYMENT_METHODS,
  parseObligationPaymentCorrectionInput,
  parseObligationPaymentInput,
  parseObligationUndoInput,
  resolveObligationPaymentCountsInDaily,
} from "../src/obligations";

/**
 * MONEY-07 payment input rules at the domain boundary: the payment always
 * settles the occurrence in full, the operation id is never part of the
 * parsed body, and the daily-inclusion default follows the obligation
 * purpose unless the payment states it explicitly.
 */

test("a payment input parses the expected version, date, key and overrides", () => {
  const parsed = parseObligationPaymentInput({
    version: 3,
    bookingDate: "2026-11-05",
    idempotencyKey: "obligation-payment:op-1",
    needVsWant: "want",
    countsInDaily: true,
    paymentMethod: "cash",
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.version, 3);
  assert.equal(parsed.value.bookingDate, "2026-11-05");
  assert.equal(parsed.value.idempotencyKey, "obligation-payment:op-1");
  assert.equal(parsed.value.needVsWant, "want");
  assert.equal(parsed.value.countsInDaily, true);
  assert.equal(parsed.value.paymentMethod, "cash");
});

test("a payment carries no amount: one occurrence is settled by one full payment", () => {
  const parsed = parseObligationPaymentInput({
    version: 1,
    bookingDate: "2026-11-05",
    idempotencyKey: "obligation-payment:op-1",
    amountMinor: 1000,
  });

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.field, "amountMinor");
});

test("the operation id is never parsed as part of the payment body", () => {
  const parsed = parseObligationPaymentInput({
    version: 1,
    bookingDate: "2026-11-05",
    idempotencyKey: "obligation-payment:op-1",
    operationId: "op-1",
  });

  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.field, "operationId");
});

test("a payment refuses an unknown need/want, method, date and version", () => {
  const needVsWant = parseObligationPaymentInput({
    version: 1,
    bookingDate: "2026-11-05",
    idempotencyKey: "key",
    needVsWant: "maybe",
  });
  assert.equal(needVsWant.ok, false);
  if (!needVsWant.ok) assert.equal(needVsWant.field, "needVsWant");

  const method = parseObligationPaymentInput({
    version: 1,
    bookingDate: "2026-11-05",
    idempotencyKey: "key",
    paymentMethod: "gold",
  });
  assert.equal(method.ok, false);
  if (!method.ok) assert.equal(method.field, "paymentMethod");

  const date = parseObligationPaymentInput({
    version: 1,
    bookingDate: "2026-02-30",
    idempotencyKey: "key",
  });
  assert.equal(date.ok, false);
  if (!date.ok) assert.equal(date.field, "bookingDate");

  const version = parseObligationPaymentInput({
    version: 0,
    bookingDate: "2026-11-05",
    idempotencyKey: "key",
  });
  assert.equal(version.ok, false);
  if (!version.ok) assert.equal(version.field, "version");
});

test("a correction parses the amount, date and daily flag", () => {
  const parsed = parseObligationPaymentCorrectionInput({
    version: 4,
    amountMinor: 355000,
    bookingDate: "2026-11-06",
    countsInDaily: false,
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.version, 4);
  assert.equal(parsed.value.amountMinor, 355000);
  assert.equal(parsed.value.bookingDate, "2026-11-06");
  assert.equal(parsed.value.countsInDaily, false);
});

test("a correction refuses a non-positive amount and an unknown field", () => {
  const amount = parseObligationPaymentCorrectionInput({
    version: 4,
    amountMinor: 0,
    bookingDate: "2026-11-06",
  });
  assert.equal(amount.ok, false);
  if (!amount.ok) assert.equal(amount.field, "amountMinor");

  const unknown = parseObligationPaymentCorrectionInput({
    version: 4,
    amountMinor: 100,
    bookingDate: "2026-11-06",
    operationId: "op-2",
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.field, "operationId");
});

test("an undo parses only the expected version", () => {
  const parsed = parseObligationUndoInput({ version: 5 });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.version, 5);

  const unknown = parseObligationUndoInput({ version: 5, reason: "x" });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.field, "reason");
});

test("a fixed payment excludes daily spending unless the payment says otherwise", () => {
  assert.equal(
    resolveObligationPaymentCountsInDaily({
      purpose: "fixed",
      occurrenceCountsInDaily: false,
    }),
    false,
  );
  assert.equal(
    resolveObligationPaymentCountsInDaily({
      purpose: "fixed",
      occurrenceCountsInDaily: true,
    }),
    false,
  );
  assert.equal(
    resolveObligationPaymentCountsInDaily({
      purpose: "fixed",
      occurrenceCountsInDaily: true,
      explicit: true,
    }),
    true,
  );
  assert.equal(
    resolveObligationPaymentCountsInDaily({
      purpose: "flexible",
      occurrenceCountsInDaily: true,
    }),
    true,
  );
  assert.equal(
    resolveObligationPaymentCountsInDaily({
      purpose: "flexible",
      occurrenceCountsInDaily: true,
      explicit: false,
    }),
    false,
  );
});

test("the supported payment methods are the ledger's own", () => {
  assert.deepEqual([...OBLIGATION_PAYMENT_METHODS], [
    "cash",
    "card",
    "bank_transfer",
    "mobile_wallet",
    "other",
  ]);
});
