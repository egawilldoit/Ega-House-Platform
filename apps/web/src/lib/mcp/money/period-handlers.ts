import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAuthenticatedActor,
  createMoneyPeriod,
  getCurrentMoneyReserves,
  getMoneyRolloverPreviewForPeriod,
  getMoneyState,
  listMoneyRolloverBridges,
  rebaseMoneyDayStartBaseline,
  rolloverMoneyPeriod,
  updateMoneySettings,
} from "@ega/application";
import {
  SupabaseMoneyPeriodRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyRolloverRepository,
  SupabaseObligationRepository,
  SupabaseTimeContextRepository,
} from "@ega/data-access";
import type { MoneyOpeningInput } from "@ega/domain/money";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

export type McpMoneyPeriodDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  now?: () => Date;
};

export type McpMoneyStateInput = Readonly<{
  periodId?: string;
  date?: string;
  mode?: "today" | "active_day";
}>;

export type McpMoneyOpeningInput = Readonly<{
  amountMinor: number;
  source: "user_entered" | "carry_forward" | "verified_source";
  cutoffDate?: string | null;
  evidence?: string | null;
  note?: string | null;
}>;

export type McpMoneyUpdateSettingsInput = Readonly<{
  operationId: string;
  periodId?: string;
  version?: number;
  startDate?: string;
  endDate?: string;
  timezone?: string;
  activeDate?: string;
  opening?: McpMoneyOpeningInput | null;
  settings?: Record<string, unknown>;
}>;

export type McpMoneyPeriodHandlers = {
  moneyState(
    authInfo: AuthInfo | undefined,
    input: McpMoneyStateInput,
  ): Promise<CallToolResult>;
  updateMoneySettings(
    authInfo: AuthInfo | undefined,
    input: McpMoneyUpdateSettingsInput,
    operationId: string,
  ): Promise<CallToolResult>;
  rebaseMoneyDayStartBaseline(authInfo: AuthInfo | undefined, periodId: string): Promise<CallToolResult>;
  /** MONEY-10 rollover preview for one finished source period. */
  moneyRolloverPreview(
    authInfo: AuthInfo | undefined,
    periodId: string,
  ): Promise<CallToolResult>;
  /**
   * MONEY-10 historical correction variances that targeted one period,
   * including a tracking successor with an explicit completeness disclosure.
   */
  moneyRolloverVariances(
    authInfo: AuthInfo | undefined,
    periodId: string,
  ): Promise<CallToolResult>;
  /** MONEY-10 explicit rollover write. */
  rolloverMoneyPeriod(
    authInfo: AuthInfo | undefined,
    input: McpMoneyRolloverInput,
  ): Promise<CallToolResult>;
};

export type McpMoneyRolloverInput = Readonly<{
  operationId: string;
  periodId: string;
  expectedVersion: number;
  startDate: string;
  endDate: string;
  opening:
    | { mode: "carry_forward" }
    | {
        mode: "verified_source";
        amountMinor: number;
        cutoffDate: string;
        evidence: string;
        note?: string | null;
      };
  unpaidItems?: {
    treatment: "keep_pending" | "carry_forward" | "cancel";
    reason?: string | null;
  } | null;
  settingsOverrides?: Record<string, unknown> | null;
  allowUncoveredDays?: boolean;
  acceptClosingDifferenceNote?: string | null;
}>;

type ToolPayload = {
  ok: boolean;
  error?: { code: string; message: string };
  [key: string]: unknown;
};

function resultFromPayload(payload: ToolPayload): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(error: { code: string; message: string }): CallToolResult {
  return { ...resultFromPayload({ ok: false, error }), isError: true };
}

function invalidArgument(message: string): CallToolResult {
  return errorResult({ code: "INVALID_ARGUMENT", message });
}

function mapApplicationError(result: {
  code?: "validation" | "notFound" | "conflict" | "forbidden" | "unknown";
  errorMessage: string;
}): CallToolResult {
  if (result.code === "validation") return invalidArgument(result.errorMessage);
  if (result.code === "notFound") {
    return errorResult({ code: "NOT_FOUND", message: result.errorMessage });
  }
  if (result.code === "conflict") {
    return errorResult({ code: "CONFLICT", message: result.errorMessage });
  }
  if (result.code === "forbidden") {
    return errorResult({
      code: "PERMISSION_DENIED",
      message:
        "The stored grant does not allow this Money change. Re-check the Money writer permission.",
    });
  }
  return errorResult({
    code: "DEPENDENCY_UNAVAILABLE",
    message: "EGA House money data is temporarily unavailable.",
  });
}

function toOpeningInput(
  opening: McpMoneyOpeningInput | null | undefined,
): MoneyOpeningInput | undefined {
  if (!opening) return undefined;
  return {
    amountMinor: opening.amountMinor,
    source: opening.source,
    cutoffDate: opening.cutoffDate ?? null,
    evidence: opening.evidence ?? null,
    note: opening.note ?? null,
  };
}

