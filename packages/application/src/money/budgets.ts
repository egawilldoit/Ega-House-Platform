import {
  parseMoneyBudgetPatchInput,
  parseMoneyBudgetPeriodInput,
  parseMoneyBudgetPlanSaveInput,
  periodAcceptsRoutineEntries,
  type MoneyBudgetAllocations,
  type MoneyBudgetPatchValues,
  type MoneyBudgetPlan,
  type MoneyBudgetPlanValues,
  type MoneyPeriod,
} from "@ega/domain/money";
import type { ExpenseCategory } from "@ega/domain/expenses";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationErrorCode,
  type ApplicationResult,
  type RepositoryFailure,
} from "../shared/result";
import type {
  MoneyBudgetRepository,
  MoneyPeriodRepository,
} from "./ports";

/**
 * Period budget use cases (MONEY-05).
 *
 * A budget plan belongs to exactly one canonical `money_periods` row. Callers
 * identify the period by its inclusive dates; this use case resolves those
 * dates to the stored period and passes its id to the repository, so the
 * budget surface never edits period boundaries. Reading a period with no plan
 * returns `null` (not a zero-filled invented budget). Routine spending never
 * writes a plan, target or coffee limit.
 */

export type MoneyBudgetDependencies = Readonly<{
  budgets: MoneyBudgetRepository;
  periods: Pick<MoneyPeriodRepository, "findByExactRange">;
}>;

function mapFailure(
  code: RepositoryFailure["code"] | undefined,
  fallback: string,
): ApplicationResult<never> {
  const mapped: ApplicationErrorCode =
    code === "notFound" || code === "conflict" || code === "forbidden"
      ? code
      : "unknown";
  const message =
    code === "notFound"
      ? "Budget plan was not found. Refresh and try again."
      : code === "conflict"
        ? "The budget plan changed. Refresh and try again."
        : code === "forbidden"
          ? "You do not have permission to change this budget plan."
          : fallback;
  return applicationFailure(message, mapped);
}

function mapResult<T>(
  result:
    | Readonly<{ ok: true; value: T }>
    | Readonly<{ ok: false; error: RepositoryFailure }>,
  fallback: string,
): ApplicationResult<T> {
  if (result.ok) return applicationSuccess(result.value);
  return mapFailure(result.error.code, fallback);
}

type ResolvedPeriod = Readonly<{ period: MoneyPeriod }>;

/**
 * Resolve the caller's inclusive dates to the one canonical period. An
 * ambiguous or missing period is refused instead of silently inventing a plan.
 */
async function resolvePeriod(
  actor: AuthenticatedActor,
  periods: Pick<MoneyPeriodRepository, "findByExactRange">,
  range: Readonly<{ periodStartDate: string; periodEndDate: string }>,
): Promise<ApplicationResult<ResolvedPeriod>> {
  const found = await periods.findByExactRange(actor, {
    startDate: range.periodStartDate,
    endDate: range.periodEndDate,
  });
  if (!found.ok) {
    return mapFailure(found.error.code, "Unable to load the money period right now.");
  }
  if (found.value.length === 0) {
    return applicationFailure(
      "No money period exists for those dates. Create the period before setting a budget.",
      "notFound",
    );
  }
  if (found.value.length > 1) {
    return applicationFailure(
      "More than one money period matches those dates. Resolve the period first.",
      "conflict",
    );
  }
  return applicationSuccess({ period: found.value[0] });
}

function emptyValues(period: MoneyPeriod): MoneyBudgetPlanValues {
  return {
    periodId: period.id,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    allocations: {},
    savingsTargetMinor: null,
    emergencyTargetMinor: null,
    coffeeWeeklySpendLimitMinor: null,
    coffeeWeeklyVisitLimit: null,
  };
}

function mergeAllocations(
  current: MoneyBudgetAllocations,
  patch: Partial<Record<ExpenseCategory, number | null>>,
): MoneyBudgetAllocations {
  const merged: Record<string, number> = { ...current };
  for (const [category, amount] of Object.entries(patch)) {
    if (amount === null || amount === undefined) {
      delete merged[category];
    } else {
      merged[category] = amount;
    }
  }
  return merged as MoneyBudgetAllocations;
}

function applyPatch(
  current: MoneyBudgetPlanValues,
  patch: MoneyBudgetPatchValues,
): MoneyBudgetPlanValues {
  return {
    periodId: current.periodId,
    periodStartDate: current.periodStartDate,
    periodEndDate: current.periodEndDate,
    allocations: patch.allocations
      ? mergeAllocations(current.allocations, patch.allocations)
      : current.allocations,
    savingsTargetMinor:
      patch.savingsTargetMinor === undefined
        ? current.savingsTargetMinor
        : patch.savingsTargetMinor,
    emergencyTargetMinor:
      patch.emergencyTargetMinor === undefined
        ? current.emergencyTargetMinor
        : patch.emergencyTargetMinor,
    coffeeWeeklySpendLimitMinor:
      patch.coffeeWeeklySpendLimitMinor === undefined
        ? current.coffeeWeeklySpendLimitMinor
        : patch.coffeeWeeklySpendLimitMinor,
    coffeeWeeklyVisitLimit:
      patch.coffeeWeeklyVisitLimit === undefined
        ? current.coffeeWeeklyVisitLimit
        : patch.coffeeWeeklyVisitLimit,
  };
}

