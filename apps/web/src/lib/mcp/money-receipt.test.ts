import { describe, expect, it } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { canonicalMutationFingerprint } from "@/lib/mcp/mutation-idempotency";
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

describe("ega_money_rebase_day_start_baseline receipt", () => {
  it("binds retries to the selected period", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    const input = { operationId: OPERATION_ID, periodId: "00000000-0000-4000-8000-000000000001" };
    await handlers.rebaseMoneyDayStartBaseline(authInfo, input);
    await handlers.rebaseMoneyDayStartBaseline(authInfo, input);
    await handlers.rebaseMoneyDayStartBaseline(authInfo, { ...input, periodId: "00000000-0000-4000-8000-000000000002" });
    expect(hashes).toHaveLength(3);
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[2]).not.toBe(hashes[0]);
  });
});

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

function movementBaseInput() {
  return {
    kind: "income" as const,
    amountMinor: 20_000,
    bookingDate: "2026-11-09",
    note: "salary",
    idempotencyKey: "income-1",
    operationId: OPERATION_ID,
  };
}

describe("ega_money_create_movement receipt fingerprint", () => {
  it("replays an identical movement with the same fingerprint", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyMovement(authInfo, movementBaseInput());
    await handlers.createMoneyMovement(authInfo, { ...movementBaseInput() });
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("treats incidental whitespace as the same semantic movement", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyMovement(authInfo, movementBaseInput());
    await handlers.createMoneyMovement(authInfo, {
      ...movementBaseInput(),
      note: "  salary  ",
    });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("binds amount, kind, booking date and daily inclusion", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyMovement(authInfo, movementBaseInput());
    await handlers.createMoneyMovement(authInfo, { ...movementBaseInput(), amountMinor: 20_001 });
    await handlers.createMoneyMovement(authInfo, { ...movementBaseInput(), kind: "savings_transfer" });
    await handlers.createMoneyMovement(authInfo, { ...movementBaseInput(), bookingDate: "2026-11-10" });
    await handlers.createMoneyMovement(authInfo, { ...movementBaseInput(), countsInDaily: true });
    await handlers.createMoneyMovement(authInfo, {
      ...movementBaseInput(),
      occurredAt: "2026-11-09T10:00:00.000Z",
    });
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("refuses to run when writes are disabled or the write grant is absent", async () => {
    const disabled = handlerWithRecordedHashes(false);
    const disabledResult = await disabled.handlers.createMoneyMovement(
      authInfo,
      movementBaseInput(),
    );
    expect(disabledResult.structuredContent).toMatchObject({
      ok: false,
      error: { code: "WRITES_DISABLED" },
    });
    expect(disabled.hashes).toHaveLength(0);

    const readOnly = handlerWithRecordedHashes();
    const readOnlyAuth = createMcpAuthInfo("token", {
      ...principal,
      permissionProfile: "workspace_money_reader",
      permissions: getPermissionsForProfile("workspace_money_reader"),
    });
    const readOnlyResult = await readOnly.handlers.createMoneyMovement(
      readOnlyAuth,
      movementBaseInput(),
    );
    expect(readOnlyResult.structuredContent).toMatchObject({
      ok: false,
      error: { code: "PERMISSION_DENIED" },
    });
    expect(readOnly.hashes).toHaveLength(0);
  });
});

describe("ega_money_update_movement receipt fingerprint", () => {
  function updateInput() {
    return {
      movementId: "00000000-0000-4000-8000-000000000010",
      version: 1,
      amountMinor: 21_000,
      countsInDaily: true,
      operationId: OPERATION_ID,
    };
  }

  it("binds movement id, expected version, amount and daily inclusion", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.updateMoneyMovement(authInfo, updateInput());
    await handlers.updateMoneyMovement(authInfo, { ...updateInput() });
    expect(hashes[0]).toBe(hashes[1]);

    await handlers.updateMoneyMovement(authInfo, { ...updateInput(), version: 2 });
    await handlers.updateMoneyMovement(authInfo, { ...updateInput(), amountMinor: 21_001 });
    await handlers.updateMoneyMovement(authInfo, { ...updateInput(), countsInDaily: false });
    await handlers.updateMoneyMovement(authInfo, {
      ...updateInput(),
      movementId: "00000000-0000-4000-8000-000000000011",
    });
    const variants = hashes.slice(2);
    expect(new Set(variants).size).toBe(variants.length);
    expect(variants).not.toContain(hashes[0]);
  });

  it("distinguishes an omitted field from an explicit clear", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.updateMoneyMovement(authInfo, updateInput());
    await handlers.updateMoneyMovement(authInfo, { ...updateInput(), note: null });
    await handlers.updateMoneyMovement(authInfo, { ...updateInput(), note: "restated" });
    expect(hashes[1]).not.toBe(hashes[0]);
    expect(hashes[2]).not.toBe(hashes[0]);
    expect(hashes[2]).not.toBe(hashes[1]);
  });
});

describe("ega_money_close_day receipt fingerprint", () => {
  const closeInput = () => ({
    version: 3,
    operationId: OPERATION_ID,
    note: "Closed with chicken",
    finalPurchases: [
      {
        amountMinor: 1100,
        category: "coffee",
        needVsWant: "want" as const,
        countsInDaily: true,
        idempotencyKey: "close-purchase-1",
      },
      {
        amountMinor: 2500,
        category: "eating_out",
        needVsWant: "need" as const,
        purpose: "flexible" as const,
        idempotencyKey: "close-purchase-2",
      },
    ],
  });

  it("binds the identical retry and every purchase field to one hash", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.closeMoneyDay(authInfo, closeInput());
    await handlers.closeMoneyDay(authInfo, closeInput());
    // Every close with an omitted purchase flag checks the effective
    // fingerprint first and the pre-change compatibility shape second.
    expect(hashes).toHaveLength(4);
    const primary = hashes.filter((_hash, index) => index % 2 === 0);
    expect(primary[0]).toBe(primary[1]);

    await handlers.closeMoneyDay(authInfo, { ...closeInput(), note: "different" });
    await handlers.closeMoneyDay(authInfo, {
      ...closeInput(),
      finalPurchases: [
        { ...closeInput().finalPurchases[0]!, amountMinor: 1200 },
        closeInput().finalPurchases[1]!,
      ],
    });
    await handlers.closeMoneyDay(authInfo, {
      ...closeInput(),
      finalPurchases: [
        { ...closeInput().finalPurchases[0]!, countsInDaily: false },
        closeInput().finalPurchases[1]!,
      ],
    });
    const nextPrimary = hashes.filter((_hash, index) => index % 2 === 0);
    expect(nextPrimary).toHaveLength(5);
    expect(nextPrimary[2]).not.toBe(nextPrimary[0]);
    expect(nextPrimary[3]).not.toBe(nextPrimary[0]);
    expect(nextPrimary[4]).not.toBe(nextPrimary[0]);
  });

  it("keeps purchase ordering semantically irrelevant", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.closeMoneyDay(authInfo, closeInput());
    await handlers.closeMoneyDay(authInfo, {
      ...closeInput(),
      finalPurchases: [...closeInput().finalPurchases].reverse(),
    });
    expect(hashes).toHaveLength(4);
    expect(hashes[0]).toBe(hashes[2]);
    expect(hashes[1]).toBe(hashes[3]);
  });

  it("hashes an omitted flag as its effective daily classification", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    const billsPurchase = {
      amountMinor: 900,
      category: "bills",
      needVsWant: "need" as const,
      countsInDaily: undefined,
      idempotencyKey: "close-bills-1",
    };
    await handlers.closeMoneyDay(authInfo, {
      ...closeInput(),
      finalPurchases: [billsPurchase],
    });
    await handlers.closeMoneyDay(authInfo, {
      ...closeInput(),
      finalPurchases: [{ ...billsPurchase, countsInDaily: false }],
    });
    // A bill defaults to excluded from daily spend; the omitted flag must
    // therefore hash exactly like the explicit effective `false`, not like
    // the old null compatibility shape. The explicit call has no separate
    // compatibility shape because its legacy fingerprint is the same hash.
    expect(hashes).toHaveLength(3);
    expect(hashes[0]).toBe(hashes[2]);
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it("replays a pre-change receipt whose purchase omitted countsInDaily", async () => {
    const input = closeInput();
    const omitted = {
      ...input,
      finalPurchases: [
        {
          amountMinor: input.finalPurchases[0]!.amountMinor,
          category: input.finalPurchases[0]!.category,
          needVsWant: input.finalPurchases[0]!.needVsWant,
          countsInDaily: undefined,
          idempotencyKey: input.finalPurchases[0]!.idempotencyKey,
        },
        input.finalPurchases[1]!,
      ],
    };
    // Seed the receipt exactly as the pre-change handler hashed it: an omitted
    // countsInDaily stayed null in the semantic input.
    const legacyHash = canonicalMutationFingerprint("ega_money_close_day", {
      periodId: null,
      version: input.version,
      date: null,
      note: "Closed with chicken",
      finalPurchases: omitted.finalPurchases
        .map((purchase) => ({
          amountMinor: purchase.amountMinor,
          category: purchase.category,
          note: null,
          merchant: null,
          needVsWant: purchase.needVsWant,
          paymentMethod: null,
          purpose: ("purpose" in purchase ? purchase.purpose : null) ?? null,
          countsInDaily: purchase.countsInDaily ?? null,
          idempotencyKey: purchase.idempotencyKey,
        }))
        .sort((left, right) =>
          left.idempotencyKey.localeCompare(right.idempotencyKey),
        ),
    });
    const hashes: string[] = [];
    const client = {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        hashes.push(String(args.p_args_hash));
        return {
          data: [
            args.p_args_hash === legacyHash
              ? {
                  claim_outcome: "REPLAY",
                  claim_token: null,
                  existing_result: {
                    ok: true,
                    replayed: true,
                    dayClose: { id: "legacy-close" },
                  },
                }
              : {
                  claim_outcome: "CONFLICT",
                  claim_token: null,
                  existing_result: null,
                },
          ],
          error: null,
        };
      },
    };
    const handlers = createMcpWriteToolHandlers(
      { createUserClient: () => client as never },
      true,
      RESOURCE,
    );

    const replayed = await handlers.closeMoneyDay(authInfo, omitted);
    expect(replayed.isError).toBeFalsy();
    expect(
      (replayed.structuredContent as { replayed?: boolean } | undefined)?.replayed,
    ).toBe(true);

    // The legacy receipt stored the omitted flag as null. An explicit `true`
    // is the same effective classification for new receipts, but it is not
    // the same pre-change receipt payload and must not replay that operation
    // as if the caller had omitted the field.
    const explicitTrue = await handlers.closeMoneyDay(authInfo, {
      ...omitted,
      finalPurchases: [
        { ...omitted.finalPurchases[0]!, countsInDaily: true },
        omitted.finalPurchases[1]!,
      ],
    });
    expect(explicitTrue.isError).toBe(true);
    expect(
      (explicitTrue.structuredContent as { error?: { code?: string } }).error?.code,
    ).toBe("CONFLICT");

    const changedAmount = await handlers.closeMoneyDay(authInfo, {
      ...omitted,
      finalPurchases: [
        { ...omitted.finalPurchases[0]!, amountMinor: 1200 },
        omitted.finalPurchases[1]!,
      ],
    });
    expect(changedAmount.isError).toBe(true);
    expect(hashes[0]).not.toBe(legacyHash);
    expect(hashes[1]).toBe(legacyHash);
  });
});
