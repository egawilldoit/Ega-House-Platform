import { describe, expect, it } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import { createMcpObligationPaymentWriteHandlers } from "@/lib/mcp/write/obligation-payments";

/**
 * MONEY-07 MCP payment handlers at the real authorization/use-case seam. The
 * database edge is faked, but the application and domain rules run for real:
 * the operation id is carried beside the payload, an unknown need/want is
 * requested, and a refused write never claims that cash moved.
 */

const OCCURRENCE_ID = "22222222-2222-4222-8222-222222222222";
const PAYMENT_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_ID = "650e8400-e29b-41d4-a716-446655440000";

const writer = {
  ownerUserId: "11111111-1111-4111-8111-111111111111",
  oauthClientId: "chatgpt-client",
  grantId: "22222222-2222-4222-8222-222222222222",
  permissionProfile: "personal_operations_writer" as const,
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("personal_operations_writer"),
};
const reader = {
  ...writer,
  permissionProfile: "personal_operations" as const,
  permissions: getPermissionsForProfile("personal_operations"),
};

const writerAuth = createMcpAuthInfo("token", writer);
const readerAuth = createMcpAuthInfo("token", reader);

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

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
    version: 1,
    created_at: "2026-11-01T09:00:00+00:00",
    updated_at: "2026-11-01T09:00:00+00:00",
    ...overrides,
  };
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

class FakeBuilder {
  private readonly steps: string[] = [];

  constructor(
    private readonly queue: QueryResult[],
    private readonly calls: string[],
  ) {}

  select() {
    this.steps.push("select");
    return this;
  }
  eq(column: string, value: unknown) {
    this.steps.push(`eq:${column}=${String(value)}`);
    return this;
  }
  maybeSingle() {
    return this.terminal("maybeSingle");
  }
  single() {
    return this.terminal("single");
  }
  then<TResult1, TResult2>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.terminal("await").then(fulfilled, rejected);
  }
  private terminal(method: string) {
    this.steps.push(method);
    this.calls.push([...this.steps].join("|"));
    return Promise.resolve(this.queue.shift() ?? { data: null, error: null });
  }
}

function fakeClient(queue: QueryResult[]) {
  const calls: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpcCalls,
    client: {
      from() {
        return new FakeBuilder(queue, calls);
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return queue.shift() ?? { data: null, error: null };
      },
    },
  };
}

function handlersFor(client: unknown) {
  return createMcpObligationPaymentWriteHandlers({
    createUserClient: () => client as never,
  });
}

function errorCode(result: { structuredContent?: unknown }) {
  return (result.structuredContent as { error?: { code?: string } } | undefined)
    ?.error?.code;
}

describe("MCP obligation payment write handlers", () => {
  it("denies a reader grant without touching persistence", async () => {
    const { client, calls, rpcCalls } = fakeClient([]);
    const handlers = handlersFor(client);

    const result = await handlers.payObligation(
      readerAuth,
      {
        obligationId: OCCURRENCE_ID,
        version: 1,
        bookingDate: "2026-11-05",
        needVsWant: "need",
      },
      OPERATION_ID,
    );

    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("PERMISSION_DENIED");
    expect(calls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it("pays through one atomic call and reports the stored payment", async () => {
    const { client, rpcCalls } = fakeClient([
      { data: occurrenceRow(), error: null },
      {
        data: {
          outcome: "paid",
          occurrence: occurrenceRow({
            state: "paid",
            version: 2,
            payment_expense_id: PAYMENT_ID,
          }),
          payment: PAYMENT_OBJECT,
        },
        error: null,
      },
    ]);
    const handlers = handlersFor(client);

    const result = await handlers.payObligation(
      writerAuth,
      {
        obligationId: OCCURRENCE_ID,
        version: 1,
        bookingDate: "2026-11-05",
        needVsWant: "need",
      },
      OPERATION_ID,
    );

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as {
      ok: boolean;
      obligation: { id: string; state: string };
      payment: { expenseId: string; amountMinor: number };
      operationId: string;
      cashEffect: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.obligation.state).toBe("paid");
    expect(payload.payment.expenseId).toBe(PAYMENT_ID);
    expect(payload.payment.amountMinor).toBe(350000);
    expect(payload.operationId).toBe(OPERATION_ID);
    expect(payload.cashEffect).toBe("expense_outflow");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("money_pay_obligation");
    expect(rpcCalls[0].args.p_occurrence_id).toBe(OCCURRENCE_ID);
    expect(rpcCalls[0].args.p_operation_id).toBe(OPERATION_ID);
    expect(rpcCalls[0].args.p_idempotency_key).toBe(
      `obligation-payment:${OPERATION_ID}`,
    );
  });

  it("requests need/want instead of inventing it", async () => {
    const { client, rpcCalls } = fakeClient([
      { data: occurrenceRow(), error: null },
    ]);
    const handlers = handlersFor(client);

    const result = await handlers.payObligation(
      writerAuth,
      {
        obligationId: OCCURRENCE_ID,
        version: 1,
        bookingDate: "2026-11-05",
      },
      OPERATION_ID,
    );

    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("INVALID_ARGUMENT");
    expect(rpcCalls).toHaveLength(0);
  });

  it("corrects and undoes through their own atomic calls", async () => {
    const { client, rpcCalls } = fakeClient([
      {
        data: occurrenceRow({
          state: "paid",
          version: 2,
          payment_expense_id: PAYMENT_ID,
        }),
        error: null,
      },
      {
        data: {
          outcome: "corrected",
          occurrence: occurrenceRow({
            state: "paid",
            version: 3,
            payment_expense_id: PAYMENT_ID,
          }),
          payment: { ...PAYMENT_OBJECT, amount_minor: 355000 },
        },
        error: null,
      },
      {
        data: occurrenceRow({
          state: "paid",
          version: 3,
          payment_expense_id: PAYMENT_ID,
        }),
        error: null,
      },
      {
        data: {
          outcome: "undone",
          occurrence: occurrenceRow(),
          payment: PAYMENT_OBJECT,
        },
        error: null,
      },
    ]);
    const handlers = handlersFor(client);

    const correction = await handlers.correctObligationPayment(
      writerAuth,
      {
        obligationId: OCCURRENCE_ID,
        version: 2,
        amountMinor: 355000,
        bookingDate: "2026-11-06",
      },
      OPERATION_ID,
    );
    expect(correction.isError).toBeUndefined();
    const correctionPayload = correction.structuredContent as {
      ok: boolean;
      payment: { amountMinor: number };
    };
    expect(correctionPayload.ok).toBe(true);
    expect(correctionPayload.payment.amountMinor).toBe(355000);

    const undo = await handlers.undoObligationPayment(
      writerAuth,
      { obligationId: OCCURRENCE_ID, version: 3 },
      OPERATION_ID,
    );
    expect(undo.isError).toBeUndefined();
    const undoPayload = undo.structuredContent as {
      ok: boolean;
      obligation: { state: string; paymentExpenseId: string | null };
      cashEffect: string;
    };
    expect(undoPayload.ok).toBe(true);
    expect(undoPayload.obligation.state).toBe("pending");
    expect(undoPayload.obligation.paymentExpenseId).toBeNull();
    expect(undoPayload.cashEffect).toBe("expense_outflow_reversed");

    expect(rpcCalls.map((call) => call.name)).toEqual([
      "money_correct_obligation_payment",
      "money_undo_obligation_payment",
    ]);
    expect(rpcCalls[0].args.p_amount_minor).toBe(355000);
    expect(rpcCalls[1].args.p_operation_id).toBe(OPERATION_ID);
  });
});
