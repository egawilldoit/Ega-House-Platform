import { describe, expect, it } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import { getPermissionsForProfile } from "@/lib/mcp/permissions";
import { createMcpWriteToolHandlers } from "@/lib/mcp/write-tool-handlers";

/**
 * MONEY-04 outer mutation receipt: every semantic movement field must bind the
 * operationId. The fake RPC always answers CONFLICT, so the handler stops at
 * the claim and the test observes exactly the fingerprint submitted.
 */

const OPERATION_ID = "650e8400-e29b-41d4-a716-446655440001";
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
    kind: "income" as const,
    amountMinor: 20_000,
    bookingDate: "2026-11-09",
    note: "salary",
    idempotencyKey: "income-1",
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

describe("ega_money_create_movement receipt fingerprint", () => {
  it("replays an identical movement with the same fingerprint", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyMovement(authInfo, baseInput());
    await handlers.createMoneyMovement(authInfo, { ...baseInput() });
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("treats incidental whitespace as the same semantic movement", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyMovement(authInfo, baseInput());
    await handlers.createMoneyMovement(authInfo, {
      ...baseInput(),
      note: "  salary  ",
    });
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("binds amount, kind, booking date and daily inclusion", async () => {
    const { handlers, hashes } = handlerWithRecordedHashes();
    await handlers.createMoneyMovement(authInfo, baseInput());
    await handlers.createMoneyMovement(authInfo, { ...baseInput(), amountMinor: 20_001 });
    await handlers.createMoneyMovement(authInfo, { ...baseInput(), kind: "savings_transfer" });
    await handlers.createMoneyMovement(authInfo, { ...baseInput(), bookingDate: "2026-11-10" });
    await handlers.createMoneyMovement(authInfo, { ...baseInput(), countsInDaily: true });
    await handlers.createMoneyMovement(authInfo, {
      ...baseInput(),
      occurredAt: "2026-11-09T10:00:00.000Z",
    });
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("refuses to run when writes are disabled or the write grant is absent", async () => {
    const disabled = handlerWithRecordedHashes(false);
    const disabledResult = await disabled.handlers.createMoneyMovement(
      authInfo,
      baseInput(),
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
      baseInput(),
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
