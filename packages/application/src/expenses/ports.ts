import type {
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

export type ExpenseRepository = {
  findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<PersonalExpense | null>>;
  create(
    actor: AuthenticatedActor,
    input: ExpenseCreateValues,
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
  softDelete(
    actor: AuthenticatedActor,
    id: string,
    nowIso: string,
  ): Promise<RepositoryResult<ExpenseDeleteOutcome>>;
};
