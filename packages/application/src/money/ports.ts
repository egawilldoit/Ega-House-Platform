import type {
  MoneyOpening,
  MoneyOpeningInput,
  MoneyPeriod,
  MoneyPeriodCreateValues,
  MoneyPeriodInitialization,
  MoneyPeriodProvenance,
  MoneyPeriodSettings,
} from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence port for period/opening state. Every operation takes the verified
 * actor; implementations filter by `owner_user_id` in addition to
 * request-scoped RLS. Opening and period writes are atomic at the adapter.
 */

export type MoneyPeriodCreateRecordInput = Readonly<{
  values: MoneyPeriodCreateValues;
  provenance: MoneyPeriodProvenance;
  openingCreateFingerprint: string | null;
  createdAt: string;
}>;

export type MoneyPeriodOpeningUpdate = Readonly<{
  values: MoneyOpeningInput;
  provenance: MoneyPeriodProvenance;
  initialization: MoneyPeriodInitialization;
  createFingerprint: string;
}>;

export type MoneyPeriodUpdateRecordInput = Readonly<{
  expectedVersion: number;
  activeDate?: string;
  settings?: MoneyPeriodSettings;
  opening?: MoneyPeriodOpeningUpdate;
  updatedAt: string;
}>;

/** Inclusive booking-date window for recorded-cash aggregation. */
export type MoneyLedgerWindow = Readonly<{
  startDate: string;
  endDateInclusive: string;
}>;

export type MoneyLedgerDirectionTotals = Readonly<{
  inflowsMinor: number;
  outflowsMinor: number;
  recordCount: number;
  truncated: boolean;
}>;

export type MoneyLedgerOverview = Readonly<{
  totalExpenseCount: number;
  assignedToPeriodCount: number;
  inPeriodUnassignedCount: number;
}>;

export type MoneyPeriodRepository = {
  findTracking(
    actor: AuthenticatedActor,
  ): Promise<RepositoryResult<MoneyPeriod | null>>;
  findById(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyPeriod | null>>;
  findByExactRange(
    actor: AuthenticatedActor,
    range: Readonly<{ startDate: string; endDate: string }>,
  ): Promise<RepositoryResult<MoneyPeriod[]>>;
  findOverlapping(
    actor: AuthenticatedActor,
    range: Readonly<{ startDate: string; endDate: string }>,
  ): Promise<RepositoryResult<MoneyPeriod[]>>;
  list(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<MoneyPeriod[]>>;
  create(
    actor: AuthenticatedActor,
    input: MoneyPeriodCreateRecordInput,
  ): Promise<RepositoryResult<MoneyPeriod>>;
  update(
    actor: AuthenticatedActor,
    id: string,
    input: MoneyPeriodUpdateRecordInput,
  ): Promise<RepositoryResult<MoneyPeriod>>;
  getOpening(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyOpening | null>>;
  sumLedgerByDirection(
    actor: AuthenticatedActor,
    window: MoneyLedgerWindow,
  ): Promise<RepositoryResult<MoneyLedgerDirectionTotals>>;
  ledgerOverview(
    actor: AuthenticatedActor,
    range: Readonly<{
      /** null when no period is configured; only the total count is known. */
      periodId: string | null;
      startDate: string;
      endDate: string;
    }>,
  ): Promise<RepositoryResult<MoneyLedgerOverview>>;
};
