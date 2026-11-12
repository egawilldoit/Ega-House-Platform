import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAuthenticatedActor,
  createDailyCheckinService,
  createExpense,
} from "@ega/application";
import {
  SupabaseDailyCheckinRepository,
  SupabaseExpenseRepository,
  SupabaseMoneyPeriodRepository,
} from "@ega/data-access";
import { EXPENSE_CATEGORY_VALUES } from "@ega/domain/expenses";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

export type McpPersonalOpsWriteDeps = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

export type McpPersonalOpsExpenseCreateInput = Readonly<{
  occurredAt: string;
  amountMinor: number;
  category: string;
  needVsWant: "need" | "want";
  note?: string | null;
  merchant?: string | null;
  paymentMethod?: string | null;
  idempotencyKey: string;
}>;

export type McpPersonalOpsCheckinSaveInput = Readonly<{
  localDate: string;
  timezone: string;
  patch: Record<string, unknown>;
}>;

export type McpPersonalOpsWriteHandlers = {
  createPersonalOpsExpense(
    authInfo: AuthInfo | undefined,
    input: McpPersonalOpsExpenseCreateInput,
    operationId: string,
  ): Promise<CallToolResult>;
  savePersonalOpsCheckin(
    authInfo: AuthInfo | undefined,
    input: McpPersonalOpsCheckinSaveInput,
    operationId: string,
  ): Promise<CallToolResult>;
};

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

/**
 * Personal Operations write tools (PO-13, issue #358). Money writes require
 * the explicit personal_ops.write grant (never inherited from other
 * profiles); revocation is re-validated per call through
 * requireMcpPermission. Expense retries are idempotent via the canonical
 * key+fingerprint ledger; check-ins upsert one owner/local-date row.
 */
export function createMcpPersonalOpsWriteHandlers(
  dependencies: McpPersonalOpsWriteDeps,
): McpPersonalOpsWriteHandlers {
  function clientOf(authInfo: AuthInfo | undefined) {
    const principal = requireMcpPermission(authInfo, "personal_ops.write");
    if (!authInfo?.token) {
      throw new McpToolAuthorizationError(
        "UNAUTHENTICATED",
        "Authentication is required for this tool.",
      );
    }
    return { principal, client: dependencies.createUserClient(authInfo.token) };
  }

  return {
    async createPersonalOpsExpense(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { principal, client } = clientOf(authInfo);
        if (!(EXPENSE_CATEGORY_VALUES as readonly string[]).includes(input.category)) {
          return invalidArgument("Unsupported expense category.");
        }
        if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
          return invalidArgument("Amount must be a positive integer of MAD centimes.");
        }
        if (!input.occurredAt || !input.idempotencyKey) {
          return invalidArgument("occurredAt and idempotencyKey are required.");
        }
        const result = await createExpense(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseExpenseRepository(client as never),
          {
            occurredAt: input.occurredAt,
            amountMinor: input.amountMinor,
            category: input.category as never,
            needVsWant: input.needVsWant,
            note: input.note ?? null,
            merchant: input.merchant ?? null,
            paymentMethod: (input.paymentMethod as never) ?? null,
            idempotencyKey: input.idempotencyKey,
          },
          { periods: new SupabaseMoneyPeriodRepository(client as never) },
        );
        if (!result.ok) {
          return result.code === "conflict"
            ? errorResult({ code: "CONFLICT", message: result.errorMessage })
            : result.code === "validation"
              ? invalidArgument(result.errorMessage)
              : result.code === "forbidden"
                ? errorResult({
                    code: "PERMISSION_DENIED",
                    message:
                      "The stored grant does not allow writing this expense. Re-check the Money writer permission.",
                  })
                : errorResult({ code: "DEPENDENCY_UNAVAILABLE", message: "EGA House data is temporarily unavailable." });
        }
        // Verified receipt: the stored record itself, never an optimistic copy.
        return resultFromPayload({
          ok: true,
          expense: result.data.expense,
          replayed: result.data.replayed,
          operationId,
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({ code: "INTERNAL_ERROR", message: "The MCP tool could not complete the request." });
      }
    },

    async savePersonalOpsCheckin(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { principal, client } = clientOf(authInfo);
        const service = createDailyCheckinService(new SupabaseDailyCheckinRepository(client as never));
        const result = await service.saveDailyCheckin(
          createAuthenticatedActor(principal.ownerUserId),
          {
            localDate: input.localDate,
            timezone: input.timezone,
            patch: (input.patch ?? {}) as never,
          },
        );
        if (!result.ok) {
          return result.code === "forbidden"
            ? errorResult({ code: "PERMISSION_DENIED", message: result.errorMessage })
            : result.code === "validation"
              ? invalidArgument(result.errorMessage)
              : errorResult({ code: "DEPENDENCY_UNAVAILABLE", message: "EGA House data is temporarily unavailable." });
        }
        return resultFromPayload({
          ok: true,
          checkin: result.data.checkin,
          overtimeAdvisory: result.data.overtimeAdvisory,
          operationId,
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return errorResult({ code: error.code, message: error.message });
        }
        return errorResult({ code: "INTERNAL_ERROR", message: "The MCP tool could not complete the request." });
      }
    },
  };
}
