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
  MoneyRolloverCloseSnapshotAssessment,
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

export type MoneyRolloverSourceContext = Readonly<{
  period: MoneyPeriod;
  /** Latest effective policy settings for the source period. */
  effectiveSettings: MoneyPeriodSettings;
  /** Modeled recorded cash through the source end date; null when unknown. */
  modeledClosingCashMinor: number | null;
  /** False when a bounded aggregation could not read the whole window. */
  cashComplete: boolean;
  pendingOccurrences: readonly MoneyRolloverPendingOccurrence[];
  /** True when the payer occurrence read hit a bounded page cap. */
  pendingOccurrencesTruncated: boolean;
  /** MONEY-09 close evidence compared with the live restated totals. */
  closeSnapshots: MoneyRolloverCloseSnapshotAssessment;
  /** Corrections from a rolled-over predecessor that targeted this period. */
  priorCorrectionBridges: readonly MoneyRolloverBridgeRecord[];
  existingSuccessorPeriodId: string | null;
  /** Already-created successor for a replayed operation, if any. */
  existingRollover: MoneyRolloverRecord | null;
}>;

export type MoneyRolloverBridgeRecord = Readonly<{
  id: string;
  sourcePeriodId: string;
  destinationPeriodId: string;
  movementId: string;
  correctionVersion: number;
  amountMinor: number;
  direction: "in" | "out";
  bookingDate: string;
  applied: boolean;
  varianceReason:
    | "verified_opening_covered_cutoff"
    | "verified_opening_excludes_correction"
    | null;
  createdAt: string;
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
  /** Explicit overrides layered over the source's latest effective policy. */
  settingsOverrides: MoneyPeriodSettings | null;
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
  listCorrectionBridges(
    actor: AuthenticatedActor,
    destinationPeriodId: string,
  ): Promise<RepositoryResult<readonly MoneyRolloverBridgeRecord[]>>;
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
 * Historical-correction bridges are applied by the canonical
 * `personal_expenses_rollover_bridge` database trigger, not by an application
 * repository method: the trigger runs inside the same transaction as every
 * movement edit/delete, so no surface can commit a correction without it.
 */
