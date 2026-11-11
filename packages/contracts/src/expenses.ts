import type {
  ExpenseCategory,
  ExpenseCurrency,
  ExpenseNeedVsWant,
  ExpensePaymentMethod,
} from "@ega/domain/expenses";

/**
 * Wire contracts for the owner-scoped personal expense ledger (PO-06 Slice A,
 * issue #346). Amounts are positive integer centimes of MAD; the currency is
 * fixed and is never selected by a caller.
 */

export type ExpenseDto = Readonly<{
  id: string;
  occurredAt: string;
  amountMinor: number;
  currency: ExpenseCurrency;
  category: ExpenseCategory;
  note: string | null;
  merchant: string | null;
  needVsWant: ExpenseNeedVsWant;
  paymentMethod: ExpensePaymentMethod | null;
  idempotencyKey: string;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateExpenseRequest = Readonly<{
  occurredAt: string;
  amountMinor: number;
  category: ExpenseCategory;
  note?: string | null;
  merchant?: string | null;
  needVsWant: ExpenseNeedVsWant;
  paymentMethod?: ExpensePaymentMethod | null;
  idempotencyKey: string;
}>;

export type UpdateExpenseRequest = Readonly<{
  version: number;
  occurredAt?: string;
  amountMinor?: number;
  category?: ExpenseCategory;
  note?: string | null;
  merchant?: string | null;
  needVsWant?: ExpenseNeedVsWant;
  paymentMethod?: ExpensePaymentMethod | null;
}>;

export type ListExpensesQuery = Readonly<{
  /** Inclusive local start date (YYYY-MM-DD). */
  from?: string | null;
  /** Inclusive local end date (YYYY-MM-DD). */
  to?: string | null;
  /** Explicit IANA timezone; otherwise the owner's time context is used. */
  timezone?: string | null;
  limit?: number;
  offset?: number;
}>;

export type ExpensePaginationDto = Readonly<{
  limit: number;
  offset: number;
  hasMore: boolean;
  /** Offset to request next, or null when `hasMore` is false. */
  nextOffset: number | null;
}>;

/**
 * `replayed` is true when the owner+idempotency key was already consumed by a
 * create with the same immutable original payload. Replay returns the current
 * expense row (later edits are reflected) and remains true after a soft
 * delete, in which case `expense.deletedAt` is populated. The key stays
 * consumed; it is never reusable for a different payload.
 */
export type CreateExpenseResponse = Readonly<{
  ok: true;
  expense: ExpenseDto;
  replayed: boolean;
}>;

export type GetExpenseResponse = Readonly<{
  ok: true;
  expense: ExpenseDto;
}>;

export type ListExpensesResponse = Readonly<{
  ok: true;
  expenses: ExpenseDto[];
  pagination: ExpensePaginationDto;
}>;

export type UpdateExpenseResponse = Readonly<{
  ok: true;
  expense: ExpenseDto;
}>;

export type DeleteExpenseResponse = Readonly<{
  ok: true;
  id: string;
  deletedAt: string;
  alreadyDeleted: boolean;
}>;

/** The six transport error codes used by the expense routes. */
export type ExpenseErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "INTERNAL";

export type ExpenseErrorEnvelope = Readonly<{
  error: Readonly<{
    code: ExpenseErrorCode;
    message: string;
  }>;
}>;
