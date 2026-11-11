import type {
  MoneyOpeningProvenance,
  MoneyOpeningSource,
  MoneyPeriodInitialization,
  MoneyPeriodLifecycle,
  MoneyPeriodProvenance,
  MoneyPeriodSettings,
} from "@ega/domain/money";

/**
 * Wire contracts for period setup and the shared Money state (MONEY-03).
 * Amounts are integer MAD centimes. The owner is always derived from verified
 * authentication; no request may select an owner or currency.
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

export type { MoneyOpeningProvenance, MoneyPeriodProvenance, MoneyPeriodSettings };
