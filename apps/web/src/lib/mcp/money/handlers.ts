import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  classifyMoneyExpense as classifyMoneyExpenseUseCase,
  createAuthenticatedActor,
  deleteMoneyCoffeeVisit as deleteMoneyCoffeeVisitUseCase,
  getMoneyBudgetPlan,
  getMoneyCoffeeWindow,
  listMoneyCoffeeVisits,
  patchMoneyBudgetPlan,
  recordMoneyCoffeeVisit as recordMoneyCoffeeVisitUseCase,
} from "@ega/application";
import {
  SupabaseExpenseRepository,
  SupabaseMoneyBudgetRepository,
  SupabaseMoneyCoffeeRepository,
} from "@ega/data-access";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";
import {
  McpToolAuthorizationError,
  requireMcpPermission,
} from "@/lib/mcp/tool-authorization";

/**
 * Money MCP composition (MONEY-05). These tools use the same application use
 * cases as the web Money surface; there is no stub, SQL proxy or second
 * calculator. Writes require the explicit personal_ops.write grant and reads
 * the personal_ops.read grant. Every mutation receipt is stored by the caller
 * (`withExclusiveMutation`) with its full normalized semantic input.
 */

export type McpMoneyDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
};

type ToolPayload = {
  ok: boolean;
  [key: string]: unknown;
};

function resultFromPayload(payload: ToolPayload): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function toolError(code: string, message: string): CallToolResult {
  return {
    ...resultFromPayload({ ok: false, error: { code, message } }),
    isError: true,
  };
}

/** Named to be classified as INVALID_ARGUMENT by both MCP error mappers. */
export class McpMoneyInvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInvalidArgumentError";
  }
}

function applicationError(
  result: Readonly<{ ok: false; errorMessage: string; code?: string }>,
): CallToolResult {
  if (result.code === "validation") {
    return toolError("INVALID_ARGUMENT", result.errorMessage);
  }
  if (result.code === "forbidden") {
    return toolError(
      "PERMISSION_DENIED",
      "The stored grant does not allow changing Money settings. Re-check the Money writer permission.",
    );
  }
  if (result.code === "conflict") {
    return toolError("CONFLICT", result.errorMessage);
  }
  if (result.code === "notFound") {
    return toolError("NOT_FOUND", result.errorMessage);
  }
  return toolError(
    "DEPENDENCY_UNAVAILABLE",
    "EGA House data is temporarily unavailable.",
  );
}

