import {
  EXPENSE_CATEGORY_VALUES,
  EXPENSE_MERCHANT_MAX_LENGTH,
  EXPENSE_NEED_VS_WANT_VALUES,
  EXPENSE_NOTE_MAX_LENGTH,
  EXPENSE_PAYMENT_METHOD_VALUES,
  type ExpenseCategory,
  type ExpenseNeedVsWant,
  type ExpensePaymentMethod,
} from "@ega/domain/expenses";

import { parseMadAmountToMinor } from "./money-amount";

/**
 * Client-side validation for the Money mutation forms (PO-06B, Team B).
 *
 * This mirrors the domain create/update rules so the form can reject bad
 * input before a network round-trip. The server remains authoritative: every
 * value is re-validated by `@ega/domain` via application/Hono.
 */

export type ExpenseFormValues = {
  amountInput: string;
  occurredAtInput: string;
  category: string;
  needVsWant: string;
  merchant: string;
  note: string;
  paymentMethod: string;
};

export type ValidatedExpenseFormValues = {
  amountMinor: number;
  occurredAt: string;
  category: ExpenseCategory;
  needVsWant: ExpenseNeedVsWant;
  merchant: string | null;
  note: string | null;
  paymentMethod: ExpensePaymentMethod | null;
};

export type ExpenseFormFieldErrors = Partial<
  Record<
    | "amountInput"
    | "occurredAtInput"
    | "category"
    | "needVsWant"
    | "merchant"
    | "note"
    | "paymentMethod",
    string
  >
>;

export type ExpenseFormValidation =
  | { ok: true; value: ValidatedExpenseFormValues }
  | { ok: false; fieldErrors: ExpenseFormFieldErrors };

export const EXPENSE_CATEGORY_OPTIONS: readonly ExpenseCategory[] =
  EXPENSE_CATEGORY_VALUES;
export const EXPENSE_NEED_VS_WANT_OPTIONS: readonly ExpenseNeedVsWant[] =
  EXPENSE_NEED_VS_WANT_VALUES;
export const EXPENSE_PAYMENT_METHOD_OPTIONS: readonly ExpensePaymentMethod[] =
  EXPENSE_PAYMENT_METHOD_VALUES;

function toNullableText(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/**
 * Convert a `datetime-local` input value to an ISO timestamp. Returns null
 * when the input is absent or unparseable; callers surface a field error.
 */
export function datetimeLocalToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function validateExpenseFormValues(
  values: ExpenseFormValues,
): ExpenseFormValidation {
  const fieldErrors: ExpenseFormFieldErrors = {};

  const amount = parseMadAmountToMinor(values.amountInput);
  if (!amount.ok) fieldErrors.amountInput = amount.error;

  const occurredAt = datetimeLocalToIso(values.occurredAtInput);
  if (!occurredAt) {
    fieldErrors.occurredAtInput = "Choose a valid date and time.";
  }

  if (
    !(EXPENSE_CATEGORY_VALUES as readonly string[]).includes(values.category)
  ) {
    fieldErrors.category = "Choose a supported category.";
  }
  if (
    !(EXPENSE_NEED_VS_WANT_VALUES as readonly string[]).includes(
      values.needVsWant,
    )
  ) {
    fieldErrors.needVsWant = "Choose need or want.";
  }

  const merchant = toNullableText(values.merchant);
  if (
    merchant !== null &&
    Array.from(merchant).length > EXPENSE_MERCHANT_MAX_LENGTH
  ) {
    fieldErrors.merchant = `Merchant must be ${EXPENSE_MERCHANT_MAX_LENGTH} characters or fewer.`;
  }
  const note = toNullableText(values.note);
  if (note !== null && Array.from(note).length > EXPENSE_NOTE_MAX_LENGTH) {
    fieldErrors.note = `Note must be ${EXPENSE_NOTE_MAX_LENGTH} characters or fewer.`;
  }

  let paymentMethod: ExpensePaymentMethod | null = null;
  if (values.paymentMethod !== "" && values.paymentMethod !== undefined) {
    if (
      !(EXPENSE_PAYMENT_METHOD_VALUES as readonly string[]).includes(
        values.paymentMethod,
      )
    ) {
      fieldErrors.paymentMethod = "Choose a supported payment method.";
    } else {
      paymentMethod = values.paymentMethod as ExpensePaymentMethod;
    }
  }

  if (
    !amount.ok ||
    !occurredAt ||
    Object.keys(fieldErrors).length > 0
  ) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      amountMinor: (amount as { ok: true; value: number }).value,
      occurredAt: (occurredAt as string),
      category: values.category as ExpenseCategory,
      needVsWant: values.needVsWant as ExpenseNeedVsWant,
      merchant,
      note,
      paymentMethod,
    },
  };
}