/**
 * Money MCP tools (MONEY-03). Reads need `personal_ops.read`; writes need the
 * explicit `personal_ops.write` grant, re-validated per call. Both compose the
 * same application use cases as the web surface; no second period/opening
 * owner or calculation is introduced here.
 */
export function createMcpMoneyPeriodHandlers(
  dependencies: McpMoneyPeriodDependencies,
): McpMoneyPeriodHandlers {
  function contextOf(authInfo: AuthInfo | undefined, permission: "personal_ops.read" | "personal_ops.write") {
    const principal = requireMcpPermission(authInfo, permission);
    if (!authInfo?.token) {
      throw new McpToolAuthorizationError(
        "UNAUTHENTICATED",
        "Authentication is required for this tool.",
      );
    }
    const client = dependencies.createUserClient(authInfo.token);
    return {
      principal,
      client,
      actor: createAuthenticatedActor(principal.ownerUserId),
      now: dependencies.now?.() ?? new Date(),
    };
  }

  async function resolveOwnerTimezone(
    client: SupabaseClient<McpDatabase>,
    actor: ReturnType<typeof createAuthenticatedActor>,
  ): Promise<string | null> {
    const result = await new SupabaseTimeContextRepository(client as never).getTimezone(
      actor,
    );
    if (!result.ok) {
      throw new Error("Failed to load EGA time context.");
    }
    return result.value;
  }

  return {
    async moneyState(authInfo, input) {
      try {
        const { actor, client, now } = contextOf(authInfo, "personal_ops.read");
        const timezone = await resolveOwnerTimezone(client, actor);
        const result = await getMoneyState(
          actor,
          new SupabaseMoneyPeriodRepository(client as never),
          {
            periodId: input.periodId,
            date: input.date,
            mode: input.mode,
          },
          { now, timezone },
        );
        if (!result.ok) return mapApplicationError(result);
        const state = result.data;
        const reserveResult = state.period
          ? await getCurrentMoneyReserves(actor, {
              period: state.period,
              periods: new SupabaseMoneyPeriodRepository(client as never),
              budgets: new SupabaseMoneyBudgetRepository(client as never),
            })
          : null;
        const reserves = reserveResult?.ok
          ? reserveResult.data
          : { available: false as const, currency: "MAD" as const, reason: "reserve_inputs_incomplete", cutoffDate: state.period?.activeDate ?? now.toISOString().slice(0, 10) };
        return resultFromPayload({
          ok: true,
          ...state,
          analytics: {
            dayStartBaseline: state.dayStartBaseline,
            setupComplete: state.dayStartBaseline
              ? state.dayStartBaseline.unavailableReason !== "initial_setup_incomplete"
              : null,
            setupNextStep: state.dayStartBaseline?.unavailableReason === "initial_setup_incomplete"
              ? "Add initial obligations, then explicitly call ega_money_rebase_day_start_baseline to complete setup and record the baseline. An empty obligation list is valid if there are none."
              : null,
            available: state.dayStartBaseline?.dailyReference?.available === true,
            historical: state.dayStartBaseline?.dailyReference?.historical === true,
            allowanceAvailable: state.dayStartBaseline?.dailyReference?.allowanceAvailable === true,
            reason: state.dayStartBaselineUnavailable
              ? "baseline_unavailable"
              : state.dayStartBaseline?.dailyReference && !state.dayStartBaseline.dailyReference.available
                ? state.dayStartBaseline.dailyReference.reason
                : null,
            method: state.dayStartBaseline?.dailyReference?.available
              ? state.dayStartBaseline.dailyReference.algorithm
              : "safe-flexible-start-of-day-v1",
            reserves,
          },
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "DEPENDENCY_UNAVAILABLE",
          message: "EGA House money state is temporarily unavailable.",
        });
      }
    },

    async updateMoneySettings(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, client, now } = contextOf(authInfo, "personal_ops.write");
        const timezone = await resolveOwnerTimezone(client, actor);
        const repository = new SupabaseMoneyPeriodRepository(client as never);
        const opening = toOpeningInput(input.opening);

        const wantsCreate =
          input.periodId === undefined &&
          (input.startDate !== undefined || input.endDate !== undefined);

        if (wantsCreate) {
          if (!input.startDate || !input.endDate) {
            return invalidArgument(
              "Creating a period requires both startDate and endDate.",
            );
          }
          const createInput: Record<string, unknown> = {
            startDate: input.startDate,
            endDate: input.endDate,
            timezone: input.timezone ?? timezone ?? undefined,
            settings: input.settings,
          };
          if (input.activeDate !== undefined) createInput.activeDate = input.activeDate;
          if (input.opening !== undefined) createInput.opening = opening ?? null;

          const result = await createMoneyPeriod(actor, repository, createInput, {
            now,
            timezone,
            surface: "mcp",
          });
          if (!result.ok) return mapApplicationError(result);
          return resultFromPayload({
            ok: true,
            period: result.data.period,
            replayed: result.data.replayed,
            operationId,
          });
        }

        const patch: Record<string, unknown> = {};
        if (input.version !== undefined) patch.version = input.version;
        if (input.activeDate !== undefined) patch.activeDate = input.activeDate;
        if (input.opening !== undefined) patch.opening = opening;
        if (input.settings !== undefined) patch.settings = input.settings;

        const result = await updateMoneySettings(
          actor,
          repository,
          input.periodId,
          patch,
          { now, timezone },
        );
        if (!result.ok) return mapApplicationError(result);
        return resultFromPayload({
          ok: true,
          period: result.data,
          operationId,
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "INTERNAL_ERROR",
          message: "The MCP tool could not complete the request.",
        });
      }
    },

    async rebaseMoneyDayStartBaseline(authInfo, periodId) {
      try {
        const { actor, client } = contextOf(authInfo, "personal_ops.write");
        const result = await rebaseMoneyDayStartBaseline(
          actor,
          new SupabaseMoneyPeriodRepository(client as never),
          periodId,
        );
        if (!result.ok) return mapApplicationError(result);
        return resultFromPayload({ ok: true, baseline: result.data });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({ code: "INTERNAL_ERROR", message: "The MCP tool could not complete the request." });
      }
    },

    async moneyRolloverPreview(authInfo, periodId) {
      try {
        const { actor, client, now } = contextOf(authInfo, "personal_ops.read");
        const timezone = await resolveOwnerTimezone(client, actor);
        const result = await getMoneyRolloverPreviewForPeriod(
          actor,
          {
            repository: new SupabaseMoneyRolloverRepository(client as never),
            obligations: new SupabaseObligationRepository(client as never),
          },
          periodId,
          { now, timezone },
        );
        if (!result.ok) return mapApplicationError(result);
        return resultFromPayload({ ok: true, ...result.data });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "DEPENDENCY_UNAVAILABLE",
          message: "The rollover preview is temporarily unavailable.",
        });
      }
    },

    async moneyRolloverVariances(authInfo, periodId) {
      try {
        const { actor, client } = contextOf(authInfo, "personal_ops.read");
        const result = await listMoneyRolloverBridges(
          actor,
          new SupabaseMoneyRolloverRepository(client as never),
          periodId,
        );
        if (!result.ok) return mapApplicationError(result);
        const bridges = result.data.bridges;
        return resultFromPayload({
          ok: true,
          periodId,
          currency: "MAD",
          bridges,
          count: bridges.length,
          appliedAdjustmentCount: bridges.filter((bridge) => bridge.applied)
            .length,
          varianceCount: bridges.filter((bridge) => !bridge.applied).length,
          complete: !result.data.truncated,
          truncated: result.data.truncated,
          note: result.data.truncated
            ? "The bounded variance read returned only part of this period's correction history. Do not treat the list as complete or as proof that no variance exists."
            : "All correction bridges that targeted this period are included. Variance rows stopped at an independently verified opening and did not alter it.",
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Historical rollover variances are temporarily unavailable.",
        });
      }
    },

    async rolloverMoneyPeriod(authInfo, input) {
      try {
        if (!input.operationId) return invalidArgument("An operation id is required.");
        const { actor, client, now } = contextOf(authInfo, "personal_ops.write");
        const timezone = await resolveOwnerTimezone(client, actor);
        const result = await rolloverMoneyPeriod(
          actor,
          {
            repository: new SupabaseMoneyRolloverRepository(client as never),
            obligations: new SupabaseObligationRepository(client as never),
          },
          {
            sourcePeriodId: input.periodId,
            expectedVersion: input.expectedVersion,
            startDate: input.startDate,
            endDate: input.endDate,
            opening: input.opening,
            unpaidItems: input.unpaidItems ?? null,
            settingsOverrides: input.settingsOverrides ?? null,
            allowUncoveredDays: input.allowUncoveredDays ?? false,
            acceptClosingDifferenceNote:
              input.acceptClosingDifferenceNote ?? null,
          },
          input.operationId,
          { now, timezone, surface: "mcp" },
        );
        if (!result.ok) return mapApplicationError(result);
        return resultFromPayload({
          ok: true,
          record: result.data.record,
          replayed: result.data.replayed,
          reconciliation: result.data.reconciliation,
          weekWindows: result.data.weekWindows,
          operationId: input.operationId,
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({
          code: "INTERNAL_ERROR",
          message: "The MCP tool could not complete the rollover.",
        });
      }
    },
  };
}
