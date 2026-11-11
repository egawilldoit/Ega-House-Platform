import type {
  AuthenticatedActor,
  MoneyBudgetPeriod,
  MoneyBudgetPlanCreateInput,
  MoneyBudgetPlanUpdateInput,
  MoneyBudgetRepository,
  RepositoryFailure,
  RepositoryResult,
} from "@ega/application";
import {
  MONEY_CURRENCY,
  type MoneyBudgetAllocations,
  type MoneyBudgetPlan,
  type MoneyBudgetPlanValues,
} from "@ega/domain/money";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

/**
 * Request-scoped Supabase adapter for `public.money_budget_plans`.
 *
 * RLS is authoritative; every statement also filters by the verified actor's
 * owner id. One row owns the allocations map, savings/emergency targets and
 * coffee limits for exactly one canonical `money_periods` row, with optimistic
 * version fencing. Period dates are never stored or edited here; the caller
 * passes the period it resolved from the canonical period reader.
 */

const TABLE = "money_budget_plans";

const COLUMNS =
  "id, period_id, currency, allocations, savings_target_minor, emergency_target_minor, coffee_weekly_spend_limit_minor, coffee_weekly_visit_limit, version, created_at, updated_at";

type BudgetRow = {
  id: string;
  period_id: string;
  currency: string;
  allocations: unknown;
  savings_target_minor: number | null;
  emergency_target_minor: number | null;
  coffee_weekly_spend_limit_minor: number | null;
  coffee_weekly_visit_limit: number | null;
  version: number;
  created_at: string;
  updated_at: string;
};

function budgetFailure(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
} | null): RepositoryFailure {
  if (!error) return { code: "unknown" };
  if (error.code === "42501") return { code: "forbidden" };
  if (error.code === "23505" || error.code === "23503" || error.code === "23514") {
    return { code: "conflict" };
  }
  return sanitizeSupabaseError(error, { conflictCode: "__none__" });
}

function normalizeAllocations(raw: unknown): MoneyBudgetAllocations {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const allocations: Record<string, number> = {};
  for (const [category, amount] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof amount === "number" && Number.isInteger(amount) && amount >= 0) {
      allocations[category] = amount;
    }
  }
  return allocations as MoneyBudgetAllocations;
}

function toRecord(
  row: BudgetRow,
  period: Readonly<{ periodStartDate: string; periodEndDate: string }>,
): MoneyBudgetPlan {
  return {
    id: String(row.id),
    periodId: String(row.period_id),
    periodStartDate: period.periodStartDate,
    periodEndDate: period.periodEndDate,
    currency: MONEY_CURRENCY,
    allocations: normalizeAllocations(row.allocations),
    savingsTargetMinor:
      row.savings_target_minor == null ? null : Number(row.savings_target_minor),
    emergencyTargetMinor:
      row.emergency_target_minor == null ? null : Number(row.emergency_target_minor),
    coffeeWeeklySpendLimitMinor:
      row.coffee_weekly_spend_limit_minor == null
        ? null
        : Number(row.coffee_weekly_spend_limit_minor),
    coffeeWeeklyVisitLimit:
      row.coffee_weekly_visit_limit == null
        ? null
        : Number(row.coffee_weekly_visit_limit),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toPayload(values: MoneyBudgetPlanValues): Record<string, unknown> {
  return {
    period_id: values.periodId,
    currency: MONEY_CURRENCY,
    allocations: values.allocations,
    savings_target_minor: values.savingsTargetMinor,
    emergency_target_minor: values.emergencyTargetMinor,
    coffee_weekly_spend_limit_minor: values.coffeeWeeklySpendLimitMinor,
    coffee_weekly_visit_limit: values.coffeeWeeklyVisitLimit,
  };
}

export class SupabaseMoneyBudgetRepository implements MoneyBudgetRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getPlan(
    actor: AuthenticatedActor,
    period: MoneyBudgetPeriod,
  ): Promise<RepositoryResult<MoneyBudgetPlan | null>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .select(COLUMNS)
      .eq("owner_user_id", actor.userId)
      .eq("period_id", period.periodId)
      .maybeSingle();

    if (error) return { ok: false, error: budgetFailure(error) };
    if (!data) return { ok: true, value: null };
    return { ok: true, value: toRecord(data as BudgetRow, period) };
  }

  async createPlan(
    actor: AuthenticatedActor,
    input: MoneyBudgetPlanCreateInput,
  ): Promise<RepositoryResult<MoneyBudgetPlan>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .insert({
        owner_user_id: actor.userId,
        ...toPayload(input.values),
        created_at: input.createdAt,
        updated_at: input.createdAt,
      })
      .select(COLUMNS)
      .single();

    if (error) {
      if (error.code === "23505") return { ok: false, error: { code: "conflict" } };
      return { ok: false, error: budgetFailure(error) };
    }
    if (!data) return { ok: false, error: { code: "unknown" } };
    return { ok: true, value: toRecord(data as BudgetRow, input.values) };
  }

  async updatePlan(
    actor: AuthenticatedActor,
    id: string,
    input: MoneyBudgetPlanUpdateInput,
  ): Promise<RepositoryResult<MoneyBudgetPlan>> {
    const { data, error } = await this.supabase
      .from(TABLE)
      .update({
        ...toPayload(input.values),
        version: input.expectedVersion + 1,
        updated_at: input.updatedAt,
      })
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .eq("version", input.expectedVersion)
      .select(COLUMNS)
      .maybeSingle();

    if (error) return { ok: false, error: budgetFailure(error) };
    if (data) return { ok: true, value: toRecord(data as BudgetRow, input.values) };

    const current = await this.supabase
      .from(TABLE)
      .select("version")
      .eq("owner_user_id", actor.userId)
      .eq("id", id)
      .maybeSingle();
    if (current.error) return { ok: false, error: budgetFailure(current.error) };
    if (!current.data) return { ok: false, error: { code: "notFound" } };
    return { ok: false, error: { code: "conflict" } };
  }
}
