import type {
  ExpenseCategory,
  ExpenseCurrency,
  ExpenseNeedVsWant,
  ExpensePaymentMethod,
} from "@ega/domain/expenses";
import type { ExpenseDto } from "./expenses";
import type {
  CoffeeWindowSummary,
  MoneyBudgetAllocations,
  MoneyDirection,
  MoneyKind,
  MoneyOpeningProvenance,
  MoneyOpeningSource,
  MoneyPeriodInitialization,
  MoneyPeriodLifecycle,
  MoneyPeriodProvenance,
  MoneyPeriodSettings,
  MoneyPurpose,
} from "@ega/domain/money";

/**
 * Wire contracts for Money period setup/state (MONEY-03) and the movement
 * ledger (MONEY-04). Amounts are integer MAD centimes; the owner is always
 * derived from verified authentication and no request may select an owner,
 * a currency or a second ledger.
 */

/** Explicit date modes shared by HTTP and MCP; they resolve differently. */
export const MONEY_STATE_MODES = ["today", "active_day"] as const;
export type MoneyStateMode = (typeof MONEY_STATE_MODES)[number];

export type MoneyPeriodDto = Readonly<{
  id: string;
  startDate: string;
  endDate: string;
  currency: "MAD";
  timezone: string;
  activeDate: string;
  lifecycle: MoneyPeriodLifecycle;
  initialization: MoneyPeriodInitialization;
  openingMovementId: string | null;
  /** Versioned opening provenance, including correction history. */
  provenance: MoneyPeriodProvenance;
  settings: MoneyPeriodSettings;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type MoneyOpeningDto =
  | Readonly<{
      status: "unknown";
      amountMinor: null;
      currency: "MAD";
      reason: string;
    }>
  | Readonly<{
      status: "known";
      amountMinor: number;
      currency: "MAD";
      bookingDate: string;
      version: number;
      openingMovementId: string;
    }>;

export type MoneyCashDto =
  | Readonly<{
      available: false;
      currency: "MAD";
      reason: string;
      cutoffDate: string;
    }>
  | Readonly<{
      available: true;
      currency: "MAD";
      basis: "recorded";
      cutoffDate: string;
      openingMinor: number;
      inflowsMinor: number;
      outflowsMinor: number;
      recordedCashMinor: number;
      recordCount: number;
    }>;

export type MoneyStateDateResolutionDto = Readonly<{
  localToday: string;
  timezone: string;
  activeDate: string | null;
  periodTimezone: string | null;
  datesDiffer: boolean;
  requestedDate: string | null;
  requestedMode: "today" | "active_day" | null;
  resolvedDate: string;
  basis:
    | "explicit_date"
    | "local_today"
    | "active_day"
    | "local_today_no_period";
  periodRelation: "in_period" | "before_period" | "after_period" | "no_period";
}>;

export type MoneyStatePeriodSummaryDto = Readonly<{
  id: string;
  startDate: string;
  endDate: string;
  currency: "MAD";
  timezone: string;
  activeDate: string;
  lifecycle: MoneyPeriodLifecycle;
  initialization: MoneyPeriodInitialization;
  version: number;
}>;

export type MoneyStateLegacyDto =
  | Readonly<{
      available: true;
      totalExpenseCount: number;
      assignedToPeriodCount: number;
      inPeriodUnassignedCount: number;
      bookingDateAssignment: "derived_from_occurred_at_in_owner_timezone";
      reviewRequired: boolean;
    }>
  | Readonly<{
      available: false;
      reason: string;
    }>;

export type MoneyStateDto = Readonly<{
  localToday: string;
  timezone: string;
  period: MoneyPeriodDto | null;
  opening: MoneyOpeningDto;
  cash: MoneyCashDto;
  dateResolution: MoneyStateDateResolutionDto;
  history: readonly MoneyStatePeriodSummaryDto[];
  historyUnavailable: boolean;
  legacy: MoneyStateLegacyDto;
}>;

export type GetMoneyStateQuery = Readonly<{
  periodId?: string | null;
  date?: string | null;
  mode?: MoneyStateMode | null;
}>;

export type GetMoneyStateResponse = Readonly<{ ok: true } & MoneyStateDto>;

export type MoneyOpeningRequest = Readonly<{
  amountMinor: number;
  source: MoneyOpeningSource;
  cutoffDate?: string | null;
  evidence?: string | null;
  note?: string | null;
}>;

export type CreateMoneyPeriodRequest = Readonly<{
  startDate: string;
  endDate: string;
  timezone?: string | null;
  activeDate?: string | null;
  opening?: MoneyOpeningRequest | null;
  settings?: MoneyPeriodSettings;
}>;

export type CreateMoneyPeriodResponse = Readonly<{
  ok: true;
  period: MoneyPeriodDto;
  replayed: boolean;
}>;

export type UpdateMoneySettingsRequest = Readonly<{
  version: number;
  activeDate?: string;
  opening?: MoneyOpeningRequest;
  settings?: MoneyPeriodSettings;
}>;

export type UpdateMoneySettingsResponse = Readonly<{
  ok: true;
  period: MoneyPeriodDto;
}>;

/** One row of the extended `personal_expenses` ledger. */
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

export type MoneyErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "INTERNAL";

export type MoneyErrorEnvelope = Readonly<{
  error: Readonly<{
    code: MoneyErrorCode;
    message: string;
  }>;
}>;

/* ------------------------------------------------------------------ */
/* MONEY-05: period budget plan, classification and counted visits    */
/* ------------------------------------------------------------------ */

/**
 * Wire contracts for period budgets, category classification and counted
 * coffee visits. Amounts are non-negative integer MAD centimes. The counted
 * visit references canonical expense ids; it never carries a second
 * authoritative cash amount. `periodId` is the canonical `money_periods` row;
 * the dates are its read-only projection.
 */
export type MoneyBudgetPlanDto = Readonly<{
  id: string;
  periodId: string;
  periodStartDate: string;
  periodEndDate: string;
  currency: "MAD";
  allocations: MoneyBudgetAllocations;
  savingsTargetMinor: number | null;
  emergencyTargetMinor: number | null;
  coffeeWeeklySpendLimitMinor: number | null;
  coffeeWeeklyVisitLimit: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type GetMoneyBudgetPlanQuery = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
}>;

export type GetMoneyBudgetPlanResponse = Readonly<{
  ok: true;
  /** `null` means no explicit plan exists; this is not a zero budget. */
  plan: MoneyBudgetPlanDto | null;
}>;

export type SaveMoneyBudgetPlanRequest = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
  allocations: MoneyBudgetAllocations;
  savingsTargetMinor?: number | null;
  emergencyTargetMinor?: number | null;
  coffeeWeeklySpendLimitMinor?: number | null;
  coffeeWeeklyVisitLimit?: number | null;
  /** 0 creates the period plan; otherwise the current plan version. */
  version: number;
}>;

