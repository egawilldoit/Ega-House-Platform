import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createAuthenticatedActor,
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  resolveEffectiveTimezone,
  updateExpense,
  type ExpenseRepository,
  type TimeContextRepository,
} from "@ega/application";
import {
  SupabaseExpenseRepository,
  SupabaseTimeContextRepository,
} from "@ega/data-access";
import {
  EXPENSE_LIST_MAX_LIMIT,
  EXPENSE_LIST_MAX_OFFSET,
  isExpenseId,
  type ExpenseCategory,
  type ExpenseNeedVsWant,
  type ExpensePaymentMethod,
} from "@ega/domain/expenses";
import { isIsoDate, isValidIANATimeZone } from "@ega/domain/time-context";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

/**
 * MONEY-02 Money MCP tools.
 *
 * Every tool routes through the existing expense application use cases and the
 * canonical `personal_expenses` repository. There is no second calculator, no
 * SQL proxy and no caller-supplied owner id: the verified principal selects the
 * owner, permission is re-checked per call (including revocation), and writes
 * receive a full semantic receipt from the shared write wrapper.
 */

export type McpMoneyExpenseDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  repositoryFactory?: (client: SupabaseClient<McpDatabase>) => ExpenseRepository;
  timeContextRepositoryFactory?: (
    client: SupabaseClient<McpDatabase>,
  ) => TimeContextRepository;
};

export type McpMoneyLedgerQuery = Readonly<{
  from?: string;
  to?: string;
  timezone?: string;
  limit?: number;
  offset?: number;
}>;

export type McpMoneyCreateInput = Readonly<{
  occurredAt: string;
  amountMinor: number;
  category: ExpenseCategory;
  needVsWant: ExpenseNeedVsWant;
  note?: string | null;
  merchant?: string | null;
  paymentMethod?: ExpensePaymentMethod | null;
  idempotencyKey: string;
  operationId: string;
}>;

export type McpMoneyUpdateInput = Readonly<{
  expenseId: string;
  expectedVersion: number;
  occurredAt?: string;
  amountMinor?: number;
  category?: ExpenseCategory;
  needVsWant?: ExpenseNeedVsWant;
  note?: string | null;
  merchant?: string | null;
  paymentMethod?: ExpensePaymentMethod | null;
  operationId: string;
}>;

export type McpMoneyDeleteInput = Readonly<{
  expenseId: string;
  expectedVersion: number;
  operationId: string;
}>;

const DEFAULTS: Pick<McpMoneyExpenseDependencies,
  "repositoryFactory" | "timeContextRepositoryFactory"
> = {
  repositoryFactory: (client) =>
    new SupabaseExpenseRepository(client as never),
  timeContextRepositoryFactory: (client) =>
    new SupabaseTimeContextRepository(client as never),
};

function resultFromPayload(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorResult(error: {
  code: string;
  message: string;
}): CallToolResult {
  return { ...resultFromPayload({ ok: false, error }), isError: true };
}

function invalidArgument(message: string): CallToolResult {
  return errorResult({ code: "INVALID_ARGUMENT", message });
}

function validateExpenseId(value: unknown): string | null {
  if (typeof value !== "string" || !isExpenseId(value.trim())) return null;
  return value.trim();
}

function validateBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < min
    || value > max
  ) {
    return null;
  }
  return value;
}

function mapFailure(
  code: string | undefined,
  message: string,
): CallToolResult {
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
          "The stored grant does not allow this Money write. Re-check the Money writer permission.",
      });
    default:
      return errorResult({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "EGA House money data is temporarily unavailable.",
      });
  }
}

