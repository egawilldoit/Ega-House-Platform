import {
  calculateMoneyDailyReference,
  calculateMoneyReserves,
  type MoneyOpening,
  type MoneyPeriod,
  type MoneyPeriodLifecycle,
} from "@ega/domain/money";
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
import type { MoneyBudgetRepository } from "./ports";
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

/**
 * Current daily guidance at the effective projection cutoff (MONEY-001 Q11).
 * `basis` says whether the inputs are retained day-start evidence or a
 * read-only derivation from the day-start ledger and the current period plan;
 * a missing or incomplete baseline is never presented as zero.
 */
export type MoneyDailyReferenceProjection =
  | Readonly<{
      available: false;
      currency: "MAD";
      date: string;
      basis: null;
      reason: string;
    }>
  | Readonly<{
      available: true;
      currency: "MAD";
      date: string;
      basis: "day_start_baseline" | "derived_start_of_day";
      historical: boolean;
      allowanceAvailable: boolean;
      algorithm: string;
      daysRemaining: number;
      safePoolMinor: number;
      referenceMinor: number;
      dailyIncludedExpenseMinor: number;
      dailyRemainingMinor: number;
    }>;

/** One current read model so cash, reserves and daily guidance describe one date. */
export type MoneyCurrentReserveProjection = MoneyReserveProjection &
  Readonly<{ dailyReference: MoneyDailyReferenceProjection }>;

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

function unavailableDailyReference(
  date: string,
  reason: string,
): MoneyDailyReferenceProjection {
  return { available: false, currency: "MAD", date, basis: null, reason };
}

function projectDailyReference(input: Readonly<{
  date: string;
  basis: "day_start_baseline" | "derived_start_of_day";
  startCashMinor: number | null;
  startCommitmentsMinor: number | null;
  startSavingsTargetMinor: number | null;
  savingsFundedBeforeMinor: number | null;
  startEmergencyTargetMinor: number | null;
  emergencyUsedBeforeMinor: number | null;
  periodEnd: string;
  periodLifecycle: MoneyPeriodLifecycle;
  dailyIncludedExpenseMinor: number;
}>): MoneyDailyReferenceProjection {
  const reference = calculateMoneyDailyReference({
    startCashMinor: input.startCashMinor,
    startCommitmentsMinor: input.startCommitmentsMinor,
    startSavingsTargetMinor: input.startSavingsTargetMinor,
    savingsFundedBeforeMinor: input.savingsFundedBeforeMinor,
    startEmergencyTargetMinor: input.startEmergencyTargetMinor,
    emergencyUsedBeforeMinor: input.emergencyUsedBeforeMinor,
    periodEnd: input.periodEnd,
    selectedDate: input.date,
    dailyIncludedExpenseMinor: input.dailyIncludedExpenseMinor,
    periodLifecycle: input.periodLifecycle,
  });
  if (!reference.available) {
    return unavailableDailyReference(input.date, reference.reason);
  }
  return {
    available: true,
    currency: "MAD",
    date: input.date,
    basis: input.basis,
    historical: reference.historical,
    allowanceAvailable: reference.allowanceAvailable,
    algorithm: reference.algorithm,
    daysRemaining: reference.daysRemaining,
    safePoolMinor: reference.safePoolMinor,
    referenceMinor: reference.referenceMinor,
    dailyIncludedExpenseMinor: reference.dailyIncludedExpenseMinor,
    dailyRemainingMinor: reference.dailyRemainingMinor,
  };
}

/**
 * Daily guidance for the effective cutoff without writing anything.
 *
 * A retained available day-start baseline is authoritative and keeps its
 * historical meaning. When that exact day has no retained row, derive the
 * actual start-of-day ledger inputs from the canonical reserve read at the
 * exclusive prior-day cutoff (`cutoffDate - 1`): cash, unpaid commitments and
 * funded/emergency totals are then genuinely before the selected day. The
 * current period plan supplies the targets. This is explicitly labelled
 * guidance, never a fabricated historical baseline, and it is only offered for
 * the owner's current tracking day. Incomplete reads stay unavailable.
 */