function requireWriter(authInfo: AuthInfo | undefined) {
  const principal = requireMcpPermission(authInfo, "personal_ops.write");
  if (!authInfo?.token) {
    throw new McpToolAuthorizationError(
      "UNAUTHENTICATED",
      "Authentication is required for this tool.",
    );
  }
  return principal;
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export async function getMoneyBudgetForOwner(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  input: { periodStartDate?: string; periodEndDate?: string },
): Promise<unknown> {
  const result = await getMoneyBudgetPlan(
    createAuthenticatedActor(ownerUserId),
    new SupabaseMoneyBudgetRepository(client as never),
    {
      periodStartDate: input.periodStartDate,
      periodEndDate: input.periodEndDate,
    },
  );
  if (!result.ok) {
    if (result.code === "validation") {
      throw new McpMoneyInvalidArgumentError(result.errorMessage);
    }
    throw new Error("Failed to load EGA money budget.");
  }
  return {
    plan: result.data,
    labels: {
      periodAllocation: "Period budget allocation",
      advisoryCap: "Advisory monthly category cap",
    },
  };
}

export async function getMoneyCoffeeWindowForOwner(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  input: {
    localDate: string;
    timezone: string;
    periodStartDate: string;
    periodEndDate: string;
    spendLimitMinor?: number | null;
    visitLimitMinor?: number | null;
  },
): Promise<unknown> {
  const result = await getMoneyCoffeeWindow(
    createAuthenticatedActor(ownerUserId),
    {
      expenses: new SupabaseExpenseRepository(client as never),
      coffee: new SupabaseMoneyCoffeeRepository(client as never),
    },
    input,
  );
  if (!result.ok) {
    if (result.code === "validation") {
      throw new McpMoneyInvalidArgumentError(result.errorMessage);
    }
    throw new Error("Failed to load EGA coffee window.");
  }
  return { coffee: result.data };
}

export async function listMoneyCoffeeVisitsForOwner(
  client: SupabaseClient<McpDatabase>,
  ownerUserId: string,
  input: { from: string; to: string; limit?: number; offset?: number },
): Promise<unknown> {
  const result = await listMoneyCoffeeVisits(
    createAuthenticatedActor(ownerUserId),
    new SupabaseMoneyCoffeeRepository(client as never),
    input,
  );
  if (!result.ok) {
    if (result.code === "validation") {
      throw new McpMoneyInvalidArgumentError(result.errorMessage);
    }
    throw new Error("Failed to list EGA coffee visits.");
  }
  return { visits: result.data.visits };
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

export type McpMoneyWriteHandlers = {
  setMoneyAllocation(
    authInfo: AuthInfo | undefined,
    input: {
      periodStartDate: string;
      periodEndDate: string;
      version: number;
      allocations?: Record<string, number | null>;
      savingsTargetMinor?: number | null;
      emergencyTargetMinor?: number | null;
      coffeeWeeklySpendLimitMinor?: number | null;
      coffeeWeeklyVisitLimit?: number | null;
    },
    operationId: string,
  ): Promise<CallToolResult>;
  classifyMoneyExpense(
    authInfo: AuthInfo | undefined,
    input: {
      expenseId: string;
      version: number;
      category: string;
      note?: string | null;
      needVsWant?: "need" | "want";
    },
    operationId: string,
  ): Promise<CallToolResult>;
  recordCoffeeVisit(
    authInfo: AuthInfo | undefined,
    input: {
      visitKey: string;
      localDate: string;
      timezone: string;
      expenseIds: string[];
      note?: string | null;
    },
    operationId: string,
  ): Promise<CallToolResult>;
  deleteCoffeeVisit(
    authInfo: AuthInfo | undefined,
    input: { visitId: string; version: number },
    operationId: string,
  ): Promise<CallToolResult>;
};

export function createMcpMoneyWriteHandlers(
  dependencies: McpMoneyDependencies,
): McpMoneyWriteHandlers {
  function clientOf(authInfo: AuthInfo | undefined) {
    const principal = requireWriter(authInfo);
    return {
      principal,
      client: dependencies.createUserClient(authInfo!.token),
    };
  }

  return {
    async setMoneyAllocation(authInfo, input, operationId) {
      try {
        if (!operationId) return toolError("INVALID_ARGUMENT", "An operation id is required.");
        const { principal, client } = clientOf(authInfo);
        const result = await patchMoneyBudgetPlan(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseMoneyBudgetRepository(client as never),
          input,
        );
        if (!result.ok) return applicationError(result);
        return resultFromPayload({ ok: true, plan: result.data, operationId });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return toolError(error.code, error.message);
        }
        return toolError(
          "INTERNAL_ERROR",
          "The MCP tool could not complete the request.",
        );
      }
    },

    async classifyMoneyExpense(authInfo, input, operationId) {
      try {
        if (!operationId) return toolError("INVALID_ARGUMENT", "An operation id is required.");
        const { principal, client } = clientOf(authInfo);
        const result = await classifyMoneyExpenseUseCase(
          createAuthenticatedActor(principal.ownerUserId),
          {
            expenses: new SupabaseExpenseRepository(client as never),
            coffee: new SupabaseMoneyCoffeeRepository(client as never),
          },
          input,
        );
        if (!result.ok) return applicationError(result);
        return resultFromPayload({
          ok: true,
          expense: result.data.expense,
          previousCategory: result.data.previousCategory,
          countedCoffeeVisitIds: result.data.countedCoffeeVisitIds,
          countedCoffeeUsageChanged: result.data.countedCoffeeUsageChanged,
          operationId,
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return toolError(error.code, error.message);
        }
        return toolError(
          "INTERNAL_ERROR",
          "The MCP tool could not complete the request.",
        );
      }
    },

    async recordCoffeeVisit(authInfo, input, operationId) {
      try {
        if (!operationId) return toolError("INVALID_ARGUMENT", "An operation id is required.");
        const { principal, client } = clientOf(authInfo);
        const result = await recordMoneyCoffeeVisitUseCase(
          createAuthenticatedActor(principal.ownerUserId),
          {
            expenses: new SupabaseExpenseRepository(client as never),
            coffee: new SupabaseMoneyCoffeeRepository(client as never),
          },
          input,
        );
        if (!result.ok) return applicationError(result);
        return resultFromPayload({
          ok: true,
          visit: result.data.visit,
          replayed: result.data.replayed,
          operationId,
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return toolError(error.code, error.message);
        }
        return toolError(
          "INTERNAL_ERROR",
          "The MCP tool could not complete the request.",
        );
      }
    },

    async deleteCoffeeVisit(authInfo, input, operationId) {
      try {
        if (!operationId) return toolError("INVALID_ARGUMENT", "An operation id is required.");
        const { principal, client } = clientOf(authInfo);
        const result = await deleteMoneyCoffeeVisitUseCase(
          createAuthenticatedActor(principal.ownerUserId),
          new SupabaseMoneyCoffeeRepository(client as never),
          { id: input.visitId, version: input.version },
        );
        if (!result.ok) return applicationError(result);
        return resultFromPayload({
          ok: true,
          id: result.data.id,
          alreadyDeleted: result.data.alreadyDeleted,
          operationId,
        });
      } catch (error) {
        if (error instanceof McpToolAuthorizationError) {
          return toolError(error.code, error.message);
        }
        return toolError(
          "INTERNAL_ERROR",
          "The MCP tool could not complete the request.",
        );
      }
    },
  };
}