export function createMcpMoneyExpenseHandlers(
  dependencies: McpMoneyExpenseDependencies,
) {
  const repositoryFactory =
    dependencies.repositoryFactory ?? DEFAULTS.repositoryFactory!;
  const timeContextRepositoryFactory =
    dependencies.timeContextRepositoryFactory
    ?? DEFAULTS.timeContextRepositoryFactory!;

  function clientOf(authInfo: AuthInfo | undefined, permission: "personal_ops.read" | "personal_ops.write") {
    const principal = requireMcpPermission(authInfo, permission);
    if (!authInfo?.token) {
      throw new McpToolAuthorizationError(
        "UNAUTHENTICATED",
        "Authentication is required for this tool.",
      );
    }
    return { principal, client: dependencies.createUserClient(authInfo.token) };
  }

  return {
    /** `ega_money_get`: one identified, active expense for the verified owner. */
    async getMoneyExpense(
      authInfo: AuthInfo | undefined,
      input: { expenseId: string },
    ): Promise<CallToolResult> {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.read");
        const expenseId = validateExpenseId(input.expenseId);
        if (!expenseId) {
          return invalidArgument("expenseId must be a UUID.");
        }
        const result = await getExpense(
          createAuthenticatedActor(principal.ownerUserId),
          repositoryFactory(client),
          expenseId,
        );
        if (!result.ok) {
          return mapFailure(result.code, result.errorMessage);
        }
        return resultFromPayload({ ok: true, expense: result.data });
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

    /**
     * `ega_money_ledger_list`: newest-first, stable (occurred_at, id) ordering
     * with reachable offset continuation and owner-local date windows.
     */
    async listMoneyLedger(
      authInfo: AuthInfo | undefined,
      input: McpMoneyLedgerQuery,
    ): Promise<CallToolResult> {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.read");
        const actor = createAuthenticatedActor(principal.ownerUserId);

        const limit = validateBoundedInteger(
          input.limit,
          25,
          1,
          EXPENSE_LIST_MAX_LIMIT,
        );
        if (limit === null) {
          return invalidArgument(
            `limit must be a whole number from 1 to ${EXPENSE_LIST_MAX_LIMIT}.`,
          );
        }
        const offset = validateBoundedInteger(
          input.offset,
          0,
          0,
          EXPENSE_LIST_MAX_OFFSET,
        );
        if (offset === null) {
          return invalidArgument(
            `offset must be a whole number from 0 to ${EXPENSE_LIST_MAX_OFFSET}.`,
          );
        }
        if (input.from !== undefined && !isIsoDate(input.from)) {
          return invalidArgument(
            "from must be a real calendar date in YYYY-MM-DD form.",
          );
        }
        if (input.to !== undefined && !isIsoDate(input.to)) {
          return invalidArgument(
            "to must be a real calendar date in YYYY-MM-DD form.",
          );
        }
        if (
          input.timezone !== undefined
          && !isValidIANATimeZone(input.timezone)
        ) {
          return invalidArgument("timezone must be a valid IANA timezone.");
        }

        let timezone = input.timezone ?? null;
        if (timezone === null && (input.from !== undefined || input.to !== undefined)) {
          // Resolve the owner's stored timezone instead of guessing UTC; the
          // same owner context drives the HTTP and web surfaces.
          const effective = await resolveEffectiveTimezone(
            actor,
            timeContextRepositoryFactory(client),
            undefined,
          );
          if (!effective.ok) {
            return errorResult({
              code: "DEPENDENCY_UNAVAILABLE",
              message: "Unable to resolve the owner timezone right now.",
            });
          }
          timezone = effective.data.timezone;
        }

        const result = await listExpenses(
          actor,
          repositoryFactory(client),
          {
            ...(input.from !== undefined ? { from: input.from } : {}),
            ...(input.to !== undefined ? { to: input.to } : {}),
            ...(timezone !== null ? { timezone } : {}),
            limit: String(limit),
            offset: String(offset),
          },
          { timezone },
        );
        if (!result.ok) {
          return mapFailure(result.code, result.errorMessage);
        }
        return resultFromPayload({
          ok: true,
          expenses: result.data.expenses,
          count: result.data.expenses.length,
          pagination: result.data.pagination,
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

    async createMoneyExpense(
      authInfo: AuthInfo | undefined,
      input: McpMoneyCreateInput,
    ): Promise<CallToolResult> {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        if (!input.operationId) {
          return invalidArgument("An operation id is required.");
        }
        const result = await createExpense(
          createAuthenticatedActor(principal.ownerUserId),
          repositoryFactory(client),
          {
            occurredAt: input.occurredAt,
            amountMinor: input.amountMinor,
            category: input.category,
            needVsWant: input.needVsWant,
            note: input.note ?? null,
            merchant: input.merchant ?? null,
            paymentMethod: input.paymentMethod ?? null,
            idempotencyKey: input.idempotencyKey,
          },
        );
        if (!result.ok) {
          return mapFailure(result.code, result.errorMessage);
        }
        return resultFromPayload({
          ok: true,
          expense: result.data.expense,
          replayed: result.data.replayed,
          operationId: input.operationId,
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

    /** Optimistic version required: a stale edit conflicts, never overwrites. */
    async updateMoneyExpense(
      authInfo: AuthInfo | undefined,
      input: McpMoneyUpdateInput,
    ): Promise<CallToolResult> {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        if (!input.operationId) {
          return invalidArgument("An operation id is required.");
        }
        const expenseId = validateExpenseId(input.expenseId);
        if (!expenseId) {
          return invalidArgument("expenseId must be a UUID.");
        }
        if (
          !Number.isInteger(input.expectedVersion)
          || input.expectedVersion < 1
        ) {
          return invalidArgument("expectedVersion must be a positive integer.");
        }
        const result = await updateExpense(
          createAuthenticatedActor(principal.ownerUserId),
          repositoryFactory(client),
          expenseId,
          {
            version: input.expectedVersion,
            ...(input.occurredAt !== undefined
              ? { occurredAt: input.occurredAt }
              : {}),
            ...(input.amountMinor !== undefined
              ? { amountMinor: input.amountMinor }
              : {}),
            ...(input.category !== undefined
              ? { category: input.category }
              : {}),
            ...(input.needVsWant !== undefined
              ? { needVsWant: input.needVsWant }
              : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
            ...(input.merchant !== undefined
              ? { merchant: input.merchant }
              : {}),
            ...(input.paymentMethod !== undefined
              ? { paymentMethod: input.paymentMethod }
              : {}),
          },
        );
        if (!result.ok) {
          return mapFailure(result.code, result.errorMessage);
        }
        return resultFromPayload({
          ok: true,
          expense: result.data,
          operationId: input.operationId,
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

    /** Soft delete with an expected version; a repeat delete is a replay. */
    async deleteMoneyExpense(
      authInfo: AuthInfo | undefined,
      input: McpMoneyDeleteInput,
    ): Promise<CallToolResult> {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        if (!input.operationId) {
          return invalidArgument("An operation id is required.");
        }
        const expenseId = validateExpenseId(input.expenseId);
        if (!expenseId) {
          return invalidArgument("expenseId must be a UUID.");
        }
        if (
          !Number.isInteger(input.expectedVersion)
          || input.expectedVersion < 1
        ) {
          return invalidArgument("expectedVersion must be a positive integer.");
        }
        const result = await deleteExpense(
          createAuthenticatedActor(principal.ownerUserId),
          repositoryFactory(client),
          expenseId,
          { expectedVersion: input.expectedVersion },
        );
        if (!result.ok) {
          return mapFailure(result.code, result.errorMessage);
        }
        return resultFromPayload({
          ok: true,
          id: result.data.id,
          deletedAt: result.data.deletedAt,
          alreadyDeleted: result.data.alreadyDeleted,
          operationId: input.operationId,
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

export type McpMoneyExpenseHandlers = ReturnType<typeof createMcpMoneyExpenseHandlers>;
