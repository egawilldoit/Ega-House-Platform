import { describe, expect, it } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";

/**
 * The outer mutation receipt must bind every semantic create field. Each call
 * here stops at the claim (the fake RPC always returns CONFLICT), so the test
 * observes exactly the fingerprint the handler submitted without touching a
 * database.
 */

const OPERATION_ID = "650e8400-e29b-41d4-a716-446655440000";
const RESOURCE = "https://ega.example.com/api/mcp";

const principal = {
  ownerUserId: "11111111-1111-4111-8111-111111111111",
  oauthClientId: "chatgpt-client",
  grantId: "22222222-2222-4222-8222-222222222222",
  permissionProfile: "personal_operations_writer" as const,
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("personal_operations_writer"),
};

const authInfo = createMcpAuthInfo("token", principal);

function baseInput() {
  return {
    occurredAt: "2026-11-11T09:15:00.000Z",
    amountMinor: 1100,
    category: "coffee",
    needVsWant: "want" as const,
    note: "morning coffee",
    merchant: "Cafe",
    paymentMethod: "cash",
    idempotencyKey: "coffee-1",
    operationId: OPERATION_ID,
  };
}

function handlerWithRecordedHashes(writesEnabled = true) {
  const hashes: string[] = [];
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      hashes.push(String(args.p_args_hash));
      return {
        data: [{ claim_outcome: "CONFLICT", claim_token: null, existing_result: null }],
        error: null,
      };
    },
  };
  const handlers = createMcpWriteToolHandlers(
    { createUserClient: () => client as never },
    writesEnabled,
    RESOURCE,
  );
  return { handlers, hashes };
}

describe("ega_create_personal_ops_expense receipt fingerprint", () => {
  it("hashes an identical retry to the same value", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();

    await handlers.createPersonalOpsExpense(authInfo, baseInput());
    await handlers.createPersonalOpsExpense(authInfo, { ...baseInput() });

    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it.each([
    ["note", { note: "changed note" }],
    ["merchant", { merchant: "Other cafe" }],
    ["paymentMethod", { paymentMethod: "card" }],
    ["paymentMethod cleared to unknown", { paymentMethod: null }],
    ["needVsWant", { needVsWant: "need" as const }],
    ["amountMinor", { amountMinor: 1200 }],
    ["category", { category: "groceries" }],
    ["occurredAt", { occurredAt: "2026-11-11T10:15:00.000Z" }],
    ["idempotencyKey", { idempotencyKey: "coffee-2" }],
  ])("changes the fingerprint when %s changes", async (_label, change) => {
    const { handlers, hashes } = handlerWithRecordedHashes();

    await handlers.createPersonalOpsExpense(authInfo, baseInput());
    await handlers.createPersonalOpsExpense(authInfo, {
      ...baseInput(),
      ...change,
    });

    expect(hashes).toHaveLength(2);
    expect(hashes[1]).not.toBe(hashes[0]);
  });

  it("treats equivalent timestamp spellings as the same purchase", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();

    await handlers.createPersonalOpsExpense(authInfo, baseInput());
    // Same instant, offset spelling.
    await handlers.createPersonalOpsExpense(authInfo, {
      ...baseInput(),
      occurredAt: "2026-11-11T10:15:00+01:00",
    });

    expect(hashes[0]).toBe(hashes[1]);
  });

  it("normalizes incidental whitespace and null/omitted optional text", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();

    await handlers.createPersonalOpsExpense(authInfo, {
      ...baseInput(),
      note: "  morning coffee  ",
      merchant: " Cafe ",
    });
    await handlers.createPersonalOpsExpense(authInfo, {
      ...baseInput(),
      note: "morning coffee",
      merchant: "Cafe",
    });
    expect(hashes[0]).toBe(hashes[1]);

    await handlers.createPersonalOpsExpense(authInfo, {
      ...baseInput(),
      note: null,
      merchant: null,
    });
    await handlers.createPersonalOpsExpense(authInfo, {
      ...baseInput(),
      note: undefined,
      merchant: undefined,
    });
    expect(hashes[2]).toBe(hashes[3]);
  });

  it("refuses to claim anything when writes are disabled", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes(false);

    const result = await handlers.createPersonalOpsExpense(
      authInfo,
      baseInput(),
    );

    expect(result.isError).toBe(true);
    expect(
      (result.structuredContent as { error?: { code?: string } }).error?.code,
    ).toBe("WRITES_DISABLED");
    expect(hashes).toHaveLength(0);
  });
});
