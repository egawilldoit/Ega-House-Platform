import {
  canonicalCoffeeVisitPayload,
  getCoffeeWeekWindow,
  isMoneyCoffeeVisitKey,
  parseMoneyCoffeeVisitInput,
  parseMoneyCoffeeVisitListInput,
  parseMoneyCoffeeWindowInput,
  parseMoneyExpenseClassificationInput,
  summarizeCoffeeWindow,
  type CoffeeWindowSummary,
  type MoneyCoffeeVisitRecord,
  type MoneyExpenseClassificationValues,
} from "@ega/domain/money";
import {
  isExpenseId,
  type ExpenseCategory,
  type PersonalExpense,
} from "@ega/domain/expenses";
import { addDaysToIsoDate } from "@ega/domain/time-context";

import type { AuthenticatedActor } from "../auth/actor";
import { updateExpense } from "../expenses/service";
import type { ExpenseRepository } from "../expenses/ports";
import { sha256Hex } from "../shared/hash";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
  type RepositoryFailure,
} from "../shared/result";
import type { MoneyCoffeeVisitRepository } from "./ports";

/**
 * Counted coffee visit and explicit classification use cases (MONEY-05).
 *
 * A visit references canonical `personal_expenses` rows. It stores no second
 * amount, so counted spend always comes from the ledger. One visit counts once
 * even when several purchase lines belong to it. A purchase explicitly
 * classified as groceries is never attached to a counted visit.
 */

function mapFailure(
  code: RepositoryFailure["code"] | undefined,
  fallback: string,
): ApplicationResult<never> {
  const mapped =
    code === "notFound" || code === "conflict" || code === "forbidden"
      ? code
      : "unknown";
  const message =
    code === "notFound"
      ? "Coffee visit was not found. Refresh and try again."
      : code === "conflict"
        ? "The coffee visit changed. Refresh and try again."
        : code === "forbidden"
          ? "You do not have permission to change this coffee visit."
          : fallback;
  return applicationFailure(message, mapped);
}

export type RecordCoffeeVisitOutcome = Readonly<{
  visit: MoneyCoffeeVisitRecord;
  replayed: boolean;
}>;

/**
 * Record one counted visit. `visitKey` is the stable retry identity; a replay
 * with the same canonical payload returns the stored visit and never appends
 * another visit or another cash effect.
 */
