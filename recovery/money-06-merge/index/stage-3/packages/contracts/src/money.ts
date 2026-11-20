import type { ExpenseCategory, ExpenseNeedVsWant } from "@ega/domain/expenses";
import type { MoneyPurpose } from "@ega/domain/money";
import type {
  ObligationCadence,
  ObligationHistoricalImportEvidence,
  ObligationKind,
  ObligationOccurrence,
  ObligationState,
  ObligationTemplate,
  ObligationTemplateLifecycle,
  ObligationTotals,
} from "@ega/domain/obligations";

/**
 * Wire contracts for MONEY-06 obligations.
 *
 * MONEY-02..05 extend this same `money` module for their own reads/writes; this
 * file only declares the obligation surface. Amounts are positive integer
 * centimes of MAD and the currency is fixed — a caller never selects it. Owner
 * identity is derived from the verified bearer token and is never part of a
 * request body or query.
 *
 * The read DTOs are exactly the domain read shapes: they contain no database
 * column names, no create fingerprint and no caller-supplied owner id.
 */
export type ObligationDto = ObligationOccurrence;
export type ObligationTemplateDto = ObligationTemplate;
export type ObligationTotalsDto = ObligationTotals;

export type CreateObligationRequest = Readonly<{
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  /** Inclusive due date (YYYY-MM-DD), inside the period. */
  dueDate: string;
  /** Inclusive period start; defaults to the due date for a one-off bill. */
  periodStart?: string;
  /** Inclusive period end; defaults to the due date for a one-off bill. */
  periodEnd?: string;
  /** Optional template whose classification defaults this occurrence snapshots. */
  templateId?: string | null;
  /** Omit while unknown; it is requested at payment, never fabricated. */
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean | null;
  category?: ExpenseCategory | null;
  /** Date the initial `pending` state takes effect (owner-local). */
  stateEffectiveDate: string;
  idempotencyKey: string;
}>;

export type UpdateObligationRequest = Readonly<{
  version: number;
  description?: string;
  amountMinor?: number;
  periodStart?: string;
  periodEnd?: string;
  dueDate?: string;
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose;
  countsInDaily?: boolean;
  category?: ExpenseCategory | null;
}>;

/** `to` is an explicit target state; payment is not a status change. */
export type TransitionObligationRequest = Readonly<{
  version: number;
  to: ObligationState;
  effectiveDate: string;
  reason?: string | null;
}>;

export type ListObligationsQuery = Readonly<{
  kind?: ObligationKind | null;
  state?: ObligationState | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  limit?: number;
  offset?: number;
}>;

export type ObligationSummaryQuery = Readonly<{
  /** Inclusive cutoff date (YYYY-MM-DD). */
  cutoff: string;
  kind?: ObligationKind | null;
}>;

export type ObligationPaginationDto = Readonly<{
  limit: number;
  offset: number;
  hasMore: boolean;
}>;

export type CreateObligationResponse = Readonly<{
  ok: true;
  obligation: ObligationDto;
  replayed: boolean;
}>;

export type GetObligationResponse = Readonly<{
  ok: true;
  obligation: ObligationDto;
}>;

export type ListObligationsResponse = Readonly<{
  ok: true;
  obligations: ObligationDto[];
  pagination: ObligationPaginationDto;
}>;

export type UpdateObligationResponse = Readonly<{
  ok: true;
  obligation: ObligationDto;
}>;

export type ObligationSummaryResponse = Readonly<{
  ok: true;
  summary: ObligationTotalsDto;
}>;

export type CreateObligationTemplateRequest = Readonly<{
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  cadence: ObligationCadence;
  dueDayOfMonth?: number | null;
  dueWeekday?: number | null;
  startDate: string;
  endDate?: string | null;
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean | null;
  category?: ExpenseCategory | null;
  idempotencyKey: string;
}>;

export type UpdateObligationTemplateRequest = Readonly<{
  version: number;
  description?: string;
  amountMinor?: number;
  cadence?: ObligationCadence;
  dueDayOfMonth?: number | null;
  dueWeekday?: number | null;
  startDate?: string;
  endDate?: string | null;
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean | null;
  category?: ExpenseCategory | null;
  lifecycle?: ObligationTemplateLifecycle;
}>;

export type ListObligationTemplatesQuery = Readonly<{
  kind?: ObligationKind | null;
  includeArchived?: boolean;
}>;

export type ObligationTemplateResponse = Readonly<{
  ok: true;
  template: ObligationTemplateDto;
}>;

export type ListObligationTemplatesResponse = Readonly<{
  ok: true;
  templates: ObligationTemplateDto[];
}>;

export type GenerateObligationsRequest = Readonly<{
  /** Generate every template period due on or before this inclusive date. */
  throughDate: string;
}>;

export type GenerateObligationsResponse = Readonly<{
  ok: true;
  templateId: string;
  throughDate: string;
  created: number;
  existing: number;
  occurrences: ObligationDto[];
  truncated: boolean;
}>;

/** The six transport error codes used by the Money obligation routes. */
export type ObligationErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "INTERNAL";

export type ObligationErrorEnvelope = Readonly<{
  error: Readonly<{
    code: ObligationErrorCode;
    message: string;
  }>;
}>;

/** Convenience alias for the historical-import evidence shape on the wire. */
export type ObligationPaymentEvidenceDto = ObligationHistoricalImportEvidence;
