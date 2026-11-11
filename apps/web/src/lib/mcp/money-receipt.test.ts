import { describe, expect, it } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";

/**
 * `ega_money_update_settings` must bind the full normalized input in the outer
 * receipt. Each call stops at the claim (the fake RPC always returns CONFLICT)
 * so the test observes exactly the fingerprint submitted without a database.
 */

const OPERATION_ID = "750e8400-e29b-41d4-a716-446655440000";
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
    operationId: OPERATION_ID,
    version: 2,
    activeDate: "2026-11-11",
    opening: {
      amountMinor: 0,
      source: "user_entered" as const,
      cutoffDate: "2026-11-08",
      evidence: null,
      note: "counted",
    },
    settings: { dailyTargetMinor: 20_000 },
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

describe("ega_money_update_settings receipt fingerprint", () => {
  it("hashes an identical retry to the same value", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.updateMoneySettings(authInfo, baseInput());
    await handlers.updateMoneySettings(authInfo, baseInput());
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it.each([
    ["periodId", { periodId: "00000000-0000-4000-8000-000000000001" }],
    ["version", { version: 3 }],
    ["startDate", { startDate: "2026-11-09" }],
    ["endDate", { endDate: "2026-11-30" }],
    ["timezone", { timezone: "UTC" }],
    ["activeDate", { activeDate: "2026-11-10" }],
    [
      "opening amount",
      { opening: { ...baseInput().opening, amountMinor: 1 } },
    ],
    [
      "opening source",
      { opening: { ...baseInput().opening, source: "verified_source" as const } },
    ],
    [
      "opening cutoff",
      { opening: { ...baseInput().opening, cutoffDate: "2026-11-07" } },
    ],
    [
      "opening evidence",
      { opening: { ...baseInput().opening, evidence: "statement" } },
    ],
    ["opening note", { opening: { ...baseInput().opening, note: "other" } }],
    ["opening cleared", { opening: null }],
    ["settings", { settings: { dailyTargetMinor: 25_000 } }],
  ])("changes the fingerprint when %s changes", async (_label, change) => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.updateMoneySettings(authInfo, baseInput());
    await handlers.updateMoneySettings(authInfo, {
      ...baseInput(),
      ...change,
    });
    expect(hashes).toHaveLength(2);
    expect(hashes[1]).not.toBe(hashes[0]);
  });

  it("keeps omitted and explicitly null optional opening fields equivalent", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.updateMoneySettings(authInfo, {
      ...baseInput(),
      opening: {
        amountMinor: 0,
        source: "user_entered",
      },
    });
    await handlers.updateMoneySettings(authInfo, {
      ...baseInput(),
      opening: {
        amountMinor: 0,
        source: "user_entered",
        cutoffDate: null,
        evidence: null,
        note: null,
      },
    });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("refuses to claim when writes are disabled", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes(false);
    const result = await handlers.updateMoneySettings(authInfo, baseInput());
    expect(result.isError).toBe(true);
    expect(
      (result.structuredContent as { error?: { code?: string } }).error?.code,
    ).toBe("WRITES_DISABLED");
    expect(hashes).toHaveLength(0);
  });
});
