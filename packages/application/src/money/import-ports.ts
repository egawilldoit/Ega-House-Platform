import type {
  MoneyImportAdoptionStatus,
  MoneyImportApproval,
  MoneyImportManifest,
  MoneyImportOpeningStrategy,
  MoneyImportSourceSnapshot,
  MoneyImportTargetCoffeeVisit,
  MoneyImportTargetMovement,
  MoneyImportTargetObligation,
} from "@ega/domain/money-import";

import type { AuthenticatedActor } from "../auth/actor";
import type { ExpenseRepository } from "../expenses/ports";
import type { RepositoryResult } from "../shared/result";
import type {
  MoneyCoffeeVisitRepository,
  MoneyMovementRepository,
  MoneyPeriodRepository,
} from "./ports";

export type {
  MoneyImportTargetCoffeeVisit,
  MoneyImportTargetMovement,
  MoneyImportTargetObligation,
} from "@ega/domain/money-import";

/**
 * Persistence ports for November workbook adoption (MONEY-001-B).
 *
 * The import repository stores only owner-scoped adoption evidence: the frozen
 * source snapshot, the approved manifest and the post-apply reconciliation. It
 * never writes a financial row. Ledger writes stay on the canonical money
 * repositories below.
 */

export type MoneyImportRange = Readonly<{
  startDate: string;
  endDate: string;
}>;

export type MoneyImportAppliedCounts = Readonly<{
  totalSourceRows: number;
  ledgerInserted: number;
  ledgerLinked: number;
  ledgerAlreadyApplied: number;
  openingApplied: boolean;
  coffeeVisitsLinked: number;
  paidBillsLinked: number;
  unpaidBillsMetadata: number;
  skippedRows: number;
}>;

export type MoneyImportPostReconciliation = Readonly<{
  complete: boolean;
  periodId: string | null;
  expectedClosingMinor: number;
  recordedClosingMinor: number | null;
  differenceMinor: number | null;
  openingAmountMinor: number | null;
  movementCount: number;
  coffeeVisitCount: number;
  discrepancies: readonly Readonly<{
    code: string;
    message: string;
    sourceRowIds: readonly string[];
  }>[];
  checkedAt: string;
  statusReason: string | null;
}>;

export type MoneyImportAdoptionFields = Readonly<{
  snapshotId: string;
  snapshotDigest: string;
  manifestDigest: string;
  sourceIdentity: string;
  targetEnvironment: string;
  openingStrategy: MoneyImportOpeningStrategy;
  cutoverDate: string;
  status: MoneyImportAdoptionStatus;
  snapshot: MoneyImportSourceSnapshot;
  manifest: MoneyImportManifest;
  approval: MoneyImportApproval;
  appliedCounts: MoneyImportAppliedCounts | null;
  postReconciliation: MoneyImportPostReconciliation | null;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
}>;

export type MoneyImportAdoptionWrite = MoneyImportAdoptionFields;

export type MoneyImportAdoptionRecord = MoneyImportAdoptionFields &
  Readonly<{ id: string }>;

export type MoneyImportRepository = {
  listTargetMovements(
    actor: AuthenticatedActor,
    range: MoneyImportRange,
  ): Promise<RepositoryResult<MoneyImportTargetMovement[]>>;
  listTargetMovementsBefore(
    actor: AuthenticatedActor,
    beforeDate: string,
    limit: number,
  ): Promise<RepositoryResult<MoneyImportTargetMovement[]>>;
  listTargetObligations(
    actor: AuthenticatedActor,
    range: MoneyImportRange,
  ): Promise<RepositoryResult<MoneyImportTargetObligation[]>>;
  listTargetCoffeeVisits(
    actor: AuthenticatedActor,
    range: MoneyImportRange,
  ): Promise<RepositoryResult<MoneyImportTargetCoffeeVisit[]>>;
  getAdoption(
    actor: AuthenticatedActor,
    snapshotId: string,
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord | null>>;
  beginAdoption(
    actor: AuthenticatedActor,
    record: MoneyImportAdoptionWrite,
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord>>;
  completeAdoption(
    actor: AuthenticatedActor,
    record: MoneyImportAdoptionRecord,
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord>>;
  markAdoptionReview(
    actor: AuthenticatedActor,
    record: MoneyImportAdoptionRecord,
  ): Promise<RepositoryResult<MoneyImportAdoptionRecord>>;
  listMovementsByKeys(
    actor: AuthenticatedActor,
    keys: readonly string[],
  ): Promise<RepositoryResult<MoneyImportTargetMovement[]>>;
};

export type NovemberImportDependencies = Readonly<{
  imports: MoneyImportRepository;
  periods: MoneyPeriodRepository;
  movements: MoneyMovementRepository;
  coffee: MoneyCoffeeVisitRepository;
  expenses: ExpenseRepository;
}>;