export type SetMoneyBudgetAllocationRequest = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
  version: number;
  /** `null` clears one entry; omitted allocations stay unchanged. */
  allocations?: Partial<Record<ExpenseCategory, number | null>>;
  savingsTargetMinor?: number | null;
  emergencyTargetMinor?: number | null;
  coffeeWeeklySpendLimitMinor?: number | null;
  coffeeWeeklyVisitLimit?: number | null;
}>;

export type MoneyBudgetMutationResponse = Readonly<{
  ok: true;
  plan: MoneyBudgetPlanDto;
}>;

export type MoneyCoffeeVisitLineDto = Readonly<{
  expenseId: string;
  amountMinor: number;
  category: string;
  deletedAt: string | null;
}>;

export type MoneyCoffeeVisitDto = Readonly<{
  id: string;
  visitKey: string;
  visitFingerprint: string;
  localDate: string;
  timezone: string;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  lines: MoneyCoffeeVisitLineDto[];
}>;

export type RecordMoneyCoffeeVisitRequest = Readonly<{
  visitKey: string;
  localDate: string;
  timezone: string;
  /** Canonical coffee-category expense ids; several lines count as one visit. */
  expenseIds: string[];
  note?: string | null;
}>;

export type RecordMoneyCoffeeVisitResponse = Readonly<{
  ok: true;
  visit: MoneyCoffeeVisitDto;
  replayed: boolean;
}>;

export type DeleteMoneyCoffeeVisitResponse = Readonly<{
  ok: true;
  id: string;
  alreadyDeleted: boolean;
}>;

export type ListMoneyCoffeeVisitsQuery = Readonly<{
  from: string;
  to: string;
  limit?: number;
  offset?: number;
}>;

export type ListMoneyCoffeeVisitsResponse = Readonly<{
  ok: true;
  visits: MoneyCoffeeVisitDto[];
}>;

export type MoneyCoffeeWindowQuery = Readonly<{
  localDate: string;
  timezone: string;
  periodStartDate: string;
  periodEndDate: string;
  spendLimitMinor?: number | null;
  visitLimitMinor?: number | null;
}>;

export type MoneyCoffeeWindowResponse = Readonly<{
  ok: true;
  coffee: CoffeeWindowSummary;
}>;

export type ClassifyMoneyExpenseRequest = Readonly<{
  expenseId: string;
  version: number;
  category: ExpenseCategory;
  note?: string | null;
  needVsWant?: ExpenseNeedVsWant;
}>;

export type ClassifyMoneyExpenseResponse = Readonly<{
  ok: true;
  expense: ExpenseDto;
  previousCategory: ExpenseCategory;
  countedCoffeeVisitIds: string[];
  countedCoffeeUsageChanged: boolean;
}>;

export type { MoneyOpeningProvenance, MoneyPeriodProvenance, MoneyPeriodSettings };