async function readCurrentDailyReference(input: Readonly<{
  actor: AuthenticatedActor;
  periods: MoneyPeriodRepository;
  period: MoneyPeriod;
  cutoffDate: string;
  localToday: string;
  savingsTargetMinor: number;
  emergencyTargetMinor: number;
}>): Promise<MoneyDailyReferenceProjection> {
  if (!input.periods.getDayStartBaseline) {
    return unavailableDailyReference(
      input.cutoffDate,
      "day_start_baseline_unavailable",
    );
  }
  const baselineResult = await input.periods.getDayStartBaseline(
    input.actor,
    input.period.id,
    input.cutoffDate,
  );
  if (!baselineResult.ok) {
    return unavailableDailyReference(
      input.cutoffDate,
      "day_start_baseline_unavailable",
    );
  }

  const readDailyTotal = async (): Promise<number | null> => {
    if (!input.periods.getDailyIncludedExpenseTotal) return null;
    const totalResult = await input.periods.getDailyIncludedExpenseTotal(
      input.actor,
      input.period.id,
      input.cutoffDate,
    );
    if (!totalResult.ok || !totalResult.value.complete) return null;
    return totalResult.value.amountMinor;
  };

  const baseline = baselineResult.value;
  if (baseline) {
    if (baseline.availability !== "available") {
      return unavailableDailyReference(
        input.cutoffDate,
        baseline.unavailableReason ?? "baseline_unavailable",
      );
    }
    const dailyTotal = await readDailyTotal();
    if (dailyTotal === null) {
      return unavailableDailyReference(
        input.cutoffDate,
        "daily_expense_total_unavailable",
      );
    }
    return projectDailyReference({
      date: input.cutoffDate,
      basis: "day_start_baseline",
      startCashMinor: baseline.cashMinor,
      startCommitmentsMinor: baseline.commitmentsMinor,
      startSavingsTargetMinor: baseline.savingsTargetMinor,
      savingsFundedBeforeMinor: baseline.savingsFundedMinor,
      startEmergencyTargetMinor: baseline.emergencyTargetMinor,
      emergencyUsedBeforeMinor: baseline.emergencyUsedMinor,
      periodEnd: input.period.endDate,
      periodLifecycle: input.period.lifecycle,
      dailyIncludedExpenseMinor: dailyTotal,
    });
  }

  // Read-only derivation is only honest once the owner explicitly completed
  // the initial obligation setup. Before that the obligation baseline is
  // unknown, so a derived daily number would invent a plan the owner never
  // confirmed. A retained baseline still speaks for its own day.
  if (!input.period.dayStartSetupCompleted) {
    return unavailableDailyReference(
      input.cutoffDate,
      "initial_setup_incomplete",
    );
  }

  const canDeriveCurrentDay =
    input.period.lifecycle === "tracking" &&
    input.cutoffDate === input.localToday &&
    input.cutoffDate > input.period.startDate &&
    input.cutoffDate <= input.period.endDate;
  if (!canDeriveCurrentDay) {
    return unavailableDailyReference(
      input.cutoffDate,
      "day_start_baseline_missing",
    );
  }

  const startOfDay = await input.periods.getReserveInputs(
    input.actor,
    input.period.id,
    addDaysToIsoDate(input.cutoffDate, -1),
  );
  if (!startOfDay.ok) {
    return unavailableDailyReference(
      input.cutoffDate,
      "start_of_day_inputs_unavailable",
    );
  }
  if (!startOfDay.value.available) {
    return unavailableDailyReference(
      input.cutoffDate,
      startOfDay.value.reason || "start_of_day_inputs_unavailable",
    );
  }

  const dailyTotal = await readDailyTotal();
  if (dailyTotal === null) {
    return unavailableDailyReference(
      input.cutoffDate,
      "daily_expense_total_unavailable",
    );
  }
  return projectDailyReference({
    date: input.cutoffDate,
    basis: "derived_start_of_day",
    startCashMinor: startOfDay.value.recordedCashMinor,
    startCommitmentsMinor: startOfDay.value.unpaidCommitmentsMinor,
    startSavingsTargetMinor: input.savingsTargetMinor,
    savingsFundedBeforeMinor: startOfDay.value.savingsFundedMinor,
    startEmergencyTargetMinor: input.emergencyTargetMinor,
    emergencyUsedBeforeMinor: startOfDay.value.emergencyUsedMinor,
    periodEnd: input.period.endDate,
    periodLifecycle: input.period.lifecycle,
    dailyIncludedExpenseMinor: dailyTotal,
  });
}

