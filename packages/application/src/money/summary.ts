import type { MoneyOpening, MoneyPeriod } from "@ega/domain/money";
import type { MoneyDirection, MoneyKind } from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
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
  repository: MoneyPeriodRepository,
  period: MoneyPeriod,
  opening: MoneyOpening | null,
): Promise<ApplicationResult<MoneyCashPosition>> {
  const cutoffDate = period.activeDate;

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
  let openingMovements = 0;
  let savingsTransfers = 0;
  let dailyIncludedExpenses = 0;
  let expenses = 0;

  for (const row of rows) {
    if (row.kind === "expense") {
      expenses += 1;
      expenseTotalMinor += row.amountMinor;
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
