import type { MoneyPeriodLifecycle, MoneyPurpose } from "@ega/domain/money";
import type { ExpenseCategory } from "@ega/domain/expenses";
import type {
  MoneyRolloverOpeningMode,
  MoneyRolloverUnpaidTreatment,
} from "@ega/domain/money-rollover";

/**
 * Wire contracts for explicit period rollover (MONEY-10). Amounts are integer
 * MAD centimes; the owner is always derived from verified authentication and no
 * request can select an owner or a second ledger.
 */

export type MoneyRolloverOpeningRequest =
  | Readonly<{ mode: "carry_forward" }>
  | Readonly<{
      mode: "verified_source";
      amountMinor: number;
      cutoffDate: string;
      evidence: string;
      note?: string | null;
    }>;

export type MoneyRolloverRequest = Readonly<{
  /** Source period read by the caller; a stale version is a conflict. */
  sourcePeriodId: string;
  expectedVersion: number;
  startDate: string;
  endDate: string;
  opening: MoneyRolloverOpeningRequest;
  /**
   * Required when the source still has unpaid occurrences. `keep_pending`
   * leaves them in the source period; `carry_forward` creates new pending
   * occurrences for one-off bills; `cancel` writes them off explicitly.
   */
  unpaidItems?: Readonly<{
    treatment: MoneyRolloverUnpaidTreatment;
    reason?: string | null;
  }> | null;
  /** Explicit policy copy. Omitted keys keep the source period values. */
  settingsOverrides?: Readonly<Record<string, unknown>> | null;
  /** State explicitly whether days between the source and successor may be unowned. */
  allowUncoveredDays?: boolean;
  /** Required to accept a modeled-versus-verified closing difference. */
  acceptClosingDifferenceNote?: string | null;
}>;

export type MoneyRolloverWriteRequest = MoneyRolloverRequest &
  Readonly<{
    /**
     * Stable retry identity carried beside the semantic payload, never parsed
     * as one. The same operation replays its original result.
     */
    operationId: string;
  }>;

export type MoneyRolloverDifferenceDto = Readonly<{
  code:
    | "modeled_vs_verified_closing_cash"
    | "unknown_closing_cash"
    | "unpaid_occurrences"
    | "close_snapshot_restatement"
    | "paid_obligation_payment_mismatch"
    | "counted_coffee_visit_mismatch"
    | "savings_target_vs_transfers";
  amountMinor: number | null;
  status: "ok" | "choice_required" | "accepted" | "unavailable";
  message: string;
}>;

export type MoneyRolloverReconciliationDto = Readonly<{
  currency: "MAD";
  cutoffDate: string;
  modeledClosingCashMinor: number | null;
  verifiedClosingCashMinor: number | null;
  differenceMinor: number | null;
  differenceAccepted: boolean;
  pendingOccurrenceCount: number;
  pendingOccurrenceMinor: number;
  choices: readonly string[];
  blockers: readonly string[];
  differences: readonly MoneyRolloverDifferenceDto[];
}>;

export type MoneyRolloverCloseSnapshotDifferenceDto = Readonly<{
  closeId: string;
  closeDate: string;
  changedFields: readonly string[];
}>;

export type MoneyRolloverCloseSnapshotDto =
  | Readonly<{
      available: true;
      closeCount: number;
      lastClosedDate: string | null;
      comparableToRestatedTotals: true;
      restatedDifferenceCount: number;
      restatedDifferences: readonly MoneyRolloverCloseSnapshotDifferenceDto[];
      paidObligationCount: number;
      paidObligationMismatchCount: number;
      countedVisitCount: number;
      countedVisitMismatchCount: number;
      savingsTargetMinor: number | null;
      savingsTransferredMinor: number;
    }>
  | Readonly<{ available: false; reason: string }>;

export type MoneyRolloverPendingOccurrenceDto = Readonly<{
  id: string;
  kind: "bill" | "subscription";
  description: string;
  amountMinor: number;
  dueDate: string;
  templateId: string | null;
  needVsWant: "need" | "want" | null;
  purpose: MoneyPurpose;
  countsInDaily: boolean;
  category: ExpenseCategory | null;
}>;

export type MoneyRolloverWeekWindowDto = Readonly<{
  weekStart: string;
  weekEnd: string;
  clippedStart: string;
  clippedEnd: string;
  clippedToPeriod: boolean;
}>;

export type MoneyRolloverPreviewResponse = Readonly<{
  ok: true;
  source: Readonly<{
    periodId: string;
    startDate: string;
    endDate: string;
    version: number;
    lifecycle: MoneyPeriodLifecycle;
    activeDate: string;
    timezone: string;
  }>;
  targets: Readonly<{
    startDate: string;
    endDate: string;
    activeDate: string;
    timezone: string;
    inclusiveDays: number;
    uncoveredDays: number;
  }>;
  openingMode: MoneyRolloverOpeningMode;
  modeledClosingCashMinor: number | null;
  proposedOpeningMinor: number | null;
  settings: Readonly<Record<string, unknown>>;
  reconciliation: MoneyRolloverReconciliationDto;
  closeSnapshots: MoneyRolloverCloseSnapshotDto;
  pendingOccurrences: readonly MoneyRolloverPendingOccurrenceDto[];
  generatedObligations: readonly Readonly<{
    templateId: string;
    description: string;
    amountMinor: number;
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  }>[];
  carriedOccurrences: readonly Readonly<{
    occurrenceId: string;
    description: string;
    amountMinor: number;
    dueDate: string;
  }>[];
  weekWindows: readonly MoneyRolloverWeekWindowDto[];
  ready: boolean;
  choices: readonly string[];
  blockers: readonly string[];
}>;

export type MoneyRolloverRecordDto = Readonly<{
  id: string;
  sourcePeriodId: string;
  successorPeriodId: string;
  operationId: string;
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

export type MoneyRolloverResponse = Readonly<{
  ok: true;
  record: MoneyRolloverRecordDto;
  /** True when the same operation id replayed its original result. */
  replayed: boolean;
  reconciliation: MoneyRolloverReconciliationDto;
  weekWindows: readonly MoneyRolloverWeekWindowDto[];
}>;
