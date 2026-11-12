import type {
  ExpenseCategory,
  ExpenseNeedVsWant,
} from "@ega/domain/expenses";
import type { MoneyPurpose } from "@ega/domain/money";
import type {
  ObligationOccurrence,
  ObligationPaymentMethod,
} from "@ega/domain/obligations";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence ports for MONEY-07 obligation payments.
 *
 * The payment is one owner-scoped database transaction: the implementation
 * derives the owner inside the database boundary and never accepts an owner
 * from a payload. `pay`, `correct` and `undo` are the only writers of a
 * linked ledger payment; a generic expense edit cannot settle or orphan an
 * occurrence.
 */

/** The canonical ledger row that settles an occurrence. */
export type ObligationPaymentRecord = Readonly<{
  expenseId: string;
  amountMinor: number;
  currency: "MAD";
  bookingDate: string;
  countsInDaily: boolean;
  needVsWant: ExpenseNeedVsWant;
  paymentMethod: ObligationPaymentMethod | null;
  purpose: MoneyPurpose;
  category: ExpenseCategory;
}>;

export type ObligationPaymentOutcome = Readonly<{
  occurrence: ObligationOccurrence;
  /** `null` only when an undo replayed an already-undone payment. */
  payment: ObligationPaymentRecord | null;
  /** True when the same operation replayed its original result. */
  replayed: boolean;
}>;

export type ObligationPaymentRecordInput = Readonly<{
  occurrenceId: string;
  expectedVersion: number;
  bookingDate: string;
  idempotencyKey: string;
  /** Resolved need/want; the occurrence snapshot is used when null. */
  needVsWant: ExpenseNeedVsWant | null;
  /** Resolved daily flag; the database applies the fixed-purpose default. */
  countsInDaily: boolean;
  paymentMethod: ObligationPaymentMethod | null;
  /** Stable retry identity of this payment operation. */
  operationId: string;
}>;

export type ObligationPaymentCorrectionRecordInput = Readonly<{
  occurrenceId: string;
  expectedVersion: number;
  amountMinor: number;
  bookingDate: string;
  /** `null` keeps the persisted daily flag. */
  countsInDaily: boolean | null;
  operationId: string;
}>;

export type ObligationPaymentUndoRecordInput = Readonly<{
  occurrenceId: string;
  expectedVersion: number;
  operationId: string;
}>;

export type ObligationPaymentRepository = {
  pay(
    actor: AuthenticatedActor,
    input: ObligationPaymentRecordInput,
  ): Promise<RepositoryResult<ObligationPaymentOutcome>>;
  correct(
    actor: AuthenticatedActor,
    input: ObligationPaymentCorrectionRecordInput,
  ): Promise<RepositoryResult<ObligationPaymentOutcome>>;
  undo(
    actor: AuthenticatedActor,
    input: ObligationPaymentUndoRecordInput,
  ): Promise<RepositoryResult<ObligationPaymentOutcome>>;
};