export async function recordMoneyCoffeeVisit(
  actor: AuthenticatedActor,
  dependencies: Readonly<{
    expenses: ExpenseRepository;
    coffee: MoneyCoffeeVisitRepository;
  }>,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<RecordCoffeeVisitOutcome>> {
  const parsed = parseMoneyCoffeeVisitInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const values = parsed.value;

  for (const expenseId of values.expenseIds) {
    const expense = await dependencies.expenses.get(actor, expenseId);
    if (!expense.ok) {
      return mapFailure(
        expense.error.code,
        "Unable to check the coffee expense right now.",
      );
    }
    if (!expense.value) {
      return applicationFailure(
        "A referenced coffee expense was not found. Record the purchase first.",
        "validation",
      );
    }
    if (expense.value.category !== "coffee") {
      return applicationFailure(
        "Only a coffee-category expense can be counted as a coffee visit. A coffee purchase explicitly classified as groceries stays groceries and is not counted.",
        "validation",
      );
    }
  }

  const visitFingerprint = sha256Hex(canonicalCoffeeVisitPayload(values));
  const existing = await dependencies.coffee.findByVisitKey(actor, values.visitKey);
  if (!existing.ok) {
    return mapFailure(
      existing.error.code,
      "Unable to check the coffee visit right now.",
    );
  }
  if (existing.value) {
    if (existing.value.visitFingerprint !== visitFingerprint) {
      return applicationFailure(
        "That visit key was already used for a different coffee visit.",
        "conflict",
      );
    }
    return applicationSuccess({ visit: existing.value, replayed: true });
  }

  const nowIso = (options.now ?? new Date()).toISOString();
  const created = await dependencies.coffee.createVisit(actor, {
    values,
    visitFingerprint,
    createdAt: nowIso,
  });
  if (created.ok) {
    return applicationSuccess({ visit: created.value, replayed: false });
  }
  if (created.error.code === "conflict") {
    // A concurrent submit can win the unique key after our pre-check.
    const raced = await dependencies.coffee.findByVisitKey(actor, values.visitKey);
    if (raced.ok && raced.value) {
      if (raced.value.visitFingerprint === visitFingerprint) {
        return applicationSuccess({ visit: raced.value, replayed: true });
      }
      return applicationFailure(
        "That visit key was already used for a different coffee visit.",
        "conflict",
      );
    }
  }
  return mapFailure(created.error.code, "Unable to save the coffee visit right now.");
}

export async function listMoneyCoffeeVisits(
  actor: AuthenticatedActor,
  repository: MoneyCoffeeVisitRepository,
  input: unknown,
): Promise<ApplicationResult<Readonly<{ visits: MoneyCoffeeVisitRecord[] }>>> {
  const parsed = parseMoneyCoffeeVisitListInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const result = await repository.listVisits(actor, parsed.value);
  if (!result.ok) {
    return mapFailure(result.error.code, "Unable to load coffee visits right now.");
  }
  return applicationSuccess({ visits: result.value });
}

export async function deleteMoneyCoffeeVisit(
  actor: AuthenticatedActor,
  repository: MoneyCoffeeVisitRepository,
  input: Readonly<{ id: unknown; version: unknown }>,
  options: Readonly<{ now?: Date }> = {},
): Promise<
  ApplicationResult<Readonly<{ id: string; alreadyDeleted: boolean }>>
> {
  if (!isExpenseId(input.id)) {
    return applicationFailure("Coffee visit was not found.", "notFound");
  }
  if (
    typeof input.version !== "number" ||
    !Number.isInteger(input.version) ||
    input.version < 1
  ) {
    return applicationFailure(
      "Provide the current coffee visit version.",
      "validation",
    );
  }
  const nowIso = (options.now ?? new Date()).toISOString();
  const result = await repository.deleteVisit(
    actor,
    input.id.trim(),
    input.version,
    nowIso,
  );
  if (!result.ok) {
    return mapFailure(result.error.code, "Unable to delete the coffee visit right now.");
  }
  return applicationSuccess(result.value);
}

function countedVisitTotals(visits: readonly MoneyCoffeeVisitRecord[]): Readonly<{
  countedVisitCount: number;
  countedVisitSpendMinor: number;
}> {
  let countedVisitCount = 0;
  let countedVisitSpendMinor = 0;
  for (const visit of visits) {
    let countedInVisit = 0;
    for (const line of visit.lines) {
      if (line.deletedAt === null && line.category === "coffee") {
        countedInVisit += line.amountMinor;
      }
    }
    if (countedInVisit > 0) {
      countedVisitCount += 1;
      countedVisitSpendMinor += countedInVisit;
    }
  }
  return { countedVisitCount, countedVisitSpendMinor };
}

/**
 * Counted coffee window over owner-local dates clipped to the period, with
 * counted visits, counted visit spend, category coffee and both limits kept
 * distinct. Category-coffee spending not linked to a visit stays visible as
 * `uncountedCategoryCoffeeSpendMinor`.
 */
export async function getMoneyCoffeeWindow(
  actor: AuthenticatedActor,
  dependencies: Readonly<{
    expenses: ExpenseRepository;
    coffee: MoneyCoffeeVisitRepository;
  }>,
  input: unknown,
): Promise<ApplicationResult<CoffeeWindowSummary>> {
  const parsed = parseMoneyCoffeeWindowInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");

  let window: ReturnType<typeof getCoffeeWeekWindow>;
  try {
    window = getCoffeeWeekWindow(parsed.value);
  } catch (error) {
    return applicationFailure(
      error instanceof Error ? error.message : "Unable to resolve the coffee week.",
      "validation",
    );
  }

  const PAGE_SIZE = 200;
  const MAX_VISITS = 5_000;
  const visits: MoneyCoffeeVisitRecord[] = [];
  let truncated = false;
  for (let offset = 0; offset < MAX_VISITS; offset += PAGE_SIZE) {
    const page = await dependencies.coffee.listVisits(actor, {
      from: window.weekStart,
      to: window.weekEnd,
      limit: PAGE_SIZE,
      offset,
    });
    if (!page.ok) {
      return mapFailure(page.error.code, "Unable to load coffee visits right now.");
    }
    visits.push(...page.value);
    if (page.value.length < PAGE_SIZE) break;
    if (visits.length >= MAX_VISITS) {
      truncated = true;
      break;
    }
  }

  // Booking-date bounds are authoritative: they include date-only coffee rows
  // and stay stable across the owner timezone and DST boundaries.
  const category = await dependencies.expenses.summarize(actor, {
    startUtcIso: window.startUtcIso,
    endUtcExclusiveIso: window.endUtcExclusiveIso,
    startBookingDate: window.weekStart,
    endBookingDateExclusive: addDaysToIsoDate(window.weekEnd, 1),
  });
  if (!category.ok) {
    return mapFailure(
      category.error.code,
      "Unable to load coffee spending right now.",
    );
  }
  const totals = countedVisitTotals(visits);

  return applicationSuccess(
    summarizeCoffeeWindow({
      window,
      truncated: truncated || category.value.truncated,
      countedVisitCount: totals.countedVisitCount,
      countedVisitSpendMinor: totals.countedVisitSpendMinor,
      categoryCoffeeSpendMinor: category.value.totalsByCategory.coffee ?? 0,
      spendLimitMinor: parsed.value.spendLimitMinor,
      visitLimit: parsed.value.visitLimit,
    }),
  );
}

export type ClassifyMoneyExpenseOutcome = Readonly<{
  expense: PersonalExpense;
  previousCategory: ExpenseCategory;
  countedCoffeeVisitIds: string[];
  countedCoffeeUsageChanged: boolean;
}>;

/**
 * Explicit category classification. This is the same versioned expense update
 * used by every other surface; it never creates a visit. Reclassifying a
 * counted coffee line away from coffee reduces counted usage honestly, and the
 * receipt reports the affected visit ids.
 */
export async function classifyMoneyExpense(
  actor: AuthenticatedActor,
  dependencies: Readonly<{
    expenses: ExpenseRepository;
    coffee: MoneyCoffeeVisitRepository;
  }>,
  input: unknown,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<ClassifyMoneyExpenseOutcome>> {
  const parsed = parseMoneyExpenseClassificationInput(input);
  if (!parsed.ok) return applicationFailure(parsed.message, "validation");
  const values: MoneyExpenseClassificationValues = parsed.value;

  const current = await dependencies.expenses.get(actor, values.expenseId);
  if (!current.ok) {
    return mapFailure(
      current.error.code,
      "Unable to load the expense right now.",
    );
  }
  if (!current.value) {
    return applicationFailure(
      "Expense was not found or is no longer available.",
      "notFound",
    );
  }

  const visits = await dependencies.coffee.listVisitIdsForExpense(
    actor,
    values.expenseId,
  );
  if (!visits.ok) {
    return mapFailure(
      visits.error.code,
      "Unable to check counted coffee usage right now.",
    );
  }

  const updated = await updateExpense(
    actor,
    dependencies.expenses,
    values.expenseId,
    {
      version: values.expectedVersion,
      category: values.category,
      ...(values.note !== undefined ? { note: values.note } : {}),
      ...(values.needVsWant !== undefined
        ? { needVsWant: values.needVsWant }
        : {}),
    },
    options,
  );
  if (!updated.ok) {
    const code =
      updated.code === "notFound" || updated.code === "conflict" || updated.code === "forbidden"
        ? updated.code
        : "unknown";
    return applicationFailure(updated.errorMessage, code);
  }

  return applicationSuccess({
    expense: updated.data,
    previousCategory: current.value.category,
    countedCoffeeVisitIds: visits.value,
    countedCoffeeUsageChanged:
      current.value.category === "coffee" && values.category !== "coffee",
  });
}

export function isValidCoffeeVisitKey(value: unknown): value is string {
  return isMoneyCoffeeVisitKey(value);
}
