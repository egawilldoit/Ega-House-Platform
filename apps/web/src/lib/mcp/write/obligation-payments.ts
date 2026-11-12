import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  correctObligationPayment,
  createAuthenticatedActor,
  payObligation,
  undoObligationPayment,
} from "@ega/application";
import {
  SupabaseObligationPaymentRepository,
  SupabaseObligationRepository,
} from "@ega/data-access";
import type { ExpenseNeedVsWant } from "@ega/domain/expenses";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

/**
 * MONEY-07 MCP payment tools.
 *
 * A payment, its correction and its undo are single database transactions, so
 * the ledger and the obligation can never disagree. The operation id is the
 * retry identity: the same operation replays the original receipt and a
 * different operation cannot pay an already-paid occurrence twice.
 */

export type McpObligationWriteDeps = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

export type McpObligationPayInput = Readonly<{
  obligationId: string;
  version: number;
  bookingDate: string;
  needVsWant?: ExpenseNeedVsWant | null;
  countsInDaily?: boolean | null;
  paymentMethod?: string | null;
}>;

export type McpObligationCorrectPaymentInput = Readonly<{
  obligationId: string;
  version: number;
  amountMinor: number;
  bookingDate: string;
  countsInDaily?: boolean | null;
}>;

export type McpObligationUndoPaymentInput = Readonly<{
  obligationId: string;
  version: number;
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

/**
 * Map an application failure onto the MCP tool vocabulary without claiming a
 * write succeeded.
 */
function failure(code: string | undefined, message: string): CallToolResult {
  switch (code) {
    case "validation":
      return invalidArgument(message);
    case "notFound":
      return errorResult({ code: "NOT_FOUND", message });
    case "conflict":
      return errorResult({ code: "CONFLICT", message });
    case "forbidden":
      return errorResult({
        code: "PERMISSION_DENIED",
        message:
          "The stored grant does not allow changing Money obligations. Re-check the Money writer permission.",
      });
    default:
      return errorResult({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "EGA House data is temporarily unavailable.",
      });
  }
}

export function createMcpObligationPaymentWriteHandlers(
  dependencies: McpObligationWriteDeps,
) {
  function context(authInfo: AuthInfo | undefined) {
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
      dependencies: {
        obligations: new SupabaseObligationRepository(client as never),
        payments: new SupabaseObligationPaymentRepository(client as never),
      },
    };
  }

  return {
    async payObligation(
      authInfo: AuthInfo | undefined,
      input: McpObligationPayInput,
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, dependencies } = context(authInfo);
        const result = await payObligation(
          actor,
          dependencies,
          input.obligationId,
          {
            version: input.version,
            bookingDate: input.bookingDate,
            // The ledger receipt key follows the operation, so a repeated
            // operation can never create a second payment row.
            idempotencyKey: `obligation-payment:${operationId}`,
            ...(input.needVsWant !== undefined
              ? { needVsWant: input.needVsWant }
              : {}),
            ...(input.countsInDaily !== undefined
              ? { countsInDaily: input.countsInDaily }
              : {}),
            ...(input.paymentMethod !== undefined
              ? { paymentMethod: input.paymentMethod }
              : {}),
          },
          { operationId },
        );
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          obligation: result.data.occurrence,
          payment: result.data.payment,
          replayed: result.data.replayed,
          operationId,
          cashEffect: "expense_outflow",
          note: "One ledger outflow and one obligation settlement were committed together.",
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

    async correctObligationPayment(
      authInfo: AuthInfo | undefined,
      input: McpObligationCorrectPaymentInput,
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, dependencies } = context(authInfo);
        const result = await correctObligationPayment(
          actor,
          dependencies,
          input.obligationId,
          {
            version: input.version,
            amountMinor: input.amountMinor,
            bookingDate: input.bookingDate,
            ...(input.countsInDaily !== undefined
              ? { countsInDaily: input.countsInDaily }
              : {}),
          },
          { operationId },
        );
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          obligation: result.data.occurrence,
          payment: result.data.payment,
          replayed: result.data.replayed,
          operationId,
          cashEffect: "expense_outflow",
          note: "The linked ledger payment and the obligation were corrected together.",
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

    async undoObligationPayment(
      authInfo: AuthInfo | undefined,
      input: McpObligationUndoPaymentInput,
      operationId: string,
    ): Promise<CallToolResult> {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { actor, dependencies } = context(authInfo);
        const result = await undoObligationPayment(
          actor,
          dependencies,
          input.obligationId,
          { version: input.version },
          { operationId },
        );
        if (!result.ok) return failure(result.code, result.errorMessage);
        return resultFromPayload({
          ok: true,
          obligation: result.data.occurrence,
          payment: result.data.payment,
          replayed: result.data.replayed,
          operationId,
          cashEffect: "expense_outflow_reversed",
          note: "The ledger outflow was removed and the obligation reopened in one transaction.",
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
