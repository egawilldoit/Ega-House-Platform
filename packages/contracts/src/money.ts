import type {
  ExpenseCategory,
  ExpenseCurrency,
  ExpenseNeedVsWant,
  ExpensePaymentMethod,
} from "@ega/domain/expenses";
import type {
  MoneyDirection,
  MoneyKind,
  MoneyPurpose,
} from "@ega/domain/money";

/**
 * Wire contracts for the MONEY-04 money movement ledger (the extended
 * `personal_expenses` journal). Amounts are positive integer MAD centimes and
 * `kind`/`direction` carry the sign. Owner identity and currency are never
 * caller-selected.
 */

export type MoneyMovementDto = Readonly<{
  id: string;
  kind: MoneyKind;
  direction: MoneyDirection;
  amountMinor: number;
  currency: ExpenseCurrency;
  category: ExpenseCategory | null;
  note: string | null;
  merchant: string | null;
  needVsWant: ExpenseNeedVsWant | null;
  paymentMethod: ExpensePaymentMethod | null;
  purpose: MoneyPurpose | null;
  countsInDaily: boolean;
  /** Inclusive owner-local booking date; occurrence time may be unknown. */
  bookingDate: string;
  occurredAt: string | null;
  periodId: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CreateMovementRequest = Readonly<{
  kind: Exclude<MoneyKind, "opening">;
  direction?: MoneyDirection;
  amountMinor: number;
  category?: ExpenseCategory | null;
  note?: string | null;
  merchant?: string | null;
  needVsWant?: ExpenseNeedVsWant | null;
  paymentMethod?: ExpensePaymentMethod | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean;
  bookingDate?: string;
  occurredAt?: string | null;
  idempotencyKey: string;
}>;

export type UpdateMovementRequest = Readonly<{
  version: number;
  bookingDate?: string;
  occurredAt?: string | null;
  amountMinor?: number;
  category?: ExpenseCategory;
  note?: string | null;
  merchant?: string | null;
  needVsWant?: ExpenseNeedVsWant;
  paymentMethod?: ExpensePaymentMethod | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean;
}>;

export type ListMovementsQuery = Readonly<{
  /** Inclusive booking-date start (YYYY-MM-DD). */
  from?: string | null;
  /** Inclusive booking-date end (YYYY-MM-DD). */
  to?: string | null;
  /** Inclusive booking-date cutoff; never includes later records. */
  cutoff?: string | null;
  timezone?: string | null;
  kind?: MoneyKind | null;
  limit?: number;
  offset?: number;
}>;

export type MovementPaginationDto = Readonly<{
  limit: number;
  offset: number;
  hasMore: boolean;
}>;

export type CreateMovementResponse = Readonly<{
  ok: true;
  movement: MoneyMovementDto;
  replayed: boolean;
}>;

export type GetMovementResponse = Readonly<{
  ok: true;
  movement: MoneyMovementDto;
}>;

export type ListMovementsResponse = Readonly<{
  ok: true;
  movements: MoneyMovementDto[];
  pagination: MovementPaginationDto;
  cutoff: string;
  timezone: string | null;
}>;

export type UpdateMovementResponse = Readonly<{
  ok: true;
  movement: MoneyMovementDto;
}>;

export type MoneyStateReasonDto =
  | "period_table_unavailable"
  | "no_period"
  | "period_uninitialized"
  | "unknown_opening"
  | "multiple_openings"
  | "history_truncated";

export type MoneyStateDto = Readonly<{
  currency: "MAD";
  cutoff: string;
  timezone: string | null;
  boundary: Readonly<{
    spendableCash: string;
    savingsTransfer: string;
    internalTransfer: string;
  }>;
  openingMinor: number;
  inflowsMinor: number;
  outflowsMinor: number;
  recordedCashMinor: number;
  expenseTotalMinor: number;
  dailyIncludedSpendMinor: number;
  savingsFundedMinor: number;
  counts: Readonly<{
    movements: number;
    expenses: number;
    dailyIncludedExpenses: number;
    savingsTransfers: number;
    openingMovements: number;
  }>;
  period: Readonly<{
    available: boolean;
    id: string | null;
    startDate: string | null;
    endDate: string | null;
    activeDate: string | null;
    timezone: string | null;
    lifecycle: "tracking" | "ended" | "rolled_over" | null;
    initialization: "uninitialized" | "initialized" | "reconciled" | null;
    openingMovementId: string | null;
    provenance: Record<string, unknown> | null;
  }>;
  completeness: Readonly<{
    confirmed: boolean;
    truncated: boolean;
    reasons: MoneyStateReasonDto[];
  }>;
}>;

export type GetMoneyStateQuery = Readonly<{
  cutoff?: string | null;
  timezone?: string | null;
}>;

export type GetMoneyStateResponse = Readonly<{
  ok: true;
  state: MoneyStateDto;
}>;

export type MoneyErrorEnvelope = Readonly<{
  error: Readonly<{ code: string; message: string }>;
}>;
