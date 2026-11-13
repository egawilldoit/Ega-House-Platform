// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { createMcpMoneyCloseHandlers, type McpMoneyCloseInput } from "./day-close-handlers";

const mocks = vi.hoisted(() => ({
  closeMoneyDay: vi.fn(),
}));

vi.mock("@ega/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ega/application")>();
  return {
    ...actual,
    closeMoneyDay: mocks.closeMoneyDay,
  };
});

vi.mock("@ega/data-access", () => ({
  SupabaseMoneyPeriodRepository: class {},
  SupabaseMoneyRepository: class {},
}));

const WRITER_PRINCIPAL: McpPrincipal = {
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  oauthClientId: "hermes-client",
  grantId: "10000000-0000-4000-8000-000000000001",
  permissionProfile: "personal_operations_writer",
  permissionsVersion: 1,
  permissions: ["today.read", "timer.read", "personal_ops.read", "personal_ops.write"],
};

const READER_PRINCIPAL: McpPrincipal = {
  ...WRITER_PRINCIPAL,
  permissionProfile: "personal_operations",
  permissions: ["today.read", "timer.read", "personal_ops.read"],
};

const PERIOD = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  startDate: "2026-11-09",
  endDate: "2026-11-30",
  currency: "MAD" as const,
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-30",
  lifecycle: "tracking" as const,
  initialization: "initialized" as const,
  openingMovementId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  provenance: { opening: null, createdFrom: "mcp" as const },
  settings: {},
  version: 4,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-30T00:00:00.000Z",
};

const CLOSE = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  periodId: PERIOD.id,
  closeDate: "2026-11-29",
  status: "closed" as const,
  note: "Closed with chicken",
  operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  closeFingerprint: "a".repeat(64),
  expectedPeriodVersion: 3,
  periodVersionAfter: 4,
  activeDateAfter: "2026-11-30",
  lifecycleAfter: "tracking" as const,
  isFinalDay: false,
  algorithmVersion: "safe-flexible-start-of-day-v1",
  policyVersionId: null,
  policyVersion: null,
  baselineVersion: 1,
  includedMovementIds: [],
  snapshot: {
    currency: "MAD" as const,
    expenseTotalMinor: 1100,
    dailyIncludedSpendMinor: 1100,
    flexibleExpenseTotalMinor: 1100,
    fixedExpenseTotalMinor: 0,
    emergencyExpenseTotalMinor: 0,
    categoryTotals: { coffee: 1100 },
    recordedCashMinor: 48900,
    recordedCashBasis: "recorded" as const,
    dayStartBaseline: {
      date: "2026-11-29",
      version: 1,
      availability: "available" as const,
      policyVersionId: null,
      cashMinor: 50000,
      commitmentsMinor: 0,
      savingsTargetMinor: 0,
      savingsFundedMinor: 0,
      emergencyTargetMinor: 0,
      emergencyUsedMinor: 0,
    },
    dailyReference: {
      available: true as const,
      algorithm: "safe-flexible-start-of-day-v1",
      daysRemaining: 2,
      safePoolMinor: 50000,
      referenceMinor: 25000,
      dailyRemainingMinor: 23900,
    },
    reserves: {
      recordedCashMinor: 48900,
      unpaidCommitmentsMinor: 0,
      savingsTargetMinor: 0,
      fundedSavingsMinor: 0,
      unfundedSavingsMinor: 0,
      emergencyTargetMinor: 0,
      emergencyUsedMinor: 0,
      remainingEmergencyMinor: 0,
      safeFlexibleMinor: 50000,
    },
  },
  createdAt: "2026-11-29T20:00:00.000Z",
};

const INPUT: McpMoneyCloseInput = {
  version: 3,
  operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  note: "Closed with chicken",
  finalPurchases: [
    {
      amountMinor: 1100,
      category: "coffee",
      needVsWant: "want",
      idempotencyKey: "close-purchase-1",
    },
  ],
};

function authInfo(principal: McpPrincipal) {
  return createMcpAuthInfo("token", principal);
}

function handlers() {
  return createMcpMoneyCloseHandlers({
    createUserClient: () => ({}) as never,
  });
}

function structured(result: { structuredContent?: unknown }) {
  return result.structuredContent as Record<string, unknown>;
}

describe("ega_money_close_day", () => {
  beforeEach(() => {
    mocks.closeMoneyDay.mockReset();
  });

  it("requires the explicit Money writer grant", async () => {
    const result = await handlers().closeMoneyDay(authInfo(READER_PRINCIPAL), INPUT);
    expect(result.isError).toBe(true);
    expect(structured(result).error).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(mocks.closeMoneyDay).not.toHaveBeenCalled();
  });

  it("returns the retained close and one advanced active date", async () => {
    mocks.closeMoneyDay.mockResolvedValue({
      ok: true,
      data: {
        close: CLOSE,
        period: PERIOD,
        replayed: false,
        committedPurchases: [],
      },
    });
    const result = await handlers().closeMoneyDay(authInfo(WRITER_PRINCIPAL), INPUT);
    expect(result.isError).toBeUndefined();
    expect(structured(result)).toMatchObject({
      ok: true,
      close: { closeDate: "2026-11-29", activeDateAfter: "2026-11-30" },
      period: { activeDate: "2026-11-30", version: 4 },
      replayed: false,
    });
  });

  it("reports a committed final purchase when a later item failed", async () => {
    mocks.closeMoneyDay.mockResolvedValue({
      ok: false,
      errorMessage: "Final purchase 2 was not recorded: conflict. The day was not closed.",
      code: "conflict",
      reason: "final_purchase_failed",
      failedPurchaseIndex: 1,
      committedPurchases: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }],
    });
    const result = await handlers().closeMoneyDay(authInfo(WRITER_PRINCIPAL), INPUT);
    expect(result.isError).toBe(true);
    expect(structured(result)).toMatchObject({
      ok: false,
      reason: "final_purchase_failed",
      failedPurchaseIndex: 1,
      committedPurchases: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }],
    });
    expect(String(structured(result).recovery)).toContain("already recorded");
  });

  it("rejects a missing operation identity before writing", async () => {
    const result = await handlers().closeMoneyDay(authInfo(WRITER_PRINCIPAL), {
      ...INPUT,
      operationId: "",
    });
    expect(result.isError).toBe(true);
    expect(structured(result).error).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(mocks.closeMoneyDay).not.toHaveBeenCalled();
  });
});

describe("ega_money_close_day recoverable state precondition", () => {
  beforeEach(() => mocks.closeMoneyDay.mockReset());

  it("reports an unavailable baseline as a recoverable state precondition", async () => {
    mocks.closeMoneyDay.mockResolvedValue({
      ok: false,
      errorMessage: "Close needs complete day-start inputs.",
      code: "validation",
      reason: "baseline_unavailable",
    });
    const result = await handlers().closeMoneyDay(authInfo(WRITER_PRINCIPAL), INPUT);
    expect(result.isError).toBe(true);
    expect(structured(result).error).toMatchObject({
      code: "STATE_PRECONDITION_RECOVERABLE",
    });
  });
});
