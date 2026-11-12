import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApp } from "../src/index";

/**
 * MONEY-07 payment routes at the transport boundary: the operation id is
 * carried beside the semantic payload, the owner comes from the verified
 * bearer token, and a refused write never answers with a success shape.
 */

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
};
type Step = { method: string; args: unknown[] };
type RpcCall = { name: string; args: Record<string, unknown> };

class FakeSupabase {
  private readonly queues = new Map<string, QueryResult[]>();
  private readonly rpcQueue: QueryResult[] = [];
  calls: Array<{ table: string; steps: Step[] }> = [];
  rpcCalls: RpcCall[] = [];

  from(table: string) {
    return new FakeBuilder(table, this);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    return this.rpcQueue.shift() ?? { data: null, error: null };
  }

  push(table: string, result: QueryResult) {
    const queue = this.queues.get(table) ?? [];
    queue.push(result);
    this.queues.set(table, queue);
  }

  pushRpc(result: QueryResult) {
    this.rpcQueue.push(result);
  }

  pop(table: string): QueryResult {
    return this.queues.get(table)?.shift() ?? { data: null, error: null };
  }
}

class FakeBuilder {
  private readonly steps: Step[] = [];

  constructor(
    private readonly table: string,
    private readonly fake: FakeSupabase,
  ) {}

  select(...args: unknown[]) {
    this.steps.push({ method: "select", args });
    return this;
  }
  eq(...args: unknown[]) {
    this.steps.push({ method: "eq", args });
    return this;
  }
  gte(...args: unknown[]) {
    this.steps.push({ method: "gte", args });
    return this;
  }
  lte(...args: unknown[]) {
    this.steps.push({ method: "lte", args });
    return this;
  }
  order(...args: unknown[]) {
    this.steps.push({ method: "order", args });
    return this;
  }
  range(...args: unknown[]) {
    this.steps.push({ method: "range", args });
    return this;
  }
  insert(...args: unknown[]) {
    this.steps.push({ method: "insert", args });
    return this;
  }
  update(...args: unknown[]) {
    this.steps.push({ method: "update", args });
    return this;
  }
  maybeSingle(...args: unknown[]) {
    return this.terminal("maybeSingle", args);
  }
  single(...args: unknown[]) {
    return this.terminal("single", args);
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.terminal("await", []).then(fulfilled, rejected);
  }
  private terminal(method: string, args: unknown[]) {
    this.steps.push({ method, args });
    this.fake.calls.push({ table: this.table, steps: [...this.steps] });
    return Promise.resolve(this.fake.pop(this.table));
  }
}

const AUTH = { authorization: "Bearer money-token" };
const OCCURRENCE_ID = "22222222-2222-4222-8222-222222222222";
const PAYMENT_ID = "33333333-3333-4333-8333-333333333333";

function occurrenceRow(overrides: Record<string, unknown> = {}) {
  return {
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
    state: "pending",
    state_effective_date: "2026-11-01",
    state_reason: null,
    state_history: [],
    payment_expense_id: null,
    payment_evidence: null,
    idempotency_key: "occurrence-1",
    create_fingerprint: "0".repeat(64),
    version: 1,
    created_at: "2026-11-01T09:00:00+00:00",
    updated_at: "2026-11-01T09:00:00+00:00",
    ...overrides,
  };
}

function paidOccurrenceRow() {
  return occurrenceRow({
    state: "paid",
    version: 2,
    state_effective_date: "2026-11-05",
    state_reason: "payment recorded",
    payment_expense_id: PAYMENT_ID,
  });
}

const PAYMENT_OBJECT = {
  expense_id: PAYMENT_ID,
  amount_minor: 350000,
  currency: "MAD",
  booking_date: "2026-11-05",
  counts_in_daily: false,
  need_vs_want: "need",
  payment_method: "cash",
  purpose: "fixed",
  category: "bills",
};

function makeApp(fake: FakeSupabase) {
  return createApp({
    verifyToken: async (token) => (token === "money-token" ? "user-123" : null),
    createRequestClient: () => fake as unknown as SupabaseClient,
    now: () => new Date("2026-11-11T12:00:00.000Z"),
  });
}

test("the payment routes require a verified bearer token", async () => {
  const app = makeApp(new FakeSupabase());
  for (const path of [
    `/api/money/obligations/${OCCURRENCE_ID}/payment`,
    `/api/money/obligations/${OCCURRENCE_ID}/payment/correction`,
    `/api/money/obligations/${OCCURRENCE_ID}/payment/undo`,
  ]) {
    const res = await app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 401, path);
    assert.equal((await res.json()).error.code, "UNAUTHENTICATED");
  }
});

