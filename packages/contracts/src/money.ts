import type { ExpenseCategory, ExpenseNeedVsWant } from "@ega/domain/expenses";
import type {
  CoffeeWindowSummary,
  MoneyBudgetAllocations,
} from "@ega/domain/money";

import type { ExpenseDto, ExpenseErrorCode } from "./expenses";

/**
 * Wire contracts for MONEY-05 period budgets, category classification and
 * counted coffee visits. Amounts are non-negative integer MAD centimes. The
 * counted visit references canonical expense ids; it never carries a second
 * authoritative cash amount.
 */

export type MoneyBudgetPlanDto = Readonly<{
  id: string;
  periodStartDate: string;
  periodEndDate: string;
  currency: "MAD";
  allocations: MoneyBudgetAllocations;
  savingsTargetMinor: number | null;
  emergencyTargetMinor: number | null;
  coffeeWeeklySpendLimitMinor: number | null;
  coffeeWeeklyVisitLimit: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type GetMoneyBudgetPlanQuery = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
}>;

export type GetMoneyBudgetPlanResponse = Readonly<{
  ok: true;
  /** `null` means no explicit plan exists; this is not a zero budget. */
  plan: MoneyBudgetPlanDto | null;
}>;

export type SaveMoneyBudgetPlanRequest = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
  allocations: MoneyBudgetAllocations;
  savingsTargetMinor?: number | null;
  emergencyTargetMinor?: number | null;
  coffeeWeeklySpendLimitMinor?: number | null;
  coffeeWeeklyVisitLimit?: number | null;
  /** 0 creates the period plan; otherwise the current plan version. */
  version: number;
}>;

export type SetMoneyBudgetAllocationRequest = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
  version: number;
  /** `null` clears one entry; omitted allocations stay unchanged. */
  allocations?: Partial<Record<ExpenseCategory, number | null>>;
  savingsTargetMinor?: number | null;
  emergencyTargetMinor?: number | null;
  coffeeWeeklySpendLimitMinor?: number | null;
  coffeeWeeklyVisitLimit?: number | null;
}>;

export type MoneyBudgetMutationResponse = Readonly<{
  ok: true;
  plan: MoneyBudgetPlanDto;
}>;

export type MoneyCoffeeVisitLineDto = Readonly<{
  expenseId: string;
  amountMinor: number;
  category: string;
  deletedAt: string | null;
}>;

export type MoneyCoffeeVisitDto = Readonly<{
  id: string;
  visitKey: string;
  visitFingerprint: string;
  localDate: string;
  timezone: string;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lines: MoneyCoffeeVisitLineDto[];
}>;

export type RecordMoneyCoffeeVisitRequest = Readonly<{
  visitKey: string;
  localDate: string;
  timezone: string;
  /** Canonical coffee-category expense ids; several lines count as one visit. */
  expenseIds: string[];
  note?: string | null;
}>;

export type RecordMoneyCoffeeVisitResponse = Readonly<{
  ok: true;
  visit: MoneyCoffeeVisitDto;
  replayed: boolean;
}>;

export type DeleteMoneyCoffeeVisitResponse = Readonly<{
  ok: true;
  id: string;
  alreadyDeleted: boolean;
}>;

export type ListMoneyCoffeeVisitsQuery = Readonly<{
  from: string;
  to: string;
  limit?: number;
  offset?: number;
}>;

export type ListMoneyCoffeeVisitsResponse = Readonly<{
  ok: true;
  visits: MoneyCoffeeVisitDto[];
}>;

export type MoneyCoffeeWindowQuery = Readonly<{
  localDate: string;
  timezone: string;
  periodStartDate: string;
  periodEndDate: string;
  spendLimitMinor?: number | null;
  visitLimitMinor?: number | null;
}>;

export type MoneyCoffeeWindowResponse = Readonly<{
  ok: true;
  coffee: CoffeeWindowSummary;
}>;

export type ClassifyMoneyExpenseRequest = Readonly<{
  expenseId: string;
  version: number;
  category: ExpenseCategory;
  note?: string | null;
  needVsWant?: ExpenseNeedVsWant;
}>;

export type ClassifyMoneyExpenseResponse = Readonly<{
  ok: true;
  expense: ExpenseDto;
  previousCategory: ExpenseCategory;
  countedCoffeeVisitIds: string[];
  countedCoffeeUsageChanged: boolean;
}>;

export type MoneyErrorCode = ExpenseErrorCode;
