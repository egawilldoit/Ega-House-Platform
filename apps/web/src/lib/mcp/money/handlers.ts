import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAuthenticatedActor,
  createMovement,
  getMoneyState,
  listMovements,
  updateMovement,
} from "@ega/application";
import { SupabaseMoneyRepository } from "@ega/data-access";
import type { MoneyKind } from "@ega/domain/money";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

export type McpMoneyDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

export type McpMoneyStateInput = Readonly<{
  cutoff?: string;
  timezone?: string;
}>;

export type McpMoneyLedgerListInput = Readonly<{
  from?: string;
  to?: string;
  cutoff?: string;
  timezone?: string;
  kind?: string;
  limit?: number;
}>;

export type McpMoneyCreateMovementInput = Readonly<{
  kind: Exclude<MoneyKind, "opening">;
  direction?: "in" | "out";
  amountMinor: number;
  category?: string | null;
  note?: string | null;
  merchant?: string | null;
  needVsWant?: "need" | "want" | null;
  paymentMethod?: string | null;
  purpose?: "fixed" | "flexible" | "emergency" | null;
  countsInDaily?: boolean;
  bookingDate?: string;
  occurredAt?: string | null;
  idempotencyKey: string;
  operationId: string;
}>;

export type McpMoneyUpdateMovementInput = Readonly<{
  movementId: string;
  version: number;
  bookingDate?: string;
  occurredAt?: string | null;
  amountMinor?: number;
  category?: string;
  note?: string | null;
  merchant?: string | null;
  needVsWant?: "need" | "want";
  paymentMethod?: string | null;
  purpose?: "fixed" | "flexible" | "emergency" | null;
  countsInDaily?: boolean;
  operationId: string;
}>;

export type McpMoneyHandlers = {
  moneyState(
    authInfo: AuthInfo | undefined,
    input: McpMoneyStateInput,
  ): Promise<CallToolResult>;
  moneyLedgerList(
    authInfo: AuthInfo | undefined,
    input: McpMoneyLedgerListInput,
  ): Promise<CallToolResult>;
  createMoneyMovement(
    authInfo: AuthInfo | undefined,
    input: McpMoneyCreateMovementInput,
    operationId: string,
  ): Promise<CallToolResult>;
  updateMoneyMovement(
    authInfo: AuthInfo | undefined,
    input: McpMoneyUpdateMovementInput,
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
 * MONEY-04 MCP surface. Read tools are fenced by the explicit
 * `personal_ops.read` grant and the movement writer by `personal_ops.write`;
 * revocation is re-validated per call. Mutations delegate to the same
 * application use case as HTTP and web, and return the stored row, never an
 * optimistic copy.
 */
export function createMcpMoneyHandlers(
  dependencies: McpMoneyDependencies,
): McpMoneyHandlers {
  function clientOf(authInfo: AuthInfo | undefined, permission: "personal_ops.read" | "personal_ops.write") {
    const principal = requireMcpPermission(authInfo, permission);
    if (!authInfo?.token) {
      throw new McpToolAuthorizationError(
        "UNAUTHENTICATED",
        "Authentication is required for this tool.",
      );
    }
    return {
      principal,
      client: dependencies.createUserClient(authInfo.token),
    };
  }

  return {
    async moneyState(authInfo, input) {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.read");
        const result = await getMoneyState(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseMoneyRepository(client as never),
          { cutoff: input?.cutoff, timezone: input?.timezone },
          { timezone: input?.timezone ?? null },
        );
        if (!result.ok) {
          return result.code === "validation"
            ? invalidArgument(result.errorMessage)
            : errorResult({
                code: "DEPENDENCY_UNAVAILABLE",
                message: "EGA House money state is temporarily unavailable.",
              });
        }
        return resultFromPayload({ ok: true, state: result.data.state });
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

    async moneyLedgerList(authInfo, input) {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.read");
        const result = await listMovements(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseMoneyRepository(client as never),
          {
            from: input?.from,
            to: input?.to,
            cutoff: input?.cutoff,
            timezone: input?.timezone,
            kind: input?.kind,
            limit: String(Math.min(Math.max(input?.limit ?? 25, 1), 100)),
          },
          { timezone: input?.timezone ?? null },
        );
        if (!result.ok) {
          return result.code === "validation"
            ? invalidArgument(result.errorMessage)
            : errorResult({
                code: "DEPENDENCY_UNAVAILABLE",
                message: "EGA House movements are temporarily unavailable.",
              });
        }
        return resultFromPayload({
          ok: true,
          movements: result.data.movements,
          pagination: result.data.pagination,
          cutoff: result.data.cutoff,
          timezone: result.data.timezone,
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

    async createMoneyMovement(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        const result = await createMovement(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseMoneyRepository(client as never),
          {
            kind: input.kind,
            ...(input.direction !== undefined ? { direction: input.direction } : {}),
            amountMinor: input.amountMinor,
            category: input.category ?? null,
            note: input.note ?? null,
            merchant: input.merchant ?? null,
            needVsWant: input.needVsWant ?? null,
            paymentMethod: input.paymentMethod ?? null,
            purpose: input.purpose ?? null,
            ...(input.countsInDaily !== undefined
              ? { countsInDaily: input.countsInDaily }
              : {}),
            ...(input.bookingDate !== undefined ? { bookingDate: input.bookingDate } : {}),
            occurredAt: input.occurredAt ?? null,
            idempotencyKey: input.idempotencyKey,
          },
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
                      "The stored grant does not allow writing money movements. Re-check the Money writer permission.",
                  })
                : errorResult({
                    code: "DEPENDENCY_UNAVAILABLE",
                    message: "EGA House data is temporarily unavailable.",
                  });
        }
        return resultFromPayload({
          ok: true,
          movement: result.data.movement,
          replayed: result.data.replayed,
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

    async updateMoneyMovement(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        const result = await updateMovement(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseMoneyRepository(client as never),
          input.movementId,
          {
            version: input.version,
            ...(input.bookingDate !== undefined ? { bookingDate: input.bookingDate } : {}),
            ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
            ...(input.amountMinor !== undefined ? { amountMinor: input.amountMinor } : {}),
            ...(input.category !== undefined ? { category: input.category as never } : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
            ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
            ...(input.needVsWant !== undefined ? { needVsWant: input.needVsWant } : {}),
            ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
            ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
            ...(input.countsInDaily !== undefined
              ? { countsInDaily: input.countsInDaily }
              : {}),
          },
        );
        if (!result.ok) {
          return result.code === "conflict"
            ? errorResult({ code: "CONFLICT", message: result.errorMessage })
            : result.code === "validation"
              ? invalidArgument(result.errorMessage)
              : result.code === "notFound"
                ? errorResult({ code: "NOT_FOUND", message: result.errorMessage })
                : result.code === "forbidden"
                  ? errorResult({
                      code: "PERMISSION_DENIED",
                      message:
                        "The stored grant does not allow changing money movements. Re-check the Money writer permission.",
                    })
                  : errorResult({
                      code: "DEPENDENCY_UNAVAILABLE",
                      message: "EGA House data is temporarily unavailable.",
                    });
        }
        return resultFromPayload({ ok: true, movement: result.data, operationId });
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
