import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  classifyMoneyExpense,
  createAuthenticatedActor,
  deleteMoneyCoffeeVisit,
  getMoneyBudgetPlan,
  getMoneyCoffeeWindowForPlan,
  listMoneyCoffeeVisits,
  patchMoneyBudgetPlan,
  recordMoneyCoffeeVisit,
} from "@ega/application";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyCoffeeRepository,
  SupabaseMoneyPeriodRepository,
} from "@ega/data-access";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

/**
 * MONEY-05 MCP surface: period budget plan, explicit category classification
 * and counted coffee visits.
 *
 * These tools never re-register the MONEY-02/03/04 expense, state or movement
 * tools. Every read is fenced by the explicit `personal_ops.read` grant and
 * every writer by `personal_ops.write`, re-validated per call. Mutations
 * delegate to the same application use cases as HTTP and web and return the
 * stored row, never an optimistic copy or a second calculator.
 */

export type McpMoneyBudgetPeriodInput = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
}>;

export type McpMoneyBudgetGetInput = McpMoneyBudgetPeriodInput;

export type McpMoneySetAllocationInput = McpMoneyBudgetPeriodInput &
  Readonly<{
    version: number;
    allocations?: Record<string, number | null>;
    savingsTargetMinor?: number | null;
    emergencyTargetMinor?: number | null;
    coffeeWeeklySpendLimitMinor?: number | null;
    coffeeWeeklyVisitLimit?: number | null;
  }>;

export type McpMoneyCoffeeWindowInput = Readonly<{
  localDate: string;
  timezone: string;
  periodStartDate: string;
  periodEndDate: string;
}>;

export type McpMoneyCoffeeVisitListInput = Readonly<{
  from: string;
  to: string;
  limit?: number;
  offset?: number;
}>;

export type McpMoneyClassifyExpenseInput = Readonly<{
  expenseId: string;
  version: number;
  category: string;
  note?: string | null;
  needVsWant?: "need" | "want";
}>;

export type McpMoneyRecordCoffeeVisitInput = Readonly<{
  visitKey: string;
  localDate: string;
  timezone: string;
  expenseIds: string[];
  note?: string | null;
}>;

export type McpMoneyDeleteCoffeeVisitInput = Readonly<{
  visitId: string;
  version: number;
}>;

