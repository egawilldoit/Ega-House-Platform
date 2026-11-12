import assert from "node:assert/strict";
import test from "node:test";

import type { ObligationRepository } from "../src/money/obligation-ports";
import type {
  ObligationPaymentCorrectionRecordInput,
  ObligationPaymentOutcome,
  ObligationPaymentRecordInput,
  ObligationPaymentRepository,
  ObligationPaymentUndoRecordInput,
} from "../src/money/obligation-payment-ports";
import {
  correctObligationPayment,
  payObligation,
  undoObligationPayment,
} from "../src/money/obligation-payments";
import { createAuthenticatedActor } from "../src/auth/actor";
import type { ObligationOccurrence } from "@ega/domain/obligations";

/**
 * MONEY-07 application use cases at the boundary that matters: the owner comes
 * from the verified actor, the operation id is carried beside the parsed
 * payload, an unknown need/want is requested instead of invented, and a
 * refused write never claims that cash moved.
 */

const ACTOR = createAuthenticatedActor("owner-1");
const OCCURRENCE_ID = "22222222-2222-4222-8222-222222222222";

function occurrence(
  overrides: Partial<ObligationOccurrence> = {},
): ObligationOccurrence {
  return {
    id: OCCURRENCE_ID,
    kind: "bill",
    description: "Rent",
    amountMinor: 350000,
    currency: "MAD",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    dueDate: "2026-11-05",
    needVsWant: null,
    purpose: "fixed",
    countsInDaily: false,
    category: "bills",
    state: "pending",
    stateEffectiveDate: "2026-11-01",
    stateReason: null,
    paymentExpenseId: null,
    paymentEvidence: null,
    templateId: null,
    idempotencyKey: "occurrence-1",
    version: 1,
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
    ...overrides,
  };
}

type FakePayments = {
  calls: string[];
  payInput: ObligationPaymentRecordInput | null;
  correctInput: ObligationPaymentCorrectionRecordInput | null;
  undoInput: ObligationPaymentUndoRecordInput | null;
  result: { ok: true; value: ObligationPaymentOutcome } | { ok: false; error: { code: "conflict" | "notFound" | "forbidden" | "validation" | "unknown" } };
};

function fakePayments(result: FakePayments["result"]): {
  payments: ObligationPaymentRepository;
  state: FakePayments;
} {
  const state: FakePayments = {
    calls: [],
    payInput: null,
    correctInput: null,
    undoInput: null,
    result,
  };
  const payments: ObligationPaymentRepository = {
    async pay(_actor, input) {
      state.calls.push(`pay:${input.operationId}`);
      state.payInput = input;
      return state.result;
    },
    async correct(_actor, input) {
      state.calls.push(`correct:${input.operationId}`);
      state.correctInput = input;
      return state.result;
    },
    async undo(_actor, input) {
      state.calls.push(`undo:${input.operationId}`);
      state.undoInput = input;
      return state.result;
    },
  };
  return { payments, state };
}

function fakeObligations(row: ObligationOccurrence | null): ObligationRepository {
  return {
    async findByIdempotencyKey() {
      return { ok: true, value: null };
    },
    async create() {
      throw new Error("not used");
    },
    async get(_actor, id) {
      return { ok: true, value: row && row.id === id ? row : null };
    },
    async list() {
      return { ok: true, value: row ? [row] : [] };
    },
    async update() {
      throw new Error("not used");
    },
    async transition() {
      throw new Error("not used");
    },
    async findTemplateByIdempotencyKey() {
      return { ok: true, value: null };
    },
    async createTemplate() {
      throw new Error("not used");
    },
    async getTemplate() {
      return { ok: true, value: null };
    },
    async listTemplates() {
      return { ok: true, value: [] };
    },
    async updateTemplate() {
      throw new Error("not used");
    },
  };
}

const PAYMENT_OUTCOME: ObligationPaymentOutcome = {
  occurrence: occurrence({
    state: "paid",
    version: 2,
    paymentExpenseId: "33333333-3333-4333-8333-333333333333",
  }),
  payment: {
    expenseId: "33333333-3333-4333-8333-333333333333",
    amountMinor: 350000,
    currency: "MAD",
    bookingDate: "2026-11-05",
    countsInDaily: false,
    needVsWant: "need",
    paymentMethod: "cash",
    purpose: "fixed",
    category: "bills",
  },
  replayed: false,
};

test("paying resolves the classification and carries the operation id beside the payload", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  const result = await payObligation(
    ACTOR,
    {
      obligations: fakeObligations(occurrence({ needVsWant: "need" })),
      payments,
    },
    OCCURRENCE_ID,
    {
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
    },
    { operationId: "op-1" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(state.calls, ["pay:op-1"]);
  assert.equal(state.payInput?.occurrenceId, OCCURRENCE_ID);
  assert.equal(state.payInput?.needVsWant, "need");
  assert.equal(state.payInput?.countsInDaily, false);
  assert.equal(state.payInput?.paymentMethod, null);
  assert.equal(state.payInput?.operationId, "op-1");
});

test("an explicit payment override wins over the occurrence snapshot", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  await payObligation(
    ACTOR,
    {
      obligations: fakeObligations(occurrence({ needVsWant: "need" })),
      payments,
    },
    OCCURRENCE_ID,
    {
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
      needVsWant: "want",
      countsInDaily: true,
      paymentMethod: "card",
    },
    { operationId: "op-1" },
  );

  assert.equal(state.payInput?.needVsWant, "want");
  assert.equal(state.payInput?.countsInDaily, true);
  assert.equal(state.payInput?.paymentMethod, "card");
});

