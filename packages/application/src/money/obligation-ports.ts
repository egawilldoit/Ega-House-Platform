import type {
  ExpenseCategory,
  ExpenseNeedVsWant,
} from "@ega/domain/expenses";
import type {
  MoneyPurpose,
} from "@ega/domain/money";
import type {
  ObligationCreateValues,
  ObligationKind,
  ObligationOccurrence,
  ObligationState,
  ObligationTemplate,
  ObligationTemplateCreateValues,
  ObligationTemplateUpdateValues,
  ObligationUpdateChanges,
} from "@ega/domain/obligations";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * Persistence ports for MONEY-06 obligations.
 *
 * Every operation takes the verified actor. Implementations must filter
 * `owner_user_id` in addition to request-scoped RLS; owner identity is never
 * accepted from a payload, query or path.
 */

export type ObligationIdempotencyReceipt = Readonly<{
  occurrence: ObligationOccurrence;
  createFingerprint: string;
}>;

export type ObligationTemplateIdempotencyReceipt = Readonly<{
  template: ObligationTemplate;
  createFingerprint: string;
}>;

export type ObligationCreateRecordInput = Readonly<{
  values: ObligationCreateValues;
  createFingerprint: string;
}>;

export type ObligationUpdateRecordInput = Readonly<{
  changes: ObligationUpdateChanges;
  expectedVersion: number;
  updatedAt: string;
}>;

export type ObligationTransitionRecordInput = Readonly<{
  /** State the caller read; the update is guarded on it as well as version. */
  fromState: ObligationState;
  to: ObligationState;
  effectiveDate: string;
  reason: string | null;
  expectedVersion: number;
  updatedAt: string;
}>;

export type ObligationListRecordQuery = Readonly<{
  kind: ObligationKind | null;
  state: ObligationState | null;
  dueFrom: string | null;
  dueTo: string | null;
  limit: number;
  offset: number;
}>;

export type ObligationTemplateCreateRecordInput = Readonly<{
  values: ObligationTemplateCreateValues;
  createFingerprint: string;
}>;

export type ObligationTemplateUpdateRecordInput = Readonly<{
  changes: Omit<ObligationTemplateUpdateValues, "expectedVersion">;
  expectedVersion: number;
  updatedAt: string;
}>;

export type ObligationTemplateListRecordQuery = Readonly<{
  kind: ObligationKind | null;
  includeArchived: boolean;
}>;

export type ObligationRepository = {
  findByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<ObligationIdempotencyReceipt | null>>;
  create(
    actor: AuthenticatedActor,
    input: ObligationCreateRecordInput,
  ): Promise<RepositoryResult<ObligationOccurrence>>;
  get(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<ObligationOccurrence | null>>;
  list(
    actor: AuthenticatedActor,
    query: ObligationListRecordQuery,
  ): Promise<RepositoryResult<ObligationOccurrence[]>>;
  update(
    actor: AuthenticatedActor,
    id: string,
    input: ObligationUpdateRecordInput,
  ): Promise<RepositoryResult<ObligationOccurrence>>;
  transition(
    actor: AuthenticatedActor,
    id: string,
    input: ObligationTransitionRecordInput,
  ): Promise<RepositoryResult<ObligationOccurrence>>;

  findTemplateByIdempotencyKey(
    actor: AuthenticatedActor,
    idempotencyKey: string,
  ): Promise<RepositoryResult<ObligationTemplateIdempotencyReceipt | null>>;
  createTemplate(
    actor: AuthenticatedActor,
    input: ObligationTemplateCreateRecordInput,
  ): Promise<RepositoryResult<ObligationTemplate>>;
  getTemplate(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<ObligationTemplate | null>>;
  listTemplates(
    actor: AuthenticatedActor,
    query: ObligationTemplateListRecordQuery,
  ): Promise<RepositoryResult<ObligationTemplate[]>>;
  updateTemplate(
    actor: AuthenticatedActor,
    id: string,
    input: ObligationTemplateUpdateRecordInput,
  ): Promise<RepositoryResult<ObligationTemplate>>;
};

/**
 * MONEY-07 transaction seam — declared here, implemented by MONEY-07.
 *
 * Atomicity requirement: the implementation must run in ONE owner-scoped
 * database transaction (a SQL function/RPC or equivalent) and derive the owner
 * inside that boundary. It must, in the same transaction:
 *   1. lock the occurrence and re-check its `expectedVersion`, `pending` state
 *      and full amount;
 *   2. insert exactly one canonical `personal_expenses` outflow whose booking
 *      date is the payment date;
 *   3. set the occurrence to `paid` with `payment_expense_id` and the retained
 *      effective date;
 *   4. commit both halves together, rolling back both on any failure.
 *
 * It must call `assertObligationPaymentSeam` (application) — which delegates to
 * `validateObligationPayment` (domain) — before linking, so partial or
 * overpayment is rejected rather than falsely marked fully paid. Retries are
 * bound to a stable operation id; a different operation id cannot pay an
 * already-paid occurrence twice.
 *
 * This issue deliberately does NOT implement the payment: creating the payment
 * and linking it must not be simulated with two independent client writes.
 */
export type ObligationPaymentSettlementInput = Readonly<{
  occurrenceId: string;
  expectedVersion: number;
  amountMinor: number;
  paymentExpenseId: string;
  bookingDate: string;
  currency: "MAD";
  direction: "out";
  needVsWant: ExpenseNeedVsWant;
  purpose?: MoneyPurpose;
  countsInDaily?: boolean;
  category?: ExpenseCategory;
}>;

export type ObligationPaymentSettlementPort = {
  settlePayment(
    actor: AuthenticatedActor,
    input: ObligationPaymentSettlementInput,
  ): Promise<RepositoryResult<ObligationOccurrence>>;
};
