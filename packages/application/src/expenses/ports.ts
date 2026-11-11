import type {
  ExpenseCategory,
  ExpenseCreateValues,
  ExpenseUpdateChanges,
  PersonalExpense,
} from "@ega/domain/expenses";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence port for the owner-scoped expense ledger. Every operation takes
 * the verified actor; implementations must filter by `owner_user_id` in
 * addition to request-scoped RLS.
 */

export type ExpenseListRecordQuery = Readonly<{
  limit: number;
  offset: number;
  startUtcIso: string | null;
  endUtcExclusiveIso: string | null;
  /** Owner-local booking-date window (preferred for dated reads). */
  startBookingDate?: string | null;
  endBookingDateExclusive?: string | null;
  /**
   * Keyset cursor for a stable export walk. When both are present the
   * repository returns rows strictly after `(beforeOccurredAt, beforeId)` in
   * the canonical `occurred_at DESC, id DESC` order. Offset paging is not
   * snapshot-safe under concurrent inserts/deletes.
   */
  beforeOccurredAt?: string | null;
  beforeBookingDate?: string | null;
  beforeId?: string | null;
}>;

/**
 * Internal receipt for owner+idempotency-key lookup. `createFingerprint` binds
 * the key to the immutable original create payload and is never exposed on the
 * wire.
 */
export type ExpenseIdempotencyReceipt = Readonly<{
  expense: PersonalExpense;
  createFingerprint: string;
}>;

export type ExpenseCreateRecordInput = Readonly<{
  values: ExpenseCreateValues;
  createFingerprint: string;
}>;

export type ExpenseUpdateRecordInput = Readonly<{
  changes: ExpenseUpdateChanges;
  expectedVersion: number;
  updatedAt: string;
}>;

export type ExpenseDeleteOutcome = Readonly<{
  id: string;
  deletedAt: string;
  alreadyDeleted: boolean;
}>;

/** Half-open UTC period for summaries (owner-local bounds resolved by caller). */
export type ExpenseSummaryWindow = Readonly<{
  startUtcIso: string;
  endUtcExclusiveIso: string;
  /** Owner-local booking-date bounds; preferred when present. */
  startBookingDate?: string | null;
  endBookingDateExclusive?: string | null;
}>;

/**
 * Integer-centime aggregates over non-deleted rows in one half-open period.
 * `truncated` is true when the row cap was hit; totals are then a lower
 * bound and callers must say so instead of presenting them as complete.
 */
export type ExpenseSummary = Readonly<{
  totalsByCategory: Partial<Record<ExpenseCategory, number>>;
  countsByCategory: Partial<Record<ExpenseCategory, number>>;
  recordCount: number;
  truncated: boolean;
}>;

export type ExpenseRepository = {
  findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<ExpenseIdempotencyReceipt | null>>;
  create(
    actor: AuthenticatedActor,
    input: ExpenseCreateRecordInput,
  ): Promise<RepositoryResult<PersonalExpense>>;
  get(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<PersonalExpense | null>>;
  list(
    actor: AuthenticatedActor,
    query: ExpenseListRecordQuery,
  ): Promise<RepositoryResult<PersonalExpense[]>>;
  update(
    actor: AuthenticatedActor,
    id: string,
    input: ExpenseUpdateRecordInput,
  ): Promise<RepositoryResult<PersonalExpense>>;
  /**
   * Soft delete. When `expectedVersion` is supplied, a row that changed since
   * that read is rejected with `conflict` instead of being deleted. Omit it for
   * the existing idempotent HTTP/DELETE behavior.
   */
  softDelete(
    actor: AuthenticatedActor,
    id: string,
    nowIso: string,
    expectedVersion?: number,
  ): Promise<RepositoryResult<ExpenseDeleteOutcome>>;
  summarize(
    actor: AuthenticatedActor,
    window: ExpenseSummaryWindow,
  ): Promise<RepositoryResult<ExpenseSummary>>;
  /**
   * Exact non-deleted row count for the window. Export uses it to refuse an
   * oversized range up front and to detect an intervening insert/delete.
   */
  count(
    actor: AuthenticatedActor,
    window: ExpenseSummaryWindow,
  ): Promise<RepositoryResult<number>>;
};