function planValues(plan: MoneyBudgetPlan): MoneyBudgetPlanValues {
  return {
    periodId: plan.periodId,
    periodStartDate: plan.periodStartDate,
    periodEndDate: plan.periodEndDate,
    allocations: plan.allocations,
    savingsTargetMinor: plan.savingsTargetMinor,
    emergencyTargetMinor: plan.emergencyTargetMinor,
    coffeeWeeklySpendLimitMinor: plan.coffeeWeeklySpendLimitMinor,
    coffeeWeeklyVisitLimit: plan.coffeeWeeklyVisitLimit,
  };
}

export async function getMoneyBudgetPlan(
  actor: AuthenticatedActor,
  dependencies: MoneyBudgetDependencies,
  input: unknown,
): Promise<ApplicationResult<MoneyBudgetPlan | null>> {
  const parsed = parseMoneyBudgetPeriodInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const resolved = await resolvePeriod(actor, dependencies.periods, parsed.value);
  if (!resolved.ok) return resolved;
  return mapResult(
    await dependencies.budgets.getPlan(actor, {
      periodId: resolved.data.period.id,
      periodStartDate: resolved.data.period.startDate,
      periodEndDate: resolved.data.period.endDate,
    }),
    "Unable to load the budget plan right now.",
  );
}

/**
 * Full save from the web form. `version: 0` creates the period plan; any other
 * value must match the current plan version. Only the active tracking period
 * accepts a budget edit; an ended period stays view-only.
 */
export async function saveMoneyBudgetPlan(
  actor: AuthenticatedActor,
  dependencies: MoneyBudgetDependencies,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<MoneyBudgetPlan>> {
  const parsed = parseMoneyBudgetPlanSaveInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const { expectedVersion, ...wireValues } = parsed.value;
  const resolved = await resolvePeriod(actor, dependencies.periods, wireValues);
  if (!resolved.ok) return resolved;
  if (!periodAcceptsRoutineEntries(resolved.data.period)) {
    return applicationFailure(
      "Only the active tracking period accepts budget edits.",
      "conflict",
    );
  }
  const values: MoneyBudgetPlanValues = {
    ...wireValues,
    periodId: resolved.data.period.id,
  };
  const nowIso = (options.now ?? new Date()).toISOString();

  const existing = await dependencies.budgets.getPlan(actor, {
    periodId: values.periodId,
    periodStartDate: values.periodStartDate,
    periodEndDate: values.periodEndDate,
  });
  if (!existing.ok) {
    return mapFailure(existing.error.code, "Unable to load the budget plan right now.");
  }

  if (expectedVersion === 0) {
    if (existing.value) {
      return applicationFailure(
        "A budget plan already exists for this period. Refresh and edit the current plan.",
        "conflict",
      );
    }
    return mapResult(
      await dependencies.budgets.createPlan(actor, { values, createdAt: nowIso }),
      "Unable to save the budget plan right now.",
    );
  }

  if (!existing.value) {
    return applicationFailure(
      "Budget plan was not found. Refresh and try again.",
      "notFound",
    );
  }
  if (existing.value.version !== expectedVersion) {
    return applicationFailure(
      "The budget plan changed. Refresh and try again.",
      "conflict",
    );
  }
  return mapResult(
    await dependencies.budgets.updatePlan(actor, existing.value.id, {
      values,
      expectedVersion,
      updatedAt: nowIso,
    }),
    "Unable to save the budget plan right now.",
  );
}

/**
 * Partial edit used by MCP `ega_money_set_allocation` and the web allocation
 * controls. Absent fields stay unchanged; a null value clears one allocation
 * or target. Version fencing prevents lost updates.
 */
export async function patchMoneyBudgetPlan(
  actor: AuthenticatedActor,
  dependencies: MoneyBudgetDependencies,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<MoneyBudgetPlan>> {
  const parsed = parseMoneyBudgetPatchInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const patch = parsed.value;
  const resolved = await resolvePeriod(actor, dependencies.periods, patch);
  if (!resolved.ok) return resolved;
  if (!periodAcceptsRoutineEntries(resolved.data.period)) {
    return applicationFailure(
      "Only the active tracking period accepts budget edits.",
      "conflict",
    );
  }
  const period = resolved.data.period;
  const nowIso = (options.now ?? new Date()).toISOString();

  const existing = await dependencies.budgets.getPlan(actor, {
    periodId: period.id,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
  });
  if (!existing.ok) {
    return mapFailure(existing.error.code, "Unable to load the budget plan right now.");
  }

  if (!existing.value) {
    if (patch.expectedVersion !== 0) {
      return applicationFailure(
        "Budget plan was not found. Refresh and try again.",
        "notFound",
      );
    }
    const values = applyPatch(emptyValues(period), patch);
    return mapResult(
      await dependencies.budgets.createPlan(actor, { values, createdAt: nowIso }),
      "Unable to save the budget plan right now.",
    );
  }

  if (existing.value.version !== patch.expectedVersion) {
    return applicationFailure(
      "The budget plan changed. Refresh and try again.",
      "conflict",
    );
  }
  const values = applyPatch(planValues(existing.value), patch);
  return mapResult(
    await dependencies.budgets.updatePlan(actor, existing.value.id, {
      values,
      expectedVersion: patch.expectedVersion,
      updatedAt: nowIso,
    }),
    "Unable to save the budget plan right now.",
  );
}