/** Shared current reserve read. Cash, commitments, funded savings and emergency
 * usage come from the one canonical database read that also backs close
 * evidence, so the two surfaces cannot disagree on their predicate. The plan
 * remains the owner of the savings and emergency targets.
 *
 * `cutoffDate` and `localToday` are the caller-resolved effective projection
 * cutoff and owner-local date. Both cash and daily guidance use this one date,
 * so a lagging active tracking cursor cannot make the current view stale. */
export async function getCurrentMoneyReserves(actor: AuthenticatedActor, input: Readonly<{
  period: MoneyPeriod;
  periods: MoneyPeriodRepository;
  budgets: MoneyBudgetRepository;
  cutoffDate: string;
  localToday: string;
}>): Promise<ApplicationResult<MoneyCurrentReserveProjection>> {
  const { period, cutoffDate } = input;
  if (cutoffDate < period.startDate || cutoffDate > period.endDate) {
    // An explicit historical date can fall outside the selected period. The
    // canonical reserve read only defines cutoffs inside its own period, so
    // report unavailable instead of failing the whole Money state.
    return applicationSuccess({
      available: false,
      currency: "MAD",
      reason: "cutoff_outside_period",
      cutoffDate,
      dailyReference: unavailableDailyReference(
        cutoffDate,
        "cutoff_outside_period",
      ),
    });
  }
  const [reserveInputs, plan] = await Promise.all([
    input.periods.getReserveInputs(actor, period.id, cutoffDate),
    input.budgets.getPlan(actor, {
      periodId: period.id,
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
    }),
  ]);
  if (!reserveInputs.ok) {
    return applicationFailure(
      "Unable to calculate current reserves right now.",
      reserveInputs.error.code,
    );
  }
  if (!plan.ok) {
    return applicationFailure(
      "Unable to calculate current reserves right now.",
      plan.error.code,
    );
  }
  if (
    !reserveInputs.value.available ||
    !plan.value ||
    plan.value.savingsTargetMinor === null ||
    plan.value.emergencyTargetMinor === null
  ) {
    const reason = !reserveInputs.value.available
      ? reserveInputs.value.reason
      : "reserve_inputs_incomplete";
    return applicationSuccess({
      available: false,
      currency: "MAD",
      reason,
      cutoffDate,
      dailyReference: unavailableDailyReference(cutoffDate, reason),
    });
  }

  const reserves = calculateMoneyReserves({
    recordedCashMinor: reserveInputs.value.recordedCashMinor,
    unpaidCommitmentsMinor: reserveInputs.value.unpaidCommitmentsMinor,
    savingsTargetMinor: plan.value.savingsTargetMinor,
    savingsFundedMinor: reserveInputs.value.savingsFundedMinor,
    emergencyTargetMinor: plan.value.emergencyTargetMinor,
    emergencyUsedMinor: reserveInputs.value.emergencyUsedMinor,
  });
  const dailyReference = await readCurrentDailyReference({
    actor,
    periods: input.periods,
    period,
    cutoffDate,
    localToday: input.localToday,
    savingsTargetMinor: plan.value.savingsTargetMinor,
    emergencyTargetMinor: plan.value.emergencyTargetMinor,
  });

  return applicationSuccess({
    available: true,
    currency: "MAD",
    cutoffDate,
    reserves,
    dailyReference,
  });
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