export type McpMoneyBudgetHandlers = {
  moneyBudgetGet(
    authInfo: AuthInfo | undefined,
    input: McpMoneyBudgetGetInput,
  ): Promise<CallToolResult>;
  moneyCoffeeWindow(
    authInfo: AuthInfo | undefined,
    input: McpMoneyCoffeeWindowInput,
  ): Promise<CallToolResult>;
  moneyCoffeeVisitList(
    authInfo: AuthInfo | undefined,
    input: McpMoneyCoffeeVisitListInput,
  ): Promise<CallToolResult>;
  setMoneyAllocation(
    authInfo: AuthInfo | undefined,
    input: McpMoneySetAllocationInput,
    operationId: string,
  ): Promise<CallToolResult>;
  classifyMoneyExpense(
    authInfo: AuthInfo | undefined,
    input: McpMoneyClassifyExpenseInput,
    operationId: string,
  ): Promise<CallToolResult>;
  recordCoffeeVisit(
    authInfo: AuthInfo | undefined,
    input: McpMoneyRecordCoffeeVisitInput,
    operationId: string,
  ): Promise<CallToolResult>;
  deleteCoffeeVisit(
    authInfo: AuthInfo | undefined,
    input: McpMoneyDeleteCoffeeVisitInput,
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

function applicationError(
  result: Readonly<{ ok: false; errorMessage: string; code?: string }>,
  forbiddenMessage: string,
): CallToolResult {
  if (result.code === "validation") return invalidArgument(result.errorMessage);
  if (result.code === "forbidden") {
    return errorResult({ code: "PERMISSION_DENIED", message: forbiddenMessage });
  }
  if (result.code === "conflict") {
    return errorResult({ code: "CONFLICT", message: result.errorMessage });
  }
  if (result.code === "notFound") {
    return errorResult({ code: "NOT_FOUND", message: result.errorMessage });
  }
  return errorResult({
    code: "DEPENDENCY_UNAVAILABLE",
    message: "EGA House money data is temporarily unavailable.",
  });
}

function budgetError(error: unknown): CallToolResult {
  if (error instanceof McpToolAuthorizationError) {
    return errorResult({ code: error.code, message: error.message });
  }
  return errorResult({
    code: "INTERNAL_ERROR",
    message: "The MCP tool could not complete the request.",
  });
}

export function createMcpMoneyBudgetHandlers(dependencies: {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  now?: () => Date;
}): McpMoneyBudgetHandlers {
  function clientOf(
    authInfo: AuthInfo | undefined,
    permission: "personal_ops.read" | "personal_ops.write",
  ) {
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

  function budgetDependencies(client: SupabaseClient<McpDatabase>) {
    return {
      budgets: new SupabaseMoneyBudgetRepository(client as never),
      periods: new SupabaseMoneyPeriodRepository(client as never),
    };
  }

  function coffeeDependencies(client: SupabaseClient<McpDatabase>) {
    return {
      expenses: new SupabaseExpenseRepository(client as never),
      coffee: new SupabaseMoneyCoffeeRepository(client as never),
    };
  }

  return {
    async moneyBudgetGet(authInfo, input) {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.read");
        const result = await getMoneyBudgetPlan(
          createAuthenticatedActor(principal.ownerUserId),
          budgetDependencies(client),
          {
            periodStartDate: input?.periodStartDate,
            periodEndDate: input?.periodEndDate,
          },
        );
        if (!result.ok) return applicationError(result, "Permission denied.");
        return resultFromPayload({
          ok: true,
          plan: result.data,
          labels: {
            periodAllocation: "Period budget allocation",
            advisoryCap: "Advisory monthly category cap",
          },
        });
      } catch (error) {
        return budgetError(error);
      }
    },

    async moneyCoffeeWindow(authInfo, input) {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.read");
        const actor = createAuthenticatedActor(principal.ownerUserId);
        const planResult = await getMoneyBudgetPlan(actor, budgetDependencies(client), {
          periodStartDate: input?.periodStartDate,
          periodEndDate: input?.periodEndDate,
        });
        if (!planResult.ok) {
          return applicationError(planResult, "Permission denied.");
        }
        const result = await getMoneyCoffeeWindowForPlan(
          actor,
          coffeeDependencies(client),
          {
            localDate: input?.localDate,
            timezone: input?.timezone,
            periodStartDate: input?.periodStartDate,
            periodEndDate: input?.periodEndDate,
            plan: planResult.data,
          },
        );
        if (!result.ok) return applicationError(result, "Permission denied.");
        return resultFromPayload({ ok: true, coffee: result.data });
      } catch (error) {
        return budgetError(error);
      }
    },

    async moneyCoffeeVisitList(authInfo, input) {
      try {
        const { principal, client } = clientOf(authInfo, "personal_ops.read");
        const result = await listMoneyCoffeeVisits(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseMoneyCoffeeRepository(client as never),
          input,
        );
        if (!result.ok) return applicationError(result, "Permission denied.");
        return resultFromPayload({ ok: true, visits: result.data.visits });
      } catch (error) {
        return budgetError(error);
      }
    },

    async setMoneyAllocation(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        const result = await patchMoneyBudgetPlan(
          createAuthenticatedActor(principal.ownerUserId),
          budgetDependencies(client),
          input,
          { now: dependencies.now?.() ?? new Date() },
        );
        if (!result.ok) {
          return applicationError(
            result,
            "The stored grant does not allow changing Money budgets. Re-check the Money writer permission.",
          );
        }
        return resultFromPayload({ ok: true, plan: result.data, operationId });
      } catch (error) {
        return budgetError(error);
      }
    },

    async classifyMoneyExpense(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        const result = await classifyMoneyExpense(
          createAuthenticatedActor(principal.ownerUserId),
          coffeeDependencies(client),
          input,
          { now: dependencies.now?.() ?? new Date() },
        );
        if (!result.ok) {
          return applicationError(
            result,
            "The stored grant does not allow classifying expenses. Re-check the Money writer permission.",
          );
        }
        return resultFromPayload({
          ok: true,
          expense: result.data.expense,
          previousCategory: result.data.previousCategory,
          countedCoffeeVisitIds: result.data.countedCoffeeVisitIds,
          countedCoffeeUsageChanged: result.data.countedCoffeeUsageChanged,
          operationId,
        });
      } catch (error) {
        return budgetError(error);
      }
    },

    async recordCoffeeVisit(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        const result = await recordMoneyCoffeeVisit(
          createAuthenticatedActor(principal.ownerUserId),
          coffeeDependencies(client),
          input,
          { now: dependencies.now?.() ?? new Date() },
        );
        if (!result.ok) {
          return applicationError(
            result,
            "The stored grant does not allow recording coffee visits. Re-check the Money writer permission.",
          );
        }
        return resultFromPayload({
          ok: true,
          visit: result.data.visit,
          replayed: result.data.replayed,
          operationId,
        });
      } catch (error) {
        return budgetError(error);
      }
    },

    async deleteCoffeeVisit(authInfo, input, operationId) {
      try {
        if (!operationId) return invalidArgument("An operation id is required.");
        const { principal, client } = clientOf(authInfo, "personal_ops.write");
        const result = await deleteMoneyCoffeeVisit(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseMoneyCoffeeRepository(client as never),
          { id: input.visitId, version: input.version },
          { now: dependencies.now?.() ?? new Date() },
        );
        if (!result.ok) {
          return applicationError(
            result,
            "The stored grant does not allow deleting coffee visits. Re-check the Money writer permission.",
          );
        }
        return resultFromPayload({
          ok: true,
          id: result.data.id,
          alreadyDeleted: result.data.alreadyDeleted,
          operationId,
        });
      } catch (error) {
        return budgetError(error);
      }
    },
  };
}
