import type {
  MoneyCreateValues,
  MoneyDirection,
  MoneyKind,
  MoneyLedgerRow,
  MoneyUpdateChanges,
} from "@ega/domain/money";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence port for the canonical money ledger (the extended
 * `personal_expenses` table). Every operation takes the verified actor;
 * implementations must filter `owner_user_id` in addition to request-scoped
 * RLS. Expense-only queries remain on the existing `ExpenseRepository`.
 */

export type MoneyIdempotencyReceipt = Readonly<{
  movement: MoneyLedgerRow;
  createFingerprint: string;
}>;

export type MoneyCreateRecordInput = Readonly<{
  values: MoneyCreateValues;
  createFingerprint: string;
  periodId: string | null;
}>;

export type MoneyListRecordQuery = Readonly<{
  limit: number;
  offset: number;
  from: string | null;
  to: string | null;
  cutoff: string | null;
  kind: MoneyKind | null;
}>;

export type MoneyUpdateRecordInput = Readonly<{
  changes: MoneyUpdateChanges;
  expectedVersion: number;
  updatedAt: string;
}>;

/** Compact row projection used for the application-owned cash calculation. */
export type MoneyAggregateRow = Readonly<{
  id: string;
  kind: MoneyKind;
  direction: MoneyDirection;
  amountMinor: number;
  countsInDaily: boolean;
  bookingDate: string;
}>;

export type MoneyAggregateQuery = Readonly<{
  cutoff: string;
  /** Inclusive period start; null when no period context is available. */
  startDate: string | null;
}>;

export type MoneyAggregate = Readonly<{
  rows: MoneyAggregateRow[];
  truncated: boolean;
}>;

/**
 * Period context owned by MONEY-03 (`money_periods`). MONEY-04 reads it
 * defensively: when the period migration is not applied yet the read reports
 * `available: false` instead of inventing a period or failing the ledger.
 */
export type MoneyPeriodSnapshot = Readonly<{
  id: string;
  startDate: string;
  endDate: string;
  currency: "MAD";
  timezone: string;
  activeDate: string;
  lifecycle: "tracking" | "ended" | "rolled_over";
  initialization: "uninitialized" | "initialized" | "reconciled";
  openingMovementId: string | null;
  provenance: Record<string, unknown> | null;
  version: number;
}>;

export type MoneyPeriodRead = Readonly<{
  available: boolean;
  period: MoneyPeriodSnapshot | null;
}>;

export type MoneyRepository = {
  findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<MoneyIdempotencyReceipt | null>>;
  create(
    actor: AuthenticatedActor,
    input: MoneyCreateRecordInput,
  ): Promise<RepositoryResult<MoneyLedgerRow>>;
  get(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<MoneyLedgerRow | null>>;
  list(
    actor: AuthenticatedActor,
    query: MoneyListRecordQuery,
  ): Promise<RepositoryResult<MoneyLedgerRow[]>>;
  update(
    actor: AuthenticatedActor,
    id: string,
    input: MoneyUpdateRecordInput,
  ): Promise<RepositoryResult<MoneyLedgerRow>>;
  aggregate(
    actor: AuthenticatedActor,
    query: MoneyAggregateQuery,
  ): Promise<RepositoryResult<MoneyAggregate>>;
  getPeriod(
    actor: AuthenticatedActor,
    options?: Readonly<{ periodId?: string | null }>,
  ): Promise<RepositoryResult<MoneyPeriodRead>>;
};
