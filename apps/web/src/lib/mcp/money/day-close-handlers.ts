import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  closeMoneyDay,
  createAuthenticatedActor,
  type CloseMoneyDayResult,
} from "@ega/application";
import {
  SupabaseMoneyPeriodRepository,
  SupabaseMoneyRepository,
} from "@ega/data-access";
import type {
  ExpenseCategory,
  ExpenseNeedVsWant,
  ExpensePaymentMethod,
} from "@ega/domain/expenses";
import type { MoneyPurpose } from "@ega/domain/money";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

/**
 * MONEY-09 MCP day-close tool.
 *
 * The tool composes the same application close use case as the Money page and
 * HTTP route. Final purchases are recorded with stable ids before the atomic
 * close transition; if one fails, the payload reports the purchases that are
 * already committed so the caller can reconcile rather than guess.
 */

export type McpMoneyCloseDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

export type McpMoneyCloseFinalPurchase = Readonly<{
  amountMinor: number;
  category: ExpenseCategory;
  note?: string | null;
  merchant?: string | null;
  needVsWant: ExpenseNeedVsWant;
  paymentMethod?: ExpensePaymentMethod | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean;
  idempotencyKey: string;
}>;

export type McpMoneyCloseInput = Readonly<{
  version: number;
  periodId?: string;
  date?: string;
  note?: string | null;
  operationId: string;
  finalPurchases?: readonly McpMoneyCloseFinalPurchase[];
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

function mapFailure(result: Extract<CloseMoneyDayResult, { ok: false }>): CallToolResult {
  // A partially recorded close is explicitly recoverable: the committed
  // purchases keep their stable keys, so retrying with the same operation must
  // reach the handler instead of being fenced as a permanent failure.
  const code =
    result.reason === "final_purchase_failed"
      ? "PARTIAL_WRITE_RECOVERABLE"
      : result.reason === "baseline_unavailable" ||
          result.reason === "opening_unknown" ||
          result.reason === "included_movement_invalid"
        ? "STATE_PRECONDITION_RECOVERABLE"
        : result.code === "validation"
          ? "INVALID_ARGUMENT"
          : result.code === "notFound"
            ? "NOT_FOUND"
            : result.code === "conflict"
              ? "CONFLICT"
              : result.code === "forbidden"
                ? "PERMISSION_DENIED"
                : "DEPENDENCY_UNAVAILABLE";
  return {
    ...resultFromPayload({
      ok: false,
      error: { code, message: result.errorMessage },
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.failedPurchaseIndex === undefined
        ? {}
        : { failedPurchaseIndex: result.failedPurchaseIndex }),
      ...(result.committedPurchases && result.committedPurchases.length > 0
        ? {
            committedPurchases: result.committedPurchases,
            recovery:
              "These final purchases are already recorded. Retry with the same idempotency keys and close the day again; do not record them as new purchases.",
          }
        : {}),
    }),
    isError: true,
  };
}

export function createMcpMoneyCloseHandlers(
  dependencies: McpMoneyCloseDependencies,
) {  function context(authInfo: AuthInfo | undefined) {
    const principal = requireMcpPermission(authInfo, "personal_ops.write");
    if (!authInfo?.token) {
      throw new McpToolAuthorizationError(
        "UNAUTHENTICATED",
        "Authentication is required for this tool.",
      );
    }
    const client = dependencies.createUserClient(authInfo.token);
    return {
      actor: createAuthenticatedActor(principal.ownerUserId),
      periods: new SupabaseMoneyPeriodRepository(client as never),
      movements: new SupabaseMoneyRepository(client as never),
    };
  }

  return {
    async closeMoneyDay(
      authInfo: AuthInfo | undefined,
      input: McpMoneyCloseInput,
    ): Promise<CallToolResult> {
      try {
        if (!input.operationId) {
          return invalidArgument("An operation id is required.");
        }
        const { actor, periods, movements } = context(authInfo);
        const result = await closeMoneyDay(
          actor,
          { periods, movements },
          {
            version: input.version,
            ...(input.periodId === undefined ? {} : { periodId: input.periodId }),
            ...(input.date === undefined ? {} : { date: input.date }),
            note: input.note ?? null,
            operationId: input.operationId,
            finalPurchases: (input.finalPurchases ?? []).map((purchase) => ({
              amountMinor: purchase.amountMinor,
              category: purchase.category,
              note: purchase.note ?? null,
              merchant: purchase.merchant ?? null,
              needVsWant: purchase.needVsWant,
              paymentMethod: purchase.paymentMethod ?? null,
              purpose: purchase.purpose ?? null,
              countsInDaily: purchase.countsInDaily ?? null,
              idempotencyKey: purchase.idempotencyKey,
            })),
          },
        );
        if (!result.ok) return mapFailure(result);
        return resultFromPayload({
          ok: true,
          close: result.data.close,
          period: result.data.period,
          replayed: result.data.replayed,
          committedPurchases: result.data.committedPurchases,
          operationId: input.operationId,
          note:
            "One CLOSED snapshot was stored and the active date advanced exactly once. The next day shows only its own recorded entries; budgets and savings policy were not changed.",
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
  };
}

export type McpMoneyCloseHandlers = ReturnType<typeof createMcpMoneyCloseHandlers>;
