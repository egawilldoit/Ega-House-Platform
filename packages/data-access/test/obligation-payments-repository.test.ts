import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticatedActor } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseObligationPaymentRepository } from "../src/money/obligation-payments-repository";

/**
 * MONEY-07 payment adapter: one RPC per write, no owner id on the wire (the
 * database derives it), the stored occurrence and payment mapped onto the
 * canonical shapes, and the small failure vocabulary preserved.
 */

const ACTOR = createAuthenticatedActor("owner-payments");
const OCCURRENCE_ID = "22222222-2222-4222-8222-222222222222";

type RpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

type RpcCall = { name: string; args: Record<string, unknown> };

class FakeSupabase {
  readonly calls: RpcCall[] = [];
  constructor(private readonly queue: RpcResult[]) {}

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return this.queue.shift() ?? { data: null, error: null };
  }
}

function repository(fake: FakeSupabase) {
  return new SupabaseObligationPaymentRepository(
    fake as unknown as SupabaseClient,
  );
}

const OCCURRENCE_ROW = {
  id: OCCURRENCE_ID,
  template_id: null,
  kind: "bill",
  description: "Rent",
  amount_minor: 350000,
  currency: "MAD",
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  due_date: "2026-11-05",
  need_vs_want: null,
  purpose: "fixed",
  counts_in_daily: false,
  category: "bills",
  state: "paid",
  state_effective_date: "2026-11-05",
  state_reason: "payment recorded",
  state_history: [],
  payment_expense_id: "33333333-3333-4333-8333-333333333333",
  payment_evidence: null,
  idempotency_key: "occurrence-1",
  version: 2,
  created_at: "2026-11-01T09:00:00+00:00",
  updated_at: "2026-11-05T09:00:00+00:00",
};

const PAYMENT_OBJECT = {
  expense_id: "33333333-3333-4333-8333-333333333333",
  amount_minor: 350000,
  currency: "MAD",
  booking_date: "2026-11-05",
  counts_in_daily: false,
  need_vs_want: "need",
  payment_method: "cash",
  purpose: "fixed",
  category: "bills",
};

test("pay calls the atomic RPC without sending an owner id", async () => {
  const fake = new FakeSupabase([
    {
      data: { outcome: "paid", occurrence: OCCURRENCE_ROW, payment: PAYMENT_OBJECT },
      error: null,
    },
  ]);
  const result = await repository(fake).pay(ACTOR, {
    occurrenceId: OCCURRENCE_ID,
    expectedVersion: 1,
    bookingDate: "2026-11-05",
    idempotencyKey: "obligation-payment:op-1",
    needVsWant: "need",
    countsInDaily: false,
    paymentMethod: "cash",
    operationId: "op-1",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.occurrence.state, "paid");
  assert.equal(result.value.occurrence.paymentExpenseId, "33333333-3333-4333-8333-333333333333");
  assert.equal(result.value.payment?.amountMinor, 350000);
  assert.equal(result.value.payment?.bookingDate, "2026-11-05");
  assert.equal(result.value.payment?.needVsWant, "need");
  assert.equal(result.value.replayed, false);

  const call = fake.calls[0];
  assert.equal(call?.name, "money_pay_obligation");
  assert.equal(call?.args.p_occurrence_id, OCCURRENCE_ID);
  assert.equal(call?.args.p_expected_version, 1);
  assert.equal(call?.args.p_operation_id, "op-1");
  assert.equal(call?.args.p_need_vs_want, "need");
  assert.equal(call?.args.owner_user_id, undefined);
  assert.equal(call?.args.p_owner_user_id, undefined);
});

test("a replayed operation is reported as replayed", async () => {
  const fake = new FakeSupabase([
    {
      data: {
        outcome: "replayed",
        occurrence: OCCURRENCE_ROW,
        payment: PAYMENT_OBJECT,
      },
      error: null,
    },
  ]);
  const result = await repository(fake).undo(ACTOR, {
    occurrenceId: OCCURRENCE_ID,
    expectedVersion: 2,
    operationId: "op-3",
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.replayed, true);
  assert.equal(fake.calls[0]?.name, "money_undo_obligation_payment");
});

test("the correction RPC carries the corrected amount, date and daily flag", async () => {
  const fake = new FakeSupabase([
    {
      data: {
        outcome: "corrected",
        occurrence: { ...OCCURRENCE_ROW, amount_minor: 355000, version: 3 },
        payment: { ...PAYMENT_OBJECT, amount_minor: 355000, booking_date: "2026-11-06" },
      },
      error: null,
    },
  ]);
  const result = await repository(fake).correct(ACTOR, {
    occurrenceId: OCCURRENCE_ID,
    expectedVersion: 2,
    amountMinor: 355000,
    bookingDate: "2026-11-06",
    countsInDaily: false,
    operationId: "op-2",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.occurrence.amountMinor, 355000);
    assert.equal(result.value.payment?.amountMinor, 355000);
    assert.equal(result.value.payment?.bookingDate, "2026-11-06");
  }
  const call = fake.calls[0];
  assert.equal(call?.name, "money_correct_obligation_payment");
  assert.equal(call?.args.p_amount_minor, 355000);
  assert.equal(call?.args.p_booking_date, "2026-11-06");
  assert.equal(call?.args.p_counts_in_daily, false);
});

test("database refusals keep the small failure vocabulary", async () => {
  const cases: Array<[string, { code?: string } | null, string]> = [
    ["P0002", { code: "P0002" }, "notFound"],
    ["42501", { code: "42501" }, "forbidden"],
    ["22023", { code: "22023" }, "validation"],
    ["23514", { code: "23514" }, "conflict"],
    ["23505", { code: "23505" }, "conflict"],
    ["40P01", { code: "40P01" }, "conflict"],
    ["unknown", { code: "XX000" }, "unknown"],
  ];

  for (const [label, error, expected] of cases) {
    const result = await repository(
      new FakeSupabase([{ data: null, error }]),
    ).pay(ACTOR, {
      occurrenceId: OCCURRENCE_ID,
      expectedVersion: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
      needVsWant: "need",
      countsInDaily: false,
      paymentMethod: null,
      operationId: "op-1",
    });
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.equal(result.error.code, expected, label);
  }
});

test("a malformed RPC result is an unknown failure, never a fake success", async () => {
  const result = await repository(
    new FakeSupabase([{ data: { outcome: "paid" }, error: null }]),
  ).pay(ACTOR, {
    occurrenceId: OCCURRENCE_ID,
    expectedVersion: 1,
    bookingDate: "2026-11-05",
    idempotencyKey: "obligation-payment:op-1",
    needVsWant: "need",
    countsInDaily: false,
    paymentMethod: null,
    operationId: "op-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "unknown");
});
