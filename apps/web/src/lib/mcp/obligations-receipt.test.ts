import { describe, expect, it } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";

/**
 * MONEY-06 mutation receipts must bind the full normalized obligation input.
 * Each call stops at the claim (the fake RPC returns CONFLICT), so the test
 * observes the fingerprint submitted without touching a database.
 */

const OPERATION_ID = "650e8400-e29b-41d4-a716-446655440000";
const OBLIGATION_ID = "750e8400-e29b-41d4-a716-446655440000";
const TEMPLATE_ID = "850e8400-e29b-41d4-a716-446655440000";
const RESOURCE = "https://ega.example.com/api/mcp";

const principal = {
  ownerUserId: "11111111-1111-4111-8111-111111111111",
  oauthClientId: "chatgpt-client",
  grantId: "22222222-2222-4222-8222-222222222222",
  permissionProfile: "personal_operations_writer" as const,
  permissionsVersion: 1,
  permissions: getPermissionsForProfile("personal_operations_writer"),
};

const readerPrincipal = {
  ...principal,
  permissionProfile: "personal_operations" as const,
  permissions: getPermissionsForProfile("personal_operations"),
};

const authInfo = createMcpAuthInfo("token", principal);
const readerAuthInfo = createMcpAuthInfo("token", readerPrincipal);

function baseCreateInput() {
  return {
    kind: "bill" as const,
    description: "Rent",
    amountMinor: 350000,
    dueDate: "2026-11-05",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    needVsWant: null,
    purpose: "fixed" as const,
    countsInDaily: false,
    category: "bills" as const,
    stateEffectiveDate: "2026-11-01",
    idempotencyKey: "obligation-1",
    operationId: OPERATION_ID,
  };
}

function handlerWithRecordedHashes(writesEnabled = true) {
  const hashes: string[] = [];
  const rpcNames: string[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcNames.push(name);
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
  return { handlers, hashes, rpcNames };
}

describe("ega_money_create_obligation receipt fingerprint", () => {
  it("hashes an identical retry to the same value", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyObligation(authInfo, baseCreateInput());
    await handlers.createMoneyObligation(authInfo, { ...baseCreateInput() });
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it.each([
    ["description", { description: "Rent (new)" }],
    ["amountMinor", { amountMinor: 355000 }],
    ["dueDate", { dueDate: "2026-11-06" }],
    ["periodStart", { periodStart: "2026-10-25" }],
    ["periodEnd", { periodEnd: "2026-12-01" }],
    ["templateId", { templateId: TEMPLATE_ID }],
    ["needVsWant", { needVsWant: "need" as const }],
    ["purpose", { purpose: "flexible" as const }],
    ["countsInDaily", { countsInDaily: true }],
    ["category", { category: "household" as const }],
    ["stateEffectiveDate", { stateEffectiveDate: "2026-11-02" }],
    ["idempotencyKey", { idempotencyKey: "obligation-2" }],
  ])("changes the fingerprint when %s changes", async (_label, change) => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyObligation(authInfo, baseCreateInput());
    await handlers.createMoneyObligation(authInfo, {
      ...baseCreateInput(),
      ...change,
    });
    expect(hashes).toHaveLength(2);
    expect(hashes[1]).not.toBe(hashes[0]);
  });

  it("normalizes incidental whitespace in the description", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyObligation(authInfo, {
      ...baseCreateInput(),
      description: "  Rent  ",
    });
    await handlers.createMoneyObligation(authInfo, baseCreateInput());
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("binds the transition target and effective date", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    const base = {
      obligationId: OBLIGATION_ID,
      version: 1,
      to: "cancelled" as const,
      effectiveDate: "2026-11-11",
      operationId: OPERATION_ID,
    };
    await handlers.transitionMoneyObligation(authInfo, base);
    await handlers.transitionMoneyObligation(authInfo, base);
    expect(hashes[0]).toBe(hashes[1]);

    await handlers.transitionMoneyObligation(authInfo, {
      ...base,
      to: "waived",
    });
    expect(hashes[2]).not.toBe(hashes[0]);
    await handlers.transitionMoneyObligation(authInfo, {
      ...base,
      effectiveDate: "2026-11-12",
    });
    expect(hashes[3]).not.toBe(hashes[0]);
  });

  it("binds the template generation cutoff", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.generateMoneyObligations(authInfo, {
      templateId: TEMPLATE_ID,
      throughDate: "2026-11-30",
      operationId: OPERATION_ID,
    });
    await handlers.generateMoneyObligations(authInfo, {
      templateId: TEMPLATE_ID,
      throughDate: "2026-12-31",
      operationId: OPERATION_ID,
    });
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it("refuses to claim when writes are disabled", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes(false);
    const result = await handlers.createMoneyObligation(
      authInfo,
      baseCreateInput(),
    );
    expect(result.isError).toBe(true);
    expect(
      (result.structuredContent as { error?: { code?: string } }).error?.code,
    ).toBe("WRITES_DISABLED");
    expect(hashes).toHaveLength(0);
  });

  it("denies every obligation write without the explicit personal_ops.write grant", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    const calls = [
      handlers.createMoneyObligation(readerAuthInfo, baseCreateInput()),
      handlers.updateMoneyObligation(readerAuthInfo, {
        obligationId: OBLIGATION_ID,
        version: 1,
        description: "Rent",
        operationId: OPERATION_ID,
      }),
      handlers.transitionMoneyObligation(readerAuthInfo, {
        obligationId: OBLIGATION_ID,
        version: 1,
        to: "waived",
        effectiveDate: "2026-11-11",
        operationId: OPERATION_ID,
      }),
      handlers.generateMoneyObligations(readerAuthInfo, {
        templateId: TEMPLATE_ID,
        throughDate: "2026-11-30",
        operationId: OPERATION_ID,
      }),
    ];
    const results = await Promise.all(calls);
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(
        (result.structuredContent as { error?: { code?: string } }).error?.code,
      ).toBe("PERMISSION_DENIED");
    }
    expect(hashes).toHaveLength(0);
  });

  it("distinguishes omitted fields from explicit null in update receipts", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    const base = {
      obligationId: OBLIGATION_ID,
      version: 1,
      description: "Rent",
      operationId: OPERATION_ID,
    };
    await handlers.updateMoneyObligation(authInfo, base);
    await handlers.updateMoneyObligation(authInfo, { ...base, category: null });
    expect(hashes).toHaveLength(2);
    expect(hashes[1]).not.toBe(hashes[0]);
  });
});
