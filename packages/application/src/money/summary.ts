import { calculateMoneyReserves, type MoneyOpening, type MoneyPeriod } from "@ega/domain/money";
import type { MoneyDirection, MoneyKind } from "@ega/domain/money";
import type { ExpenseCategory } from "@ega/domain/expenses";
import {
  addDaysToIsoDate,
  getLocalDayWindow,
  isIsoDate,
  isValidIANATimeZone,
} from "@ega/domain/time-context";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
import type { ExpenseRepository } from "../expenses/ports";
import { summarizeObligationOccurrences } from "@ega/domain/obligations";
import type { MoneyBudgetRepository, MoneyMovementRepository } from "./ports";
import type { ObligationRepository } from "./obligation-ports";
import type {
  MoneyAggregate,
  MoneyAggregateRow,
  MoneyPeriodRepository,
} from "./ports";

/**
 * Canonical recorded-cash calculation.
 *
 * `recorded cash = opening + posted inflows through cutoff - posted outflows
 * through cutoff`. The opening movement itself is never counted as an inflow;
 * the adapter excludes `kind = 'opening'` explicitly. This is a recorded model,
 * not a bank reconciliation, and an incomplete aggregation is reported as
 * unavailable instead of a partial cash number.
 *
 * MONEY-04 adds the movement reporting totals below. They never re-implement
 * the cash formula: expense spending, daily-included spending and funded
 * savings are disjoint projections of the same ledger rows, so no row is
 * counted twice.
 */

export type MoneyCashPosition =
  | Readonly<{
      available: false;
      currency: "MAD";
      reason: string;
      cutoffDate: string;
    }>
  | Readonly<{
      available: true;
      currency: "MAD";
      basis: "recorded";
      cutoffDate: string;
      openingMinor: number;
      inflowsMinor: number;
      outflowsMinor: number;
      recordedCashMinor: number;
      recordCount: number;
    }>;

export async function getMoneyCashPosition(
  actor: AuthenticatedActor,
  repository: Pick<MoneyPeriodRepository, "sumLedgerByDirection">,
  period: MoneyPeriod,
  opening: Pick<MoneyOpening, "amountMinor"> | null,
  cutoffOverride?: string,
): Promise<ApplicationResult<MoneyCashPosition>> {
  const cutoffDate = cutoffOverride ?? period.activeDate;

  if (opening === null) {
    return applicationSuccess({
      available: false,
      currency: "MAD",
      reason:
        "Opening cash is unknown. Initialize the period with a known amount (zero is valid) to show recorded cash.",
      cutoffDate,
    });
  }

  const totals = await repository.sumLedgerByDirection(actor, {
    startDate: period.startDate,
    endDateInclusive: cutoffDate,
  });
  if (!totals.ok) {
    return applicationFailure(
      "Unable to calculate recorded cash right now.",
      totals.error.code,
    );
  }
  if (totals.value.truncated) {
    return applicationSuccess({
      available: false,
      currency: "MAD",
      reason:
        "Recorded cash is unavailable because the ledger window exceeds the bounded aggregation limit.",
      cutoffDate,
    });
  }

  return applicationSuccess({
    available: true,
    currency: "MAD",
    basis: "recorded",
    cutoffDate,
    openingMinor: opening.amountMinor,
    inflowsMinor: totals.value.inflowsMinor,
    outflowsMinor: totals.value.outflowsMinor,
    recordedCashMinor:
      opening.amountMinor +
      totals.value.inflowsMinor -
      totals.value.outflowsMinor,
    recordCount: totals.value.recordCount,
  });
}

export type MoneyMovementTotals = Readonly<{
  currency: "MAD";
  expenseTotalMinor: number;
  dailyIncludedSpendMinor: number;
  savingsFundedMinor: number;
  emergencyUsedMinor: number;
  counts: Readonly<{
    movements: number;
    expenses: number;
    dailyIncludedExpenses: number;
    savingsTransfers: number;
    openingMovements: number;
  }>;

  /** True when the bounded aggregation stopped before the whole history. */
  truncated: boolean;
}>;

/** Current reserve read model. Missing or incomplete source data stays unavailable. */
export type MoneyReserveProjection =
  | Readonly<{ available: false; currency: "MAD"; reason: string; cutoffDate: string }>
  | Readonly<{ available: true; currency: "MAD"; cutoffDate: string; reserves: ReturnType<typeof calculateMoneyReserves> }>;

