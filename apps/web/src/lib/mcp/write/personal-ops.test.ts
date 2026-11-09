// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { createMcpPersonalOpsWriteHandlers } from "./personal-ops";

const mocks = vi.hoisted(() => ({
  createExpense: vi.fn(),
  saveDailyCheckin: vi.fn(),
  expenseRepositoryFactory: vi.fn(),
  checkinServiceFactory: vi.fn(),
}));

vi.mock("@ega/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ega/application")>();
  return {
    ...actual,
    createExpense: mocks.createExpense,
    createDailyCheckinService: mocks.checkinServiceFactory,
  };
});

vi.mock("@ega/data-access", () => ({
  SupabaseExpenseRepository: mocks.expenseRepositoryFactory,
  SupabaseDailyCheckinRepository: mocks.expenseRepositoryFactory,
}));

const WRITER_PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-0000-0000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-0000-0000-000000000001",
  permissionProfile: "personal_operations_writer",
  permissionsVersion: 1,
  permissions: ["today.read", "timer.read", "personal_ops.read", "personal_ops.write"],
};

const READ_ONLY_PRINCIPAL: McpPrincipal = {
  ...WRITER_PRINCIPAL,
  permissionProfile: "personal_operations",
  permissions: ["today.read", "timer.read", "personal_ops.read"],
};

const WORKSPACE_PRINCIPAL: McpPrincipal = {
  ...WRITER_PRINCIPAL,
  permissionProfile: "workspace_manager",
  permissions: ["today.read", "today.update", "timer.read", "timer.create", "timer.update"],
};

function authInfo(principal: McpPrincipal) {
  return createMcpAuthInfo("token-abc", principal);
}

function handlers() {
  return createMcpPersonalOpsWriteHandlers({
    createUserClient: () => ({} as never),
  });
}

function structured(result: { structuredContent?: unknown }) {
  return result.structuredContent as { ok: boolean; error?: { code: string; message: string } };
}

const EXPENSE_INPUT = {
  occurredAt: "2026-11-08T10:00:00.000Z",
  amountMinor: 2200,
  category: "coffee",
  needVsWant: "want" as const,
  idempotencyKey: "key-1",
};

describe("personal-ops write tools", () => {
  it("denies expense/check-in writes for read-only, auto-upgraded and anonymous callers", async () => {
    const h = handlers();

    // personal_operations (read) must never mutate.
    const readOnly = await h.createPersonalOpsExpense(
      authInfo(READ_ONLY_PRINCIPAL),
      EXPENSE_INPUT,
      "operation-1",
    );
    expect(structured(readOnly).error?.code).toBe("PERMISSION_DENIED");

    // workspace_manager (legacy) must NOT silently gain finance writes.
    const workspace = await h.createPersonalOpsExpense(
      authInfo(WORKSPACE_PRINCIPAL),
      EXPENSE_INPUT,
      "operation-1",
    );
    expect(structured(workspace).error?.code).toBe("PERMISSION_DENIED");

    const anonymous = await h.createPersonalOpsExpense(undefined, EXPENSE_INPUT, "operation-1");
    expect(structured(anonymous).error?.code).toBe("UNAUTHENTICATED");

    const checkinDenied = await h.savePersonalOpsCheckin(
      authInfo(READ_ONLY_PRINCIPAL),
      { localDate: "2026-11-08", timezone: "Africa/Casablanca", patch: { outcomes: "x" } },
      "operation-1",
    );
    expect(structured(checkinDenied).error?.code).toBe("PERMISSION_DENIED");

    expect(mocks.createExpense).not.toHaveBeenCalled();
  });

  it("creates once per idempotency key and returns the verified receipt", async () => {
    mocks.createExpense.mockResolvedValue({
      ok: true,
      data: {
        expense: {
          id: "aaaaaaaa-0000-0000-0000-000000000001",
          occurredAt: EXPENSE_INPUT.occurredAt,
          amountMinor: 2200,
          currency: "MAD",
          category: "coffee",
          idempotencyKey: "key-1",
        },
        replayed: false,
      },
    });
    const h = handlers();
    const created = await h.createPersonalOpsExpense(
      authInfo(WRITER_PRINCIPAL),
      EXPENSE_INPUT,
      "operation-1",
    );
    expect(structured(created).ok).toBe(true);
    expect((structured(created) as { replayed?: boolean }).replayed).toBe(false);
    expect(mocks.createExpense).toHaveBeenCalledTimes(1);
    // The canonical owner is the principal, never a caller-supplied id.
    expect(mocks.createExpense.mock.calls[0]?.[0]).toEqual({
      userId: WRITER_PRINCIPAL.ownerUserId,
    });
  });

  it("maps conflicting replays to CONFLICT and validation to INVALID_ARGUMENT", async () => {
    mocks.createExpense.mockResolvedValue({
      ok: false,
      code: "conflict",
      errorMessage: "That idempotency key was already used for a different expense.",
    });
    const h = handlers();
    const conflict = await h.createPersonalOpsExpense(
      authInfo(WRITER_PRINCIPAL),
      EXPENSE_INPUT,
      "operation-1",
    );
    expect(structured(conflict).error?.code).toBe("CONFLICT");

    const invalid = await h.createPersonalOpsExpense(
      authInfo(WRITER_PRINCIPAL),
      { ...EXPENSE_INPUT, category: "crypto" },
      "operation-1",
    );
    expect(structured(invalid).error?.code).toBe("INVALID_ARGUMENT");
  });
});
