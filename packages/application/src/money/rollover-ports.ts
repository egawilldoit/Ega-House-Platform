import type {
  MoneyOpeningInput,
  MoneyPeriod,
  MoneyPeriodProvenance,
  MoneyPeriodSettings,
  MoneyPurpose,
} from "@ega/domain/money";
import type { ExpenseCategory } from "@ega/domain/expenses";
import type { ObligationCreateValues, ObligationKind } from "@ega/domain/obligations";
import type {
  MoneyRolloverOpeningMode,
  MoneyRolloverReconciliation,
  MoneyRolloverTargets,
  MoneyRolloverUnpaidTreatment,
  MoneyRolloverValues,
} from "@ega/domain/money-rollover";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence ports for explicit period rollover (MONEY-10).
 *
 * Every operation takes the verified actor and implementations filter by
 * `owner_user_id` in addition to request-scoped RLS. The write itself must run
 * in ONE owner-scoped database transaction so a partially prepared successor,
 * a duplicated opening or an orphan generated occurrence can never commit.
 */

export type MoneyRolloverPendingOccurrence = Readonly<{
  id: string;
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  dueDate: string;
  /** Template id for a recurring occurrence; null for a one-off bill. */
  templateId: string | null;
  needVsWant: "need" | "want" | null;
  purpose: MoneyPurpose;
  countsInDaily: boolean;
  category: ExpenseCategory | null;
}>;

/**
 * Integration seam for MONEY-09 day-close evidence. MONEY-09 owns the durable
 * close snapshot; until it lands this reports unavailable rather than
 * pretending the comparison passed.
 */
export type MoneyRolloverCloseSnapshotSummary =
  | Readonly<{
      available: true;
      closeCount: number;
      lastClosedDate: string | null;
      comparableToRestatedTotals: boolean;
    }>
  | Readonly<{ available: false; reason: string }>;

export type MoneyRolloverSourceContext = Readonly<{
  period: MoneyPeriod;
  /** Modeled recorded cash through the source end date; null when unknown. */
  modeledClosingCashMinor: number | null;
  /** False when a bounded aggregation could not read the whole window. */
  cashComplete: boolean;
  pendingOccurrences: readonly MoneyRolloverPendingOccurrence[];
  closeSnapshots: MoneyRolloverCloseSnapshotSummary;
  existingSuccessorPeriodId: string | null;
  /** Already-created successor for a replayed operation, if any. */
  existingRollover: MoneyRolloverRecord | null;
}>;

export type MoneyRolloverRecord = Readonly<{
  id: string;
  sourcePeriodId: string;
  successorPeriodId: string;
  successorPeriod: MoneyPeriod | null;
  operationId: string;
  requestFingerprint: string;
  openingMode: MoneyRolloverOpeningMode;
  openingAmountMinor: number;
  closingCashMinor: number | null;
  closingCutoffDate: string;
  unpaidTreatment: MoneyRolloverUnpaidTreatment | null;
  reconciliationAcceptedNote: string | null;
  generatedOccurrenceCount: number;
  carriedOccurrenceCount: number;
  cancelledOccurrenceCount: number;
  createdAt: string;
}>;

export type MoneyRolloverObligationPlanItem = Readonly<{
  values: ObligationCreateValues;
  createFingerprint: string;
}>;

export type MoneyRolloverCarryItem = Readonly<{
  occurrenceId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  idempotencyKey: string;
  createFingerprint: string;
}>;

export type MoneyRolloverWriteInput = Readonly<{
  values: MoneyRolloverValues;
  targets: MoneyRolloverTargets;
  opening: MoneyOpeningInput;
  initialized: "initialized" | "reconciled";
  provenance: MoneyPeriodProvenance;
  settings: MoneyPeriodSettings;
  operationId: string;
  requestFingerprint: string;
  openingCreateFingerprint: string;
  reconciliation: MoneyRolloverReconciliation;
  reconciliationAcceptedNote: string | null;
  obligations: readonly MoneyRolloverObligationPlanItem[];
  carriedOccurrences: readonly MoneyRolloverCarryItem[];
  createdAt: string;
}>;

export type MoneyRolloverWriteResult = Readonly<{
  record: MoneyRolloverRecord;
  replayed: boolean;
}>;

export type MoneyRolloverRepository = {
  getSourceContext(
    actor: AuthenticatedActor,
    sourcePeriodId: string,
  ): Promise<RepositoryResult<MoneyRolloverSourceContext | null>>;
  findRolloverByOperation(
    actor: AuthenticatedActor,
    operationId: string,
  ): Promise<RepositoryResult<MoneyRolloverRecord | null>>;
  rollover(
    actor: AuthenticatedActor,
    input: MoneyRolloverWriteInput,
  ): Promise<RepositoryResult<MoneyRolloverWriteResult>>;
};

/**
 * Compound historical-correction bridge seam.
 *
 * MONEY-09's correction path calls this inside the same transaction as the
 * source movement correction. The implementation must never commit a
 * correction whose downstream bridge failed, and must be idempotent on
 * `bridge:<source>:<correctionVersion>:<destination>`.
 */
export type MoneyRolloverBridgeWriteInput = Readonly<{
  sourcePeriodId: string;
  movementId: string;
  correctionVersion: number;
  correctionDate: string;
  previousCashDeltaMinor: number;
  newCashDeltaMinor: number;
  createdAt: string;
}>;

export type MoneyRolloverBridgeWriteResult = Readonly<{
  postings: number;
  variances: number;
  replayed: number;
  /** Periods that received an adjustment, in chain order. */
  destinationPeriodIds: readonly string[];
}>;

export type MoneyRolloverBridgeRepository = {
  applyBridge(
    actor: AuthenticatedActor,
    input: MoneyRolloverBridgeWriteInput,
  ): Promise<RepositoryResult<MoneyRolloverBridgeWriteResult>>;
};