/** Compose canonical cash, obligation, and reserve totals in the application layer. */
export function projectMoneyReserves(input: Readonly<{
  cutoffDate: string;
  recordedCashMinor: number | null;
  unpaidCommitmentsMinor: number | null;
  savingsTargetMinor: number | null;
  savingsFundedMinor: number | null;
  emergencyTargetMinor: number | null;
  emergencyUsedMinor: number | null;
  complete: boolean;
}>): MoneyReserveProjection {
  const values = [input.recordedCashMinor, input.unpaidCommitmentsMinor, input.savingsTargetMinor,
    input.savingsFundedMinor, input.emergencyTargetMinor, input.emergencyUsedMinor];
  if (!input.complete || values.some((value) => value === null)) {
    return { available: false, currency: "MAD", reason: "reserve_inputs_incomplete", cutoffDate: input.cutoffDate };
  }
  const [recordedCashMinor, unpaidCommitmentsMinor, savingsTargetMinor, savingsFundedMinor, emergencyTargetMinor, emergencyUsedMinor] = values as number[];
  return { available: true, currency: "MAD", cutoffDate: input.cutoffDate,
    reserves: calculateMoneyReserves({ recordedCashMinor, unpaidCommitmentsMinor, savingsTargetMinor, savingsFundedMinor, emergencyTargetMinor, emergencyUsedMinor }) };
}

/** Shared current reserve read. Obligations are fetched through period end so future
 * commitments are visible, then lifecycle state is evaluated at the active-date cutoff. */
export async function getCurrentMoneyReserves(actor: AuthenticatedActor, input: Readonly<{
  period: MoneyPeriod;
  opening: Pick<MoneyOpening, "amountMinor"> | null;
  periods: MoneyPeriodRepository;
  movements: MoneyMovementRepository;
  budgets: MoneyBudgetRepository;
  obligations: ObligationRepository;
}>): Promise<ApplicationResult<MoneyReserveProjection>> {
  const { period } = input;
  const cash = await getMoneyCashPosition(actor, input.periods, period, input.opening);
  if (!cash.ok) return applicationFailure(cash.errorMessage, cash.code);
  if (!cash.data.available) return applicationSuccess({ available: false, currency: "MAD", reason: cash.data.reason, cutoffDate: period.activeDate });
  const [movement, plan, occurrences] = await Promise.all([
    input.movements.aggregate(actor, { cutoff: period.activeDate, startDate: period.startDate }),
    input.budgets.getPlan(actor, { periodId: period.id, periodStartDate: period.startDate, periodEndDate: period.endDate }),
    input.obligations.list(actor, { kind: null, state: null, dueFrom: period.startDate, dueTo: period.endDate, limit: 500, offset: 0 }),
  ]);
  if (!movement.ok) return applicationFailure("Unable to calculate current reserves right now.", movement.error.code);
  if (!plan.ok) return applicationFailure("Unable to calculate current reserves right now.", plan.error.code);
  if (!occurrences.ok) return applicationFailure("Unable to calculate current reserves right now.", occurrences.error.code);
  if (!plan.value || movement.value.truncated || occurrences.value.length >= 500) {
    return applicationSuccess({ available: false, currency: "MAD", reason: "reserve_inputs_incomplete", cutoffDate: period.activeDate });
  }
  const totals = computeMoneyMovementTotals(movement.value);
  const commitmentTotals = summarizeObligationOccurrences(occurrences.value, period.activeDate);
  return applicationSuccess(projectMoneyReserves({
    cutoffDate: period.activeDate, recordedCashMinor: cash.data.recordedCashMinor,
    unpaidCommitmentsMinor: commitmentTotals.outstandingMinor,
    savingsTargetMinor: plan.value.savingsTargetMinor,
    savingsFundedMinor: totals.savingsFundedMinor,
    emergencyTargetMinor: plan.value.emergencyTargetMinor,
    emergencyUsedMinor: totals.emergencyUsedMinor, complete: !totals.truncated,
  }));
}

/**
 * Projection of the ledger rows through a cutoff. `truncated` is surfaced so a
 * bounded read is never presented as a complete total.
 */