test("POST /payment records one payment and answers with the stored ids", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: occurrenceRow(), error: null });
  fake.pushRpc({
    data: { outcome: "paid", occurrence: paidOccurrenceRow(), payment: PAYMENT_OBJECT },
    error: null,
  });

  const res = await makeApp(fake).request(`/api/money/obligations/${OCCURRENCE_ID}/payment`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
      needVsWant: "need",
      operationId: "op-1",
    }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.replayed, false);
  assert.equal(body.obligation.state, "paid");
  assert.equal(body.obligation.paymentExpenseId, PAYMENT_ID);
  assert.equal(body.payment.amountMinor, 350000);
  assert.equal(body.payment.bookingDate, "2026-11-05");

  const rpc = fake.rpcCalls[0];
  assert.equal(rpc?.name, "money_pay_obligation");
  assert.equal(rpc?.args.p_occurrence_id, OCCURRENCE_ID);
  assert.equal(rpc?.args.p_expected_version, 1);
  assert.equal(rpc?.args.p_need_vs_want, "need");
  assert.equal(rpc?.args.p_operation_id, "op-1");
  assert.equal(rpc?.args.owner_user_id, undefined);
});

test("POST /payment replays the same operation with 200", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: paidOccurrenceRow(), error: null });
  fake.pushRpc({
    data: {
      outcome: "replayed",
      occurrence: paidOccurrenceRow(),
      payment: PAYMENT_OBJECT,
    },
    error: null,
  });

  const res = await makeApp(fake).request(`/api/money/obligations/${OCCURRENCE_ID}/payment`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
      needVsWant: "need",
      operationId: "op-1",
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.replayed, true);
});

test("POST /payment answers 400 without need/want and 409 for a settled obligation", async () => {
  const missingNeed = new FakeSupabase();
  missingNeed.push("money_obligations", { data: occurrenceRow(), error: null });
  const validation = await makeApp(missingNeed).request(
    `/api/money/obligations/${OCCURRENCE_ID}/payment`,
    {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        bookingDate: "2026-11-05",
        idempotencyKey: "obligation-payment:op-1",
        operationId: "op-1",
      }),
    },
  );
  assert.equal(validation.status, 400);
  assert.equal((await validation.json()).error.code, "VALIDATION");

  const conflict = new FakeSupabase();
  conflict.push("money_obligations", { data: paidOccurrenceRow(), error: null });
  conflict.pushRpc({ data: null, error: { code: "23514", message: "already paid" } });
  const settled = await makeApp(conflict).request(
    `/api/money/obligations/${OCCURRENCE_ID}/payment`,
    {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        version: 2,
        bookingDate: "2026-11-05",
        idempotencyKey: "obligation-payment:op-2",
        needVsWant: "need",
        operationId: "op-2",
      }),
    },
  );
  assert.equal(settled.status, 409);
  assert.equal((await settled.json()).error.code, "CONFLICT");
});

test("POST /payment/correction and /payment/undo call their own RPCs", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: paidOccurrenceRow(), error: null });
  fake.pushRpc({
    data: { outcome: "corrected", occurrence: paidOccurrenceRow(), payment: PAYMENT_OBJECT },
    error: null,
  });
  fake.push("money_obligations", { data: paidOccurrenceRow(), error: null });
  fake.pushRpc({
    data: { outcome: "undone", occurrence: occurrenceRow(), payment: PAYMENT_OBJECT },
    error: null,
  });

  const app = makeApp(fake);
  const correction = await app.request(
    `/api/money/obligations/${OCCURRENCE_ID}/payment/correction`,
    {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        version: 2,
        amountMinor: 355000,
        bookingDate: "2026-11-06",
        operationId: "op-2",
      }),
    },
  );
  assert.equal(correction.status, 200);
  const correctionBody = await correction.json();
  assert.equal(correctionBody.ok, true);
  assert.equal(correctionBody.payment.amountMinor, 350000);

  const undo = await app.request(`/api/money/obligations/${OCCURRENCE_ID}/payment/undo`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({ version: 2, operationId: "op-3" }),
  });
  assert.equal(undo.status, 200);
  const undoBody = await undo.json();
  assert.equal(undoBody.ok, true);
  assert.equal(undoBody.obligation.state, "pending");
  assert.equal(undoBody.obligation.paymentExpenseId, null);

  assert.deepEqual(
    fake.rpcCalls.map((call) => call.name),
    ["money_correct_obligation_payment", "money_undo_obligation_payment"],
  );
  assert.equal(fake.rpcCalls[0].args.p_amount_minor, 355000);
  assert.equal(fake.rpcCalls[0].args.p_booking_date, "2026-11-06");
  assert.equal(fake.rpcCalls[1].args.p_operation_id, "op-3");
});

test("the payment routes reject an unknown body field", async () => {
  const fake = new FakeSupabase();
  fake.push("money_obligations", { data: occurrenceRow(), error: null });
  const res = await makeApp(fake).request(`/api/money/obligations/${OCCURRENCE_ID}/payment`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      bookingDate: "2026-11-05",
      idempotencyKey: "obligation-payment:op-1",
      needVsWant: "need",
      operationId: "op-1",
      ownerUserId: "attacker",
    }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "VALIDATION");
});
