import {
  parseMoneyBudgetPatchInput,
  parseMoneyBudgetPeriodInput,
  parseMoneyBudgetPlanSaveInput,
  type MoneyBudgetAllocations,
  type MoneyBudgetPatchValues,
  type MoneyBudgetPlan,
  type MoneyBudgetPlanValues,
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
import type { MoneyBudgetRepository } from "./ports";

/**
 * Period budget use cases (MONEY-05).
 *
 * A budget plan is identified by explicit inclusive period dates until
 * MONEY-03's `money_periods` row is available; at integration the period can
 * be linked without changing the stored values. Reading a period with no plan
 * returns `null` (not a zero-filled invented budget). Routine spending never
 * writes a plan, target or coffee limit.
 */

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

function emptyValues(input: Readonly<{
  periodStartDate: string;
  periodEndDate: string;
}>): MoneyBudgetPlanValues {
  return {
    periodStartDate: input.periodStartDate,
    periodEndDate: input.periodEndDate,
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

export async function getMoneyBudgetPlan(
  actor: AuthenticatedActor,
  repository: MoneyBudgetRepository,
  input: unknown,
): Promise<ApplicationResult<MoneyBudgetPlan | null>> {
  const parsed = parseMoneyBudgetPeriodInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  return mapResult(
    await repository.getPlan(actor, parsed.value),
    "Unable to load the budget plan right now.",
  );
}

/**
 * Full save from the web form. `version: 0` creates the period plan; any other
 * value must match the current plan version.
 */
export async function saveMoneyBudgetPlan(
  actor: AuthenticatedActor,
  repository: MoneyBudgetRepository,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<MoneyBudgetPlan>> {
  const parsed = parseMoneyBudgetPlanSaveInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const { expectedVersion, ...values } = parsed.value;
  const nowIso = (options.now ?? new Date()).toISOString();

  const existing = await repository.getPlan(actor, {
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
      await repository.createPlan(actor, { values, createdAt: nowIso }),
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
    await repository.updatePlan(actor, existing.value.id, {
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
  repository: MoneyBudgetRepository,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<MoneyBudgetPlan>> {
  const parsed = parseMoneyBudgetPatchInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const patch = parsed.value;
  const nowIso = (options.now ?? new Date()).toISOString();

  const existing = await repository.getPlan(actor, {
    periodStartDate: patch.periodStartDate,
    periodEndDate: patch.periodEndDate,
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
    const values = applyPatch(
      emptyValues({
        periodStartDate: patch.periodStartDate,
        periodEndDate: patch.periodEndDate,
      }),
      patch,
    );
    return mapResult(
      await repository.createPlan(actor, { values, createdAt: nowIso }),
      "Unable to save the budget plan right now.",
    );
  }

  if (existing.value.version !== patch.expectedVersion) {
    return applicationFailure(
      "The budget plan changed. Refresh and try again.",
      "conflict",
    );
  }
  const values = applyPatch(
    {
      periodStartDate: existing.value.periodStartDate,
      periodEndDate: existing.value.periodEndDate,
      allocations: existing.value.allocations,
      savingsTargetMinor: existing.value.savingsTargetMinor,
      emergencyTargetMinor: existing.value.emergencyTargetMinor,
      coffeeWeeklySpendLimitMinor: existing.value.coffeeWeeklySpendLimitMinor,
      coffeeWeeklyVisitLimit: existing.value.coffeeWeeklyVisitLimit,
    },
    patch,
  );
  return mapResult(
    await repository.updatePlan(actor, existing.value.id, {
      values,
      expectedVersion: patch.expectedVersion,
      updatedAt: nowIso,
    }),
    "Unable to save the budget plan right now.",
  );
}
