import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ExpenseRepository,
  MoneyPeriodRepository,
  TimeContextRepository,
} from "@ega/application";

import type { McpDatabase } from "@/lib/mcp/mcp-database.types";

import {
  createMcpMoneyExpenseHandlers,
  type McpMoneyExpenseHandlers,
} from "./expense-handlers";
import {
  createMcpMoneyPeriodHandlers,
  type McpMoneyPeriodHandlers,
} from "./period-handlers";

/**
 * One Money MCP surface composed from two disjoint tool families:
 * expense CRUD/reads (MONEY-02) and period/settings state (MONEY-03).
 *
 * Both families call the same canonical application use cases and repositories;
 * this barrel only owns the shared dependency shape and the composed handler
 * type, so neither issue maintains a second ledger or calculator.
 */
export type McpMoneyDependencies = {
  createUserClient: (accessToken: string) => SupabaseClient<McpDatabase>;
  repositoryFactory?: (client: SupabaseClient<McpDatabase>) => ExpenseRepository;
  timeContextRepositoryFactory?: (
    client: SupabaseClient<McpDatabase>,
  ) => TimeContextRepository;
  periodRepositoryFactory?: (
    client: SupabaseClient<McpDatabase>,
  ) => Pick<MoneyPeriodRepository, "findTracking" | "list">;
  now?: () => Date;
};

export type McpMoneyHandlers = McpMoneyExpenseHandlers & McpMoneyPeriodHandlers;

export function createMcpMoneyHandlers(
  dependencies: McpMoneyDependencies,
): McpMoneyHandlers {
  return {
    ...createMcpMoneyExpenseHandlers(dependencies),
    ...createMcpMoneyPeriodHandlers(dependencies),
  };
}

export type {
  McpMoneyCreateInput,
  McpMoneyDeleteInput,
  McpMoneyLedgerQuery,
  McpMoneyUpdateInput,
} from "./expense-handlers";
export type {
  McpMoneyOpeningInput,
  McpMoneyStateInput,
  McpMoneyUpdateSettingsInput,
} from "./period-handlers";
