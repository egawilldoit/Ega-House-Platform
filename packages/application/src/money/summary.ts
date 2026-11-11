import type { MoneyDirection, MoneyKind } from "@ega/domain/money";
import { MONEY_TRACKED_CASH_BOUNDARY, type MoneyTrackedCashBoundary } from "@ega/domain/money";
import { getLocalDateInTimezone } from "@ega/domain/time-context";

import type {
  MoneyAggregate,
  MoneyAggregateRow,
  MoneyPeriodRead,
} from "./ports";

/**
 * MONEY-04 cash and spending math.
 *
 * `recorded cash = opening + posted inflows - posted outflows` where the
 * opening term excludes its own row from the in/out terms. Expenses, income,
 * savings transfers and reconciliation adjustments are all rows of the same
 * ledger; nothing is double-counted and no floating point is involved.
 */

export type MoneyStateReason =
  | "period_table_unavailable"
  | "no_period"
  | "period_uninitialized"
  | "unknown_opening"
  | "multiple_openings"
  | "history_truncated";

export type MoneyStatePeriod = Readonly<{
  /** False when `money_periods` is not present in this deployment yet. */
  available: boolean;
  id: string | null;
  startDate: string | null;
  endDate: string | null;
  activeDate: string | null;
  timezone: string | null;
  lifecycle: MoneyPeriodSnapshotLifecycle | null;
  initialization: MoneyPeriodSnapshotInitialization | null;
  openingMovementId: string | null;
  provenance: Record<string, unknown> | null;
}>;

type MoneyPeriodSnapshotLifecycle = "tracking" | "ended" | "rolled_over";
type MoneyPeriodSnapshotInitialization = "uninitialized" | "initialized" | "reconciled";

export type MoneyState = Readonly<{
  currency: "MAD";
  cutoff: string;
  timezone: string | null;
  boundary: MoneyTrackedCashBoundary;
  openingMinor: number;
  inflowsMinor: number;
  outflowsMinor: number;
  recordedCashMinor: number;
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
  period: MoneyStatePeriod;
  completeness: Readonly<{
    /** True only when period context and the opening are both known. */
    confirmed: boolean;
    truncated: boolean;
    reasons: MoneyStateReason[];
  }>;
}>;

export type MoneyStateOptions = Readonly<{
  cutoff: string;
  timezone: string | null;
  period: MoneyPeriodRead;
  now?: Date;
}>;

function isOpening(row: MoneyAggregateRow): boolean {
  return row.kind === "opening";
}

function sumRows(
  rows: readonly MoneyAggregateRow[],
  predicate: (row: MoneyAggregateRow) => boolean,
): number {
  let total = 0;
  for (const row of rows) {
    if (predicate(row)) total += row.amountMinor;
  }
  return total;
}

export function todayForState(options: {
  now?: Date;
  timezone: string | null;
}): string {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? "UTC";
  return getLocalDateInTimezone(now, timezone);
}

export function computeMoneyState(
  aggregate: MoneyAggregate,
  options: MoneyStateOptions,
): MoneyState {
  const { rows } = aggregate;
  const period = options.period.period;

  const openingRows = rows.filter(isOpening);
  const openingMinor = sumRows(openingRows, () => true);
  const inflowsMinor = sumRows(
    rows,
    (row) => row.direction === "in" && !isOpening(row),
  );
  const outflowsMinor = sumRows(rows, (row) => row.direction === "out");
  const expenseTotalMinor = sumRows(rows, (row) => row.kind === "expense");
  const dailyIncludedSpendMinor = sumRows(
    rows,
    (row) => row.kind === "expense" && row.countsInDaily,
  );
  const savingsFundedMinor = sumRows(
    rows,
    (row) => row.kind === "savings_transfer" && row.direction === "out",
  );

  const reasons: MoneyStateReason[] = [];
  if (!options.period.available) {
    reasons.push("period_table_unavailable");
  } else if (!period) {
    reasons.push("no_period");
  } else {
    if (period.initialization === "uninitialized") {
      reasons.push("period_uninitialized");
    }
  }
  if (openingRows.length === 0) {
    reasons.push("unknown_opening");
  } else if (openingRows.length > 1) {
    reasons.push("multiple_openings");
  }
  if (aggregate.truncated) {
    reasons.push("history_truncated");
  }

  return {
    currency: "MAD",
    cutoff: options.cutoff,
    timezone: options.timezone ?? period?.timezone ?? null,
    boundary: MONEY_TRACKED_CASH_BOUNDARY,
    openingMinor,
    inflowsMinor,
    outflowsMinor,
    recordedCashMinor: openingMinor + inflowsMinor - outflowsMinor,
    expenseTotalMinor,
    dailyIncludedSpendMinor,
    savingsFundedMinor,
    counts: {
      movements: rows.length,
      expenses: rows.filter((row) => row.kind === "expense").length,
      dailyIncludedExpenses: rows.filter(
        (row) => row.kind === "expense" && row.countsInDaily,
      ).length,
      savingsTransfers: rows.filter((row) => row.kind === "savings_transfer").length,
      openingMovements: openingRows.length,
    },
    period: {
      available: options.period.available,
      id: period?.id ?? null,
      startDate: period?.startDate ?? null,
      endDate: period?.endDate ?? null,
      activeDate: period?.activeDate ?? null,
      timezone: period?.timezone ?? null,
      lifecycle: period?.lifecycle ?? null,
      initialization: period?.initialization ?? null,
      openingMovementId: period?.openingMovementId ?? null,
      provenance: period?.provenance ?? null,
    },
    completeness: {
      confirmed: reasons.length === 0,
      truncated: aggregate.truncated,
      reasons,
    },
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