test("an unknown need/want is requested, never invented", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  const result = await payObligation(
    ACTOR,
    { obligations: fakeObligations(occurrence()), payments },
    OCCURRENCE_ID,
    {
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
    },
    { operationId: "op-1" },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "validation");
  assert.equal(result.reason, "need_vs_want_required");
  assert.deepEqual(state.calls, []);
});

test("a stale version never reaches persistence", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  const result = await payObligation(
    ACTOR,
    { obligations: fakeObligations(occurrence({ needVsWant: "need" })), payments },
    OCCURRENCE_ID,
    {
      version: 7,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
    },
    { operationId: "op-1" },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "conflict");
  assert.deepEqual(state.calls, []);
});

test("a waived obligation cannot be paid", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  const result = await payObligation(
    ACTOR,
    {
      obligations: fakeObligations(occurrence({ state: "waived", needVsWant: "need" })),
      payments,
    },
    OCCURRENCE_ID,
    {
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
    },
    { operationId: "op-1" },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "conflict");
  assert.deepEqual(state.calls, []);
});

test("a different operation cannot pay an already-paid occurrence", async () => {
  const { payments } = fakePayments({
    ok: false,
    error: { code: "conflict" },
  });
  const result = await payObligation(
    ACTOR,
    {
      obligations: fakeObligations(
        occurrence({ state: "paid", needVsWant: "need", version: 2 }),
      ),
      payments,
    },
    OCCURRENCE_ID,
    {
      version: 2,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-2",
    },
    { operationId: "op-2" },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "conflict");
    assert.equal(result.errorMessage, "This obligation is already paid.");
  }
});

test("a missing obligation is reported as not found", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  const result = await payObligation(
    ACTOR,
    { obligations: fakeObligations(null), payments },
    OCCURRENCE_ID,
    {
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
    },
    { operationId: "op-1" },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "notFound");
  assert.deepEqual(state.calls, []);
});

test("correcting moves the linked payment and the occurrence together", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  const result = await correctObligationPayment(
    ACTOR,
    {
      obligations: fakeObligations(
        occurrence({
          state: "paid",
          version: 2,
          needVsWant: "need",
          paymentExpenseId: "33333333-3333-4333-8333-333333333333",
        }),
      ),
      payments,
    },
    OCCURRENCE_ID,
    {
      version: 2,
      amountMinor: 355000,
      bookingDate: "2026-11-06",
      countsInDaily: false,
    },
    { operationId: "op-2" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(state.calls, ["correct:op-2"]);
  assert.equal(state.correctInput?.occurrenceId, OCCURRENCE_ID);
  assert.equal(state.correctInput?.amountMinor, 355000);
  assert.equal(state.correctInput?.bookingDate, "2026-11-06");
  assert.equal(state.correctInput?.countsInDaily, false);
});

test("correcting an unpaid obligation reports the conflict", async () => {
  const { payments, state } = fakePayments({
    ok: false,
    error: { code: "conflict" },
  });
  const result = await correctObligationPayment(
    ACTOR,
    { obligations: fakeObligations(occurrence()), payments },
    OCCURRENCE_ID,
    { version: 1, amountMinor: 355000, bookingDate: "2026-11-06" },
    { operationId: "op-2" },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "conflict");
    assert.equal(result.errorMessage, "Only a paid obligation can be corrected.");
  }
  assert.deepEqual(state.calls, ["correct:op-2"]);
});

test("undoing removes the payment and reopens the occurrence", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  const result = await undoObligationPayment(
    ACTOR,
    {
      obligations: fakeObligations(
        occurrence({
          state: "paid",
          version: 2,
          paymentExpenseId: "33333333-3333-4333-8333-333333333333",
        }),
      ),
      payments,
    },
    OCCURRENCE_ID,
    { version: 2 },
    { operationId: "op-3" },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(state.calls, ["undo:op-3"]);
  assert.equal(state.undoInput?.occurrenceId, OCCURRENCE_ID);
  assert.equal(state.undoInput?.expectedVersion, 2);
});

test("undoing an unpaid obligation reports the conflict", async () => {
  const { payments } = fakePayments({ ok: false, error: { code: "conflict" } });
  const result = await undoObligationPayment(
    ACTOR,
    { obligations: fakeObligations(occurrence()), payments },
    OCCURRENCE_ID,
    { version: 1 },
    { operationId: "op-3" },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "conflict");
    assert.equal(result.errorMessage, "Only a paid obligation can be undone.");
  }
});

test("a refused database input is reported as a validation failure", async () => {
  const { payments } = fakePayments({ ok: false, error: { code: "validation" } });
  const result = await payObligation(
    ACTOR,
    { obligations: fakeObligations(occurrence({ needVsWant: "need" })), payments },
    OCCURRENCE_ID,
    {
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
    },
    { operationId: "op-1" },
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "validation");
    assert.equal(result.errorMessage, "That payment request was refused.");
  }
});

test("an unknown operation id is refused before persistence", async () => {
  const { payments, state } = fakePayments({ ok: true, value: PAYMENT_OUTCOME });
  const result = await payObligation(
    ACTOR,
    { obligations: fakeObligations(occurrence({ needVsWant: "need" })), payments },
    OCCURRENCE_ID,
    {
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
    },
    { operationId: "  " },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "validation");
  assert.deepEqual(state.calls, []);
});
