// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpAuthInfo } from "@/lib/mcp/auth-info";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { createMcpMoneyPeriodHandlers } from "./period-handlers";

const mocks = vi.hoisted(() => ({
  getMoneyState: vi.fn(),
  getCurrentMoneyReserves: vi.fn(),
  createMoneyPeriod: vi.fn(),
  updateMoneySettings: vi.fn(),
  rebaseMoneyDayStartBaseline: vi.fn(),
  timezoneGet: vi.fn(),
}));

vi.mock("@ega/application", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ega/application")>();
  return {
    ...actual,
    getMoneyState: mocks.getMoneyState,
    getCurrentMoneyReserves: mocks.getCurrentMoneyReserves,
    createMoneyPeriod: mocks.createMoneyPeriod,
    updateMoneySettings: mocks.updateMoneySettings,
    rebaseMoneyDayStartBaseline: mocks.rebaseMoneyDayStartBaseline,
  };
});

vi.mock("@ega/data-access", () => ({
  SupabaseMoneyPeriodRepository: class {},
  SupabaseMoneyRepository: class {},
  SupabaseMoneyBudgetRepository: class {},
  SupabaseObligationRepository: class {},
  SupabaseTimeContextRepository: class {
    getTimezone = mocks.timezoneGet;
  },
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

const WORKSPACE_PRINCIPAL: McpPrincipal = {
  ...WRITER_PRINCIPAL,
  permissionProfile: "workspace_manager",
  permissions: ["today.read", "today.update", "timer.read", "timer.create", "timer.update"],
};

const PERIOD = {
  id: "00000000-0000-4000-8000-000000000002",
  startDate: "2026-11-09",
  endDate: "2026-11-30",
  currency: "MAD",
  timezone: "Africa/Casablanca",
  activeDate: "2026-11-11",
  lifecycle: "tracking",
  initialization: "initialized",
  openingMovementId: "00000000-0000-4000-8000-000000000003",
  provenance: {
    opening: {
      source: "user_entered",
      recordedAt: "2026-11-11T10:00:00.000Z",
      cutoffDate: "2026-11-08",
      evidence: null,
      note: null,
      corrections: [],
    },
    createdFrom: "web",
  },
  settings: {},
  version: 2,
  createdAt: "2026-11-11T10:00:00.000Z",
  updatedAt: "2026-11-11T10:00:00.000Z",
} as const;

const STATE = {
  localToday: "2026-11-13",
  timezone: "Africa/Casablanca",
  period: PERIOD,
  opening: {
    status: "known",
    amountMinor: 50000,
    currency: "MAD",
    bookingDate: "2026-11-09",
    version: 1,
    openingMovementId: PERIOD.openingMovementId,
  },
  cash: {
    available: true,
    currency: "MAD",
    basis: "recorded",
    cutoffDate: "2026-11-11",
    openingMinor: 50000,
    inflowsMinor: 0,
    outflowsMinor: 1100,
    recordedCashMinor: 48900,
    recordCount: 1,
  },
  dayStartBaseline: {
    availability: "available",
    unavailableReason: null,
    cashMinor: 48900,
    commitmentsMinor: 0,
    savingsTargetMinor: 0,
    savingsFundedMinor: 0,
    emergencyTargetMinor: 0,
    emergencyUsedMinor: 0,
    dailyReference: { available: true, algorithm: "safe-flexible-start-of-day-v1", daysRemaining: 20, safePoolMinor: 48900, referenceMinor: 2445, dailyIncludedExpenseMinor: 0, dailyRemainingMinor: 2445 },
  },
  dayStartBaselineUnavailable: false,
  dateResolution: {
    localToday: "2026-11-13",
    timezone: "Africa/Casablanca",
    activeDate: "2026-11-11",
    periodTimezone: "Africa/Casablanca",
    datesDiffer: true,
    requestedDate: null,
    requestedMode: null,
    resolvedDate: "2026-11-11",
    basis: "active_day",
    periodRelation: "in_period",
  },
  history: [],
  historyUnavailable: false,
  legacy: {
    available: true,
    totalExpenseCount: 0,
    assignedToPeriodCount: 0,
    inPeriodUnassignedCount: 0,
    bookingDateAssignment: "derived_from_occurred_at_in_owner_timezone",
    reviewRequired: false,
  },
};

function authInfo(principal: McpPrincipal) {
  return createMcpAuthInfo("token-money", principal);
}

function structured(result: { structuredContent?: unknown }) {
  return result.structuredContent as {
    ok: boolean;
    error?: { code: string; message: string };
    [key: string]: unknown;
  };
}

function handlers() {
  return createMcpMoneyPeriodHandlers({
    createUserClient: () => ({} as never),
    now: () => new Date("2026-11-13T12:00:00.000Z"),
  });
}

describe("Money MCP tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rebases day start only for finance writers and returns the canonical baseline", async () => {
    const baseline = { periodId: PERIOD.id, dayStart: "2026-11-13T00:00:00.000Z" };
    mocks.rebaseMoneyDayStartBaseline.mockResolvedValue({ ok: true, data: baseline });
    const h = handlers();
    const denied = await h.rebaseMoneyDayStartBaseline(authInfo(READER_PRINCIPAL), PERIOD.id);
    expect(structured(denied).error?.code).toBe("PERMISSION_DENIED");
    expect(mocks.rebaseMoneyDayStartBaseline).not.toHaveBeenCalled();
    const success = await h.rebaseMoneyDayStartBaseline(authInfo(WRITER_PRINCIPAL), PERIOD.id);
    expect(structured(success)).toMatchObject({ ok: true, baseline });
    expect(mocks.rebaseMoneyDayStartBaseline).toHaveBeenCalledTimes(1);
  });

  it("returns application rebase errors", async () => {
    mocks.rebaseMoneyDayStartBaseline.mockResolvedValue({ ok: false, code: "conflict", errorMessage: "Conflict" });
    const result = await handlers().rebaseMoneyDayStartBaseline(authInfo(WRITER_PRINCIPAL), PERIOD.id);
    expect(structured(result).error?.code).toBe("CONFLICT");
  });

  it("denies state to legacy workspace-only grants and allows explicit readers", async () => {
    mocks.timezoneGet.mockResolvedValue({ ok: true, value: "Africa/Casablanca" });
    mocks.getMoneyState.mockResolvedValue({ ok: true, data: STATE });
    mocks.getCurrentMoneyReserves.mockResolvedValue({ ok: true, data: { available: true, currency: "MAD", cutoffDate: PERIOD.activeDate, reserves: { recordedCashMinor: 48900 } } });
    const h = handlers();

    const denied = await h.moneyState(authInfo(WORKSPACE_PRINCIPAL), {});
    expect(structured(denied).error?.code).toBe("PERMISSION_DENIED");

    const anonymous = await h.moneyState(undefined, {});
    expect(structured(anonymous).error?.code).toBe("UNAUTHENTICATED");

    const allowed = await h.moneyState(authInfo(READER_PRINCIPAL), { mode: "today" });
    expect(structured(allowed).ok).toBe(true);
    expect(structured(allowed).localToday).toBe("2026-11-13");
    expect(structured(allowed).dateResolution).toMatchObject({
      datesDiffer: true,
      activeDate: "2026-11-11",
    });
    expect(structured(allowed).analytics).toMatchObject({
      available: true,
      method: "safe-flexible-start-of-day-v1",
      dayStartBaseline: { dailyReference: { referenceMinor: 2445 } },
      reserves: { available: true, cutoffDate: PERIOD.activeDate },
    });
    expect(mocks.getCurrentMoneyReserves).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ period: PERIOD, opening: STATE.opening }));
  });

  it("labels missing analytics unavailable without inventing values", async () => {
    mocks.timezoneGet.mockResolvedValue({ ok: true, value: "Africa/Casablanca" });
    mocks.getMoneyState.mockResolvedValue({ ok: true, data: {
      ...STATE, dayStartBaseline: null, dayStartBaselineUnavailable: true,
    } });
    mocks.getCurrentMoneyReserves.mockResolvedValue({ ok: true, data: { available: false, currency: "MAD", reason: "reserve_inputs_incomplete", cutoffDate: PERIOD.activeDate } });
    const result = structured(await handlers().moneyState(authInfo(READER_PRINCIPAL), {}));
    expect(result.analytics).toMatchObject({ available: false, reason: "baseline_unavailable", method: "safe-flexible-start-of-day-v1", dayStartBaseline: null, reserves: { available: false, reason: "reserve_inputs_incomplete" } });
  });

  it("explains incomplete initial setup and the explicit completion step", async () => {
    mocks.timezoneGet.mockResolvedValue({ ok: true, value: "Africa/Casablanca" });
    mocks.getMoneyState.mockResolvedValue({ ok: true, data: {
      ...STATE,
      dayStartBaseline: { ...STATE.dayStartBaseline, availability: "unavailable", unavailableReason: "initial_setup_incomplete", dailyReference: null },
      dayStartBaselineUnavailable: true,
    } });
    mocks.getCurrentMoneyReserves.mockResolvedValue({ ok: true, data: { available: false, currency: "MAD", reason: "reserve_inputs_incomplete", cutoffDate: PERIOD.activeDate } });
    const result = structured(await handlers().moneyState(authInfo(READER_PRINCIPAL), {}));
    expect(result.analytics).toMatchObject({ setupComplete: false, setupNextStep: expect.stringContaining("ega_money_rebase_day_start_baseline") });
    expect(result.analytics).toMatchObject({ available: false, reason: "baseline_unavailable", dayStartBaseline: { unavailableReason: "initial_setup_incomplete" } });
  });

  it("passes the explicit today/active-day mode and owner timezone to the shared use case", async () => {
    mocks.timezoneGet.mockResolvedValue({ ok: true, value: "Africa/Casablanca" });
    mocks.getMoneyState.mockResolvedValue({ ok: true, data: STATE });
    await handlers().moneyState(authInfo(READER_PRINCIPAL), {
      date: "2026-11-12",
      periodId: PERIOD.id,
    });

    const [, , query, options] = mocks.getMoneyState.mock.calls.at(-1)!;
    expect(query).toEqual({
      periodId: PERIOD.id,
      date: "2026-11-12",
      mode: undefined,
    });
    expect(options.timezone).toBe("Africa/Casablanca");
    expect(options.now).toBeInstanceOf(Date);
  });

  it("requires the write grant for settings and never auto-upgrades readers/workspace", async () => {
    const h = handlers();
    const input = { operationId: "op-1", version: 2, activeDate: "2026-11-10" };

    expect(
      structured(await h.updateMoneySettings(authInfo(READER_PRINCIPAL), input, "op-1")).error?.code,
    ).toBe("PERMISSION_DENIED");
    expect(
      structured(await h.updateMoneySettings(authInfo(WORKSPACE_PRINCIPAL), input, "op-1")).error?.code,
    ).toBe("PERMISSION_DENIED");
    expect(
      structured(await h.updateMoneySettings(undefined, input, "op-1")).error?.code,
    ).toBe("UNAUTHENTICATED");
  });

  it("updates the tracking period with expected version and maps validation/conflict", async () => {
    mocks.timezoneGet.mockResolvedValue({ ok: true, value: "Africa/Casablanca" });
    mocks.updateMoneySettings.mockResolvedValue({ ok: true, data: { ...PERIOD, activeDate: "2026-11-10" } });
    const h = handlers();

    const ok = await h.updateMoneySettings(
      authInfo(WRITER_PRINCIPAL),
      { operationId: "op-2", version: 2, activeDate: "2026-11-10" },
      "op-2",
    );
    expect(structured(ok).ok).toBe(true);
    expect(structured(ok).operationId).toBe("op-2");
    const [, , periodId, patch, options] = mocks.updateMoneySettings.mock.calls[0];
    expect(periodId).toBeUndefined();
    expect(patch).toEqual({ version: 2, activeDate: "2026-11-10" });
    expect(options.timezone).toBe("Africa/Casablanca");

    mocks.updateMoneySettings.mockResolvedValue({
      ok: false,
      code: "conflict",
      errorMessage: "The period changed.",
    });
    const conflict = await h.updateMoneySettings(
      authInfo(WRITER_PRINCIPAL),
      { operationId: "op-3", version: 1, activeDate: "2026-11-10" },
      "op-3",
    );
    expect(structured(conflict).error?.code).toBe("CONFLICT");

    mocks.updateMoneySettings.mockResolvedValue({
      ok: false,
      code: "validation",
      errorMessage: "Outside the period.",
    });
    const invalid = await h.updateMoneySettings(
      authInfo(WRITER_PRINCIPAL),
      { operationId: "op-4", version: 2, activeDate: "2026-12-10" },
      "op-4",
    );
    expect(structured(invalid).error?.code).toBe("INVALID_ARGUMENT");
  });

  it("creates a period when boundaries are supplied, including a known zero opening", async () => {
    mocks.timezoneGet.mockResolvedValue({ ok: true, value: "Africa/Casablanca" });
    mocks.createMoneyPeriod.mockResolvedValue({
      ok: true,
      data: { period: PERIOD, replayed: false },
    });
    const h = handlers();
    const result = await h.updateMoneySettings(
      authInfo(WRITER_PRINCIPAL),
      {
        operationId: "op-5",
        startDate: "2026-11-09",
        endDate: "2026-11-30",
        opening: { amountMinor: 0, source: "user_entered" },
      },
      "op-5",
    );

    expect(structured(result).ok).toBe(true);
    expect(structured(result).replayed).toBe(false);
    const [, , body, options] = mocks.createMoneyPeriod.mock.calls[0];
    expect(body).toMatchObject({
      startDate: "2026-11-09",
      endDate: "2026-11-30",
      opening: {
        amountMinor: 0,
        source: "user_entered",
        cutoffDate: null,
        evidence: null,
        note: null,
      },
    });
    expect(options.surface).toBe("mcp");
    expect(mocks.updateMoneySettings).not.toHaveBeenCalled();
  });

  it("requires both boundaries for creation and an operation id for every write", async () => {
    const h = handlers();
    const missingEnd = await h.updateMoneySettings(
      authInfo(WRITER_PRINCIPAL),
      { operationId: "op-6", startDate: "2026-11-09" },
      "op-6",
    );
    expect(structured(missingEnd).error?.code).toBe("INVALID_ARGUMENT");

    const missingOperation = await h.updateMoneySettings(
      authInfo(WRITER_PRINCIPAL),
      { operationId: "", version: 1, activeDate: "2026-11-10" },
      "",
    );
    expect(structured(missingOperation).error?.code).toBe("INVALID_ARGUMENT");
  });
});
