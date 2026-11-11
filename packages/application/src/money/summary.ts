import type { MoneyOpening, MoneyPeriod } from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
import type { MoneyPeriodRepository } from "./ports";

/**
 * Canonical recorded-cash calculation.
 *
 * `recorded cash = opening + posted inflows through cutoff - posted outflows
 * through cutoff`. The opening movement itself is never counted as an inflow;
 * the adapter excludes `kind = 'opening'` explicitly. This is a recorded model,
 * not a bank reconciliation, and an incomplete aggregation is reported as
 * unavailable instead of a partial cash number.
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
