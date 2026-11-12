import { describe, expect, it } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import { createMcpObligationWriteHandlers } from "@/lib/mcp/write/obligations";

/**
 * MONEY-06 MCP write handlers at the real authorization/use-case seam. The
 * Supabase edge is faked, but the application/domain lifecycle rules run for
 * real: a status-only payment is refused and a paid occurrence cannot be
 * re-priced.
 */

const OCCURRENCE_ID = "22222222-2222-4222-8222-222222222222";
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

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };

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
    payment_expense_id: null,
    payment_evidence: null,
    idempotency_key: "occurrence-1",
    version: 1,
    created_at: "2026-11-01T09:00:00+00:00",
    updated_at: "2026-11-01T09:00:00+00:00",
    ...overrides,
  };
}

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
  insert(payload: unknown) {
    this.steps.push(`insert:${JSON.stringify(payload)}`);
    return this;
  }
  update(payload: unknown) {
    this.steps.push(`update:${JSON.stringify(payload)}`);
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
  return {
    calls,
    client: {
      from() {
        return new FakeBuilder(queue, calls);
      },
    },
  };
}

function handlersFor(client: unknown) {
  return createMcpObligationWriteHandlers({
    createUserClient: () => client as never,
  });
}

function errorCode(result: { structuredContent?: unknown }) {
  return (result.structuredContent as { error?: { code?: string } } | undefined)
    ?.error?.code;
}

describe("MCP obligation write handlers", () => {
  it("denies a reader grant without touching persistence", async () => {
    const { client, calls } = fakeClient([]);
    const handlers = handlersFor(client);

    const result = await handlers.createObligation(readerAuth, {
      kind: "bill",
      description: "Rent",
      amountMinor: 350000,
      dueDate: "2026-11-05",
      stateEffectiveDate: "2026-11-01",
      idempotencyKey: "obligation-1",
    }, OPERATION_ID);

    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("PERMISSION_DENIED");
    expect(calls).toHaveLength(0);
  });

  it("creates a pending occurrence for the verified owner", async () => {
    const { client, calls } = fakeClient([
      { data: null, error: null },
      { data: occurrenceRow(), error: null },
    ]);
    const handlers = handlersFor(client);

    const result = await handlers.createObligation(writerAuth, {
      kind: "bill",
      description: "Rent",
      amountMinor: 350000,
      dueDate: "2026-11-05",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      stateEffectiveDate: "2026-11-01",
      idempotencyKey: "obligation-1",
    }, OPERATION_ID);

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as {
      ok: boolean;
      obligation: { id: string; state: string; needVsWant: string | null };
      cashEffect: string;
      operationId: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.obligation.id).toBe(OCCURRENCE_ID);
    expect(payload.obligation.state).toBe("pending");
    expect(payload.obligation.needVsWant).toBeNull();
    expect(payload.cashEffect).toBe("none");
    expect(payload.operationId).toBe(OPERATION_ID);

    const insert = calls.find((call) => call.includes("insert:"));
    const payloadJson =
      insert?.slice(insert.indexOf("insert:") + "insert:".length).split("|")[0] ??
      "{}";
    const inserted = JSON.parse(payloadJson) as Record<string, unknown>;
    expect(inserted.owner_user_id).toBe(writer.ownerUserId);
    expect(inserted.state).toBe("pending");
  });

  it("refuses a status-only paid transition with a MONEY-07 conflict", async () => {
    const { client, calls } = fakeClient([{ data: occurrenceRow(), error: null }]);
    const handlers = handlersFor(client);

    const result = await handlers.transitionObligation(writerAuth, {
      obligationId: OCCURRENCE_ID,
      version: 1,
      to: "paid",
      effectiveDate: "2026-11-05",
    }, OPERATION_ID);

    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("CONFLICT");
    const message = (result.structuredContent as { error: { message: string } })
      .error.message;
    expect(message).toMatch(/MONEY-07/);
    expect(calls.some((call) => call.includes("update:"))).toBe(false);
  });

  it("refuses to re-price a paid occurrence", async () => {
    const { client, calls } = fakeClient([
      {
        data: occurrenceRow({
          state: "paid",
          state_effective_date: "2026-11-05",
          payment_expense_id: "33333333-3333-4333-8333-333333333333",
        }),
        error: null,
      },
    ]);
    const handlers = handlersFor(client);

    const result = await handlers.updateObligation(writerAuth, {
      obligationId: OCCURRENCE_ID,
      version: 1,
      amountMinor: 1,
    }, OPERATION_ID);

    expect(result.isError).toBe(true);
    expect(errorCode(result)).toBe("CONFLICT");
    expect(calls.some((call) => call.includes("update:"))).toBe(false);
  });

  it("cancels a pending occurrence with the versioned effective date", async () => {
    const { client, calls } = fakeClient([
      { data: occurrenceRow(), error: null },
      {
        data: occurrenceRow({
          state: "cancelled",
          state_effective_date: "2026-11-11",
          state_reason: "Duplicate bill",
          version: 2,
        }),
        error: null,
      },
    ]);
    const handlers = handlersFor(client);

    const result = await handlers.transitionObligation(writerAuth, {
      obligationId: OCCURRENCE_ID,
      version: 1,
      to: "cancelled",
      effectiveDate: "2026-11-11",
      reason: "Duplicate bill",
    }, OPERATION_ID);

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as {
      obligation: { state: string; stateEffectiveDate: string };
      cashEffect: string;
    };
    expect(payload.obligation.state).toBe("cancelled");
    expect(payload.obligation.stateEffectiveDate).toBe("2026-11-11");
    expect(payload.cashEffect).toBe("none");

    const update = calls.find((call) => call.includes("update:"));
    expect(update).toContain('"state":"cancelled"');
    expect(update).toContain('"state_effective_date":"2026-11-11"');
    expect(update).toContain('"version":2');
  });

  it("generates occurrences through the outer handler without leaking operationId", async () => {
    const { client } = fakeClient([
      {
        data: {
          id: "44444444-4444-4444-8444-444444444444",
          kind: "bill",
          description: "Rent",
          amount_minor: 350000,
          currency: "MAD",
          cadence: "monthly",
          due_day_of_month: 5,
          due_weekday: null,
          start_date: "2026-11-01",
          end_date: null,
          need_vs_want: "need",
          purpose: "fixed",
          counts_in_daily: false,
          category: "bills",
          lifecycle: "active",
          idempotency_key: "template-1",
          version: 1,
          created_at: "2026-11-01T09:00:00+00:00",
          updated_at: "2026-11-01T09:00:00+00:00",
        },
        error: null,
      },
      { data: null, error: null },
      { data: occurrenceRow(), error: null },
    ]);
    const handlers = handlersFor(client);

    const result = await handlers.generateObligations(
      writerAuth,
      {
        templateId: "44444444-4444-4444-8444-444444444444",
        throughDate: "2026-11-30",
        operationId: OPERATION_ID,
      } as never,
      OPERATION_ID,
    );

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as {
      ok: boolean;
      created: number;
      cashEffect: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.created).toBe(1);
    expect(payload.cashEffect).toBe("none");
  });
});