export function computeMoneyMovementTotals(
  aggregate: MoneyAggregate,
): MoneyMovementTotals {
  const { rows } = aggregate;
  let expenseTotalMinor = 0;
  let dailyIncludedSpendMinor = 0;
  let savingsFundedMinor = 0;
  let emergencyUsedMinor = 0;
  let openingMovements = 0;
  let savingsTransfers = 0;
  let dailyIncludedExpenses = 0;
  let expenses = 0;

  for (const row of rows) {
    if (row.kind === "expense") {
      expenses += 1;
      expenseTotalMinor += row.amountMinor;
      if (row.purpose === "emergency") {
        emergencyUsedMinor += row.direction === "out" ? row.amountMinor : -row.amountMinor;
      }
      if (row.countsInDaily) {
        dailyIncludedExpenses += 1;
        dailyIncludedSpendMinor += row.amountMinor;
      }
    } else if (row.kind === "savings_transfer") {
      savingsTransfers += 1;
      if (row.direction === "out") savingsFundedMinor += row.amountMinor;
    } else if (row.kind === "opening") {
      openingMovements += 1;
    }
  }

  return {
    currency: "MAD",
    expenseTotalMinor,
    dailyIncludedSpendMinor,
    savingsFundedMinor,
    emergencyUsedMinor,
    counts: {
      movements: rows.length,
      expenses,
      dailyIncludedExpenses,
      savingsTransfers,
      openingMovements,
    },
    truncated: aggregate.truncated,
  };
}

export type MovementEffect = Readonly<{
  kind: MoneyKind;
  direction: MoneyDirection;
  cashDeltaMinor: number;
  expenseTotalDeltaMinor: number;
  dailyIncludedDeltaMinor: number;
  savingsFundedDeltaMinor: number;
}>;

/** One row's effect on the ledger, used by UI labels and tests. */
export function movementEffect(row: Pick<
  MoneyAggregateRow,
  "kind" | "direction" | "amountMinor" | "countsInDaily"
>): MovementEffect {
  const cashDeltaMinor =
    row.kind === "opening"
      ? row.amountMinor
      : row.direction === "in"
        ? row.amountMinor
        : -row.amountMinor;
  return {
    kind: row.kind,
    direction: row.direction,
    cashDeltaMinor,
    expenseTotalDeltaMinor: row.kind === "expense" ? row.amountMinor : 0,
    dailyIncludedDeltaMinor:
      row.kind === "expense" && row.countsInDaily ? row.amountMinor : 0,
    savingsFundedDeltaMinor:
      row.kind === "savings_transfer" && row.direction === "out"
        ? row.amountMinor
        : 0,
  };
}

/**
 * Category spending inside one canonical period (MONEY-05).
 *
 * Budget consumption must use the period's inclusive dates, never the current
 * calendar month: a partial period such as Nov 9–30 must not include Nov 1–8.
 * Booking-date bounds are passed to the repository so date-only rows count and
 * the result stays stable across timezone boundaries. A bounded/truncated read
 * is surfaced as such; the caller must not present it as complete.
 */
export type MoneyPeriodSpending = Readonly<{
  currency: "MAD";
  periodStartDate: string;
  periodEndDate: string;
  totalsByCategory: Partial<Record<ExpenseCategory, number>>;
  recordCount: number;
  truncated: boolean;
}>;

export async function getMoneyPeriodSpending(
  actor: AuthenticatedActor,
  expenses: Pick<ExpenseRepository, "summarize">,
  input: Readonly<{
    periodStartDate: string;
    periodEndDate: string;
    timezone: string;
  }>,
): Promise<ApplicationResult<MoneyPeriodSpending>> {
  if (!isIsoDate(input.periodStartDate) || !isIsoDate(input.periodEndDate)) {
    return applicationFailure("Use a valid period date range.", "validation");
  }
  if (input.periodEndDate < input.periodStartDate) {
    return applicationFailure(
      "The period end date must be on or after its start date.",
      "validation",
    );
  }
  if (!isValidIANATimeZone(input.timezone)) {
    return applicationFailure("Use a valid IANA timezone.", "validation");
  }

  let startUtcIso: string;
  let endUtcExclusiveIso: string;
  try {
    startUtcIso = getLocalDayWindow(input.timezone, input.periodStartDate).startUtcIso;
    endUtcExclusiveIso = getLocalDayWindow(input.timezone, input.periodEndDate).endUtcIso;
  } catch {
    return applicationFailure("Unable to resolve the period window.", "validation");
  }

  const summary = await expenses.summarize(actor, {
    startUtcIso,
    endUtcExclusiveIso,
    startBookingDate: input.periodStartDate,
    endBookingDateExclusive: addDaysToIsoDate(input.periodEndDate, 1),
  });
  if (!summary.ok) {
    return applicationFailure(
      "Unable to calculate period spending right now.",
      summary.error.code,
    );
  }
  return applicationSuccess({
    currency: "MAD",
    periodStartDate: input.periodStartDate,
    periodEndDate: input.periodEndDate,
    totalsByCategory: summary.value.totalsByCategory,
    recordCount: summary.value.recordCount,
    truncated: summary.value.truncated,
  });
}
