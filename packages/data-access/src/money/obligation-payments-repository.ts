import type {
  AuthenticatedActor,
  ObligationPaymentCorrectionRecordInput,
  ObligationPaymentOutcome,
  ObligationPaymentRecord,
  ObligationPaymentRecordInput,
  ObligationPaymentRepository,
  ObligationPaymentUndoRecordInput,
  RepositoryFailure,
  RepositoryResult,
} from "@ega/application";
import type { ExpenseCategory, ExpenseNeedVsWant } from "@ega/domain/expenses";
import type { MoneyPurpose } from "@ega/domain/money";
import type { ObligationPaymentMethod } from "@ega/domain/obligations";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  toObligationOccurrence,
  type ObligationRow,
} from "./obligations-repository";

/**
 * Request-scoped Supabase adapter for MONEY-07 obligation payments.
 *
 * The whole write happens inside one database function: the payment row and
 * the occurrence link are committed together or not at all. The owner is
 * derived inside the database from the verified session, so this adapter never
 * sends an owner id and never splits the write into two client statements.
 */

type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  constraint?: string;
} | null;

type PaymentRow = {
  expense_id: string;
  amount_minor: number;
  currency: string;
  booking_date: string;
  counts_in_daily: boolean;
  need_vs_want: string;
  payment_method: string | null;
  purpose: string | null;
  category: string | null;
};

type PaymentRpcResult = {
  outcome?: string;
  occurrence?: unknown;
  payment?: unknown;
};

/**
 * Payment failures keep the small persistence-independent vocabulary:
 * `notFound` for an unknown occurrence, `validation` for a refused input,
 * `forbidden` for a missing grant and `conflict` for a stale, settled or
 * already-used request.
 */
function paymentFailure(error: SupabaseError): RepositoryFailure {
  if (!error) return { code: "unknown" };
  switch (error.code) {
    case "42501":
      return { code: "forbidden" };
    case "P0002":
      return { code: "notFound" };
    case "22023":
      return { code: "validation" };
    case "23505":
    case "23514":
    case "40001":
      return { code: "conflict" };
    default:
      return { code: "unknown" };
  }
}

function toPaymentRecord(value: unknown): ObligationPaymentRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as unknown as PaymentRow;
  if (!row.expense_id) return null;
  return {
    expenseId: String(row.expense_id),
    amountMinor: Number(row.amount_minor),
    currency: "MAD",
    bookingDate: String(row.booking_date),
    countsInDaily: Boolean(row.counts_in_daily),
    needVsWant: String(row.need_vs_want) as ExpenseNeedVsWant,
    paymentMethod:
      row.payment_method === null
        ? null
        : (String(row.payment_method) as ObligationPaymentMethod),
    purpose: String(row.purpose ?? "fixed") as MoneyPurpose,
    category: String(row.category ?? "other") as ExpenseCategory,
  };
}

function toOutcome(value: unknown): RepositoryResult<ObligationPaymentOutcome> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: { code: "unknown" } };
  }
  const result = value as PaymentRpcResult;
  if (!result.occurrence || typeof result.occurrence !== "object") {
    return { ok: false, error: { code: "unknown" } };
  }
  return {
    ok: true,
    value: {
      occurrence: toObligationOccurrence(result.occurrence as ObligationRow),
      payment: toPaymentRecord(result.payment),
      replayed: result.outcome === "replayed",
    },
  };
}

export class SupabaseObligationPaymentRepository
  implements ObligationPaymentRepository
{
  constructor(private readonly supabase: SupabaseClient) {}

  async pay(
    _actor: AuthenticatedActor,
    input: ObligationPaymentRecordInput,
  ): Promise<RepositoryResult<ObligationPaymentOutcome>> {
    const { data, error } = await this.supabase.rpc("money_pay_obligation", {
      p_occurrence_id: input.occurrenceId,
      p_expected_version: input.expectedVersion,
      p_booking_date: input.bookingDate,
      p_idempotency_key: input.idempotencyKey,
      p_need_vs_want: input.needVsWant,
      p_counts_in_daily: input.countsInDaily,
      p_payment_method: input.paymentMethod,
      p_operation_id: input.operationId,
    });
    if (error) return { ok: false, error: paymentFailure(error) };
    return toOutcome(data);
  }

  async correct(
    _actor: AuthenticatedActor,
    input: ObligationPaymentCorrectionRecordInput,
  ): Promise<RepositoryResult<ObligationPaymentOutcome>> {
    const { data, error } = await this.supabase.rpc(
      "money_correct_obligation_payment",
      {
        p_occurrence_id: input.occurrenceId,
        p_expected_version: input.expectedVersion,
        p_amount_minor: input.amountMinor,
        p_booking_date: input.bookingDate,
        p_counts_in_daily: input.countsInDaily,
        p_operation_id: input.operationId,
      },
    );
    if (error) return { ok: false, error: paymentFailure(error) };
    return toOutcome(data);
  }

  async undo(
    _actor: AuthenticatedActor,
    input: ObligationPaymentUndoRecordInput,
  ): Promise<RepositoryResult<ObligationPaymentOutcome>> {
    const { data, error } = await this.supabase.rpc(
      "money_undo_obligation_payment",
      {
        p_occurrence_id: input.occurrenceId,
        p_expected_version: input.expectedVersion,
        p_operation_id: input.operationId,
      },
    );
    if (error) return { ok: false, error: paymentFailure(error) };
    return toOutcome(data);
  }
}
