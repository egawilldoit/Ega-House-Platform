import type { ExpenseCategory, ExpenseNeedVsWant } from "./expenses";
import {
  MONEY_PURPOSES,
  type MoneyPurpose,
} from "./money";
import { addDaysToIsoDate, isIsoDate } from "./time-context";

/**
 * Bills and subscriptions as durable obligation occurrences (MONEY-06).
 *
 * Product rules encoded here:
 *   * One occurrence owns amount, due date, period, kind, description, version
 *     and an explicit lifecycle. Templates are recurrence/classification
 *     defaults only — scheduling is never a cash movement.
 *   * Each occurrence snapshots need/want, purpose, countsInDaily and category.
 *     Resolution precedence is payment input > occurrence snapshot > template
 *     default > kind default, so editing a template never rewrites history.
 *   * need/want has no default: it stays unknown (`null`) until payment states
 *     it. The application must request it; it is never fabricated.
 *   * `paid` requires a linked canonical payment or explicitly flagged
 *     reconciled historical import evidence. A status-only annotation is
 *     represented as evidence and never as invented cash history.
 *   * One full payment per occurrence; partial/overpayment are rejected.
 *   * Due/overdue/outstanding totals use complete occurrences at a cutoff and
 *     reconstruct the lifecycle state that was effective at that cutoff.
 */

export const OBLIGATION_CURRENCY = "MAD" as const;
export type ObligationCurrency = typeof OBLIGATION_CURRENCY;

export const OBLIGATION_KINDS = ["bill", "subscription"] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export const OBLIGATION_STATES = ["pending", "paid", "waived", "cancelled"] as const;
export type ObligationState = (typeof OBLIGATION_STATES)[number];

export const OBLIGATION_CADENCES = [
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;
export type ObligationCadence = (typeof OBLIGATION_CADENCES)[number];

export const OBLIGATION_TEMPLATE_LIFECYCLES = ["active", "archived"] as const;
export type ObligationTemplateLifecycle =
  (typeof OBLIGATION_TEMPLATE_LIFECYCLES)[number];

export const OBLIGATION_DESCRIPTION_MAX_LENGTH = 200;
export const OBLIGATION_REASON_MAX_LENGTH = 200;
export const OBLIGATION_IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const OBLIGATION_AMOUNT_MINOR_MAX = 2_147_483_647;
export const OBLIGATION_LIST_DEFAULT_LIMIT = 50;
export const OBLIGATION_LIST_MAX_LIMIT = 100;
export const OBLIGATION_LIST_MAX_OFFSET = 1_000_000;
/** Bounded generation keeps one request from materialising unbounded history. */
export const OBLIGATION_GENERATION_MAX_PERIODS = 5000;

/** The issue that owns atomic payment/correction. */
export const OBLIGATION_PAYMENT_TRANSACTION_OWNER = "MONEY-07" as const;

/**
 * Kind-level fallbacks. Bills and subscriptions are fixed-purpose, exclude
 * flexible daily spending by default and carry a kind-appropriate category.
 * need/want is deliberately absent: it stays unknown until payment.
 */
export const OBLIGATION_KIND_DEFAULTS: Readonly<
  Record<
    ObligationKind,
    Readonly<{
      purpose: MoneyPurpose;
      countsInDaily: boolean;
      category: ExpenseCategory;
    }>
  >
> = {
  bill: { purpose: "fixed", countsInDaily: false, category: "bills" },
  subscription: {
    purpose: "fixed",
    countsInDaily: false,
    category: "subscriptions",
  },
};

export type ObligationTemplate = Readonly<{
  id: string;
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  currency: ObligationCurrency;
  cadence: ObligationCadence;
  dueDayOfMonth: number | null;
  dueWeekday: number | null;
  startDate: string;
  endDate: string | null;
  needVsWant: ExpenseNeedVsWant | null;
  purpose: MoneyPurpose | null;
  countsInDaily: boolean | null;
  category: ExpenseCategory | null;
  lifecycle: ObligationTemplateLifecycle;
  idempotencyKey: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

/**
 * Historical-import evidence is the only way a paid occurrence may exist
 * without a linked canonical ledger payment. `reference` identifies the source
 * document so the missing payment history stays disclosed.
 */
export type ObligationHistoricalImportEvidence = Readonly<{
  kind: "reconciled_historical_import";
  reference: string;
  note: string | null;
  importedAt: string;
}>;

export type ObligationStateEvent = Readonly<{
  state: ObligationState;
  effectiveDate: string;
  reason: string | null;
  version: number;
  recordedAt: string;
}>;

export type ObligationOccurrence = Readonly<{
  id: string;
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  currency: ObligationCurrency;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  needVsWant: ExpenseNeedVsWant | null;
  purpose: MoneyPurpose;
  countsInDaily: boolean;
  category: ExpenseCategory | null;
  state: ObligationState;
  stateEffectiveDate: string;
  stateReason: string | null;
  /** Append-only lifecycle transitions, oldest first. */
  stateHistory?: readonly ObligationStateEvent[];
  paymentExpenseId: string | null;
  paymentEvidence: ObligationHistoricalImportEvidence | null;
  templateId: string | null;
  idempotencyKey: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type ObligationClassificationSource = Readonly<{
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean | null;
  category?: ExpenseCategory | null;
}>;

export type ResolvedObligationClassification = Readonly<{
  /** `null` means genuinely unknown: request it, never invent it. */
  needVsWant: ExpenseNeedVsWant | null;
  purpose: MoneyPurpose;
  countsInDaily: boolean;
  category: ExpenseCategory;
}>;

export type ObligationValidationFailure = Readonly<{
  ok: false;
  field: string;
  message: string;
}>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER_STRING_RE = /^\d+$/;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function failure(field: string, message: string): ObligationValidationFailure {
  return { ok: false, field, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findUnknownKey(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return key;
  }
  return null;
}

export function isObligationKind(value: unknown): value is ObligationKind {
  return (
    typeof value === "string" &&
    (OBLIGATION_KINDS as readonly string[]).includes(value)
  );
}

export function isObligationState(value: unknown): value is ObligationState {
  return (
    typeof value === "string" &&
    (OBLIGATION_STATES as readonly string[]).includes(value)
  );
}

export function isObligationCadence(value: unknown): value is ObligationCadence {
  return (
    typeof value === "string" &&
    (OBLIGATION_CADENCES as readonly string[]).includes(value)
  );
}

export function isObligationId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function parseAmountMinor(
  raw: unknown,
): { ok: true; value: number } | ObligationValidationFailure {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return failure("amountMinor", "Amount must be a whole number of centimes.");
  }
  if (raw < 1) {
    return failure("amountMinor", "Amount must be greater than zero.");
  }
  if (raw > OBLIGATION_AMOUNT_MINOR_MAX) {
    return failure("amountMinor", "Amount is too large.");
  }
  return { ok: true, value: raw };
}

function parseVersion(
  raw: unknown,
): { ok: true; value: number } | ObligationValidationFailure {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > OBLIGATION_AMOUNT_MINOR_MAX
  ) {
    return failure("version", "A positive expected version is required.");
  }
  return { ok: true, value: raw };
}

function parseIsoDateField(
  raw: unknown,
  field: string,
): { ok: true; value: string } | ObligationValidationFailure {
  if (typeof raw !== "string" || !ISO_DATE_RE.test(raw.trim())) {
    return failure(field, `${field} must be a valid YYYY-MM-DD date.`);
  }
  const value = raw.trim();
  if (!isIsoDate(value)) {
    return failure(field, `${field} must be a real calendar date.`);
  }
  return { ok: true, value };
}

function parseOptionalIsoDateField(
  raw: unknown,
  field: string,
): { ok: true; value: string | null } | ObligationValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  return parseIsoDateField(raw, field);
}

/** Reject NUL, unpaired surrogates and disallowed control characters. */
function hasUnsupportedCharacters(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code === 0x7f) return true;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return true;
    }
  }
  return false;
}

function parseBoundedText(
  raw: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string } | ObligationValidationFailure {
  if (typeof raw !== "string") {
    return failure(field, "This value is required.");
  }
  if (hasUnsupportedCharacters(raw)) {
    return failure(field, "This value contains unsupported characters.");
  }
  const trimmed = raw.trim();
  if (!trimmed) return failure(field, "This value is required.");
  if (Array.from(trimmed).length > maxLength) {
    return failure(field, `This value must be ${maxLength} characters or fewer.`);
  }
  return { ok: true, value: trimmed };
}

function parseOptionalBoundedText(
  raw: unknown,
  field: string,
  maxLength: number,
): { ok: true; value: string | null } | ObligationValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const parsed = parseBoundedText(raw, field, maxLength);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

function parseEnum<T extends string>(
  raw: unknown,
  field: string,
  isValue: (value: unknown) => value is T,
  message: string,
): { ok: true; value: T } | ObligationValidationFailure {
  if (!isValue(raw)) return failure(field, message);
  return { ok: true, value: raw };
}

function parseNeedVsWant(
  raw: unknown,
  allowNull: boolean,
): { ok: true; value: ExpenseNeedVsWant | null } | ObligationValidationFailure {
  if (allowNull && (raw === undefined || raw === null)) {
    return { ok: true, value: null };
  }
  if (raw !== "need" && raw !== "want") {
    return failure("needVsWant", "Choose need or want.");
  }
  return { ok: true, value: raw };
}

function parsePurpose(
  raw: unknown,
): { ok: true; value: MoneyPurpose } | ObligationValidationFailure {
  if (
    typeof raw !== "string" ||
    !(MONEY_PURPOSES as readonly string[]).includes(raw)
  ) {
    return failure("purpose", "Choose fixed, flexible or emergency.");
  }
  return { ok: true, value: raw as MoneyPurpose };
}

function parseCategory(
  raw: unknown,
  allowNull: boolean,
): { ok: true; value: ExpenseCategory | null } | ObligationValidationFailure {
  if (allowNull && (raw === undefined || raw === null)) {
    return { ok: true, value: null };
  }
  const values: readonly string[] = [
    "coffee",
    "groceries",
    "eating_out",
    "transport",
    "bills",
    "subscriptions",
    "household",
    "health",
    "other",
  ];
  if (typeof raw !== "string" || !values.includes(raw)) {
    return failure("category", "Choose a supported category.");
  }
  return { ok: true, value: raw as ExpenseCategory };
}

/* -------------------------------------------------------------------------- */
/* Classification resolution                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Precedence: payment input > occurrence snapshot > template default > kind
 * default. `null`/`undefined` mean "this source supplied no value", so the
 * next source applies. need/want ends at `null` (unknown) because no source
 * may invent it.
 */
export function resolveObligationClassification(input: Readonly<{
  kind: ObligationKind;
  template?: ObligationClassificationSource | null;
  occurrence?: ObligationClassificationSource | null;
  payment?: ObligationClassificationSource | null;
}>): ResolvedObligationClassification {
  const defaults = OBLIGATION_KIND_DEFAULTS[input.kind];
  const template = input.template ?? null;
  const occurrence = input.occurrence ?? null;
  const payment = input.payment ?? null;

  // Presence, not truthiness: an explicit `null` is a supplied "unknown" and
  // must stop the chain instead of falling through to a live template.
  function pick<K extends keyof ObligationClassificationSource>(
    key: K,
    fallback: ResolvedObligationClassification[K],
  ): ResolvedObligationClassification[K] {
    for (const source of [payment, occurrence, template]) {
      if (source && Object.prototype.hasOwnProperty.call(source, key)) {
        return (source[key] ?? null) as ResolvedObligationClassification[K];
      }
    }
    return fallback;
  }

  return {
    needVsWant: pick("needVsWant", null),
    purpose: pick("purpose", defaults.purpose),
    countsInDaily: pick("countsInDaily", defaults.countsInDaily),
    category: pick("category", defaults.category),
  };
}

/** Template row fields mapped to "supplied" classification sources. */
export function templateClassificationSource(
  template: ObligationTemplate | null,
): ObligationClassificationSource | null {
  if (!template) return null;
  return {
    ...(template.needVsWant !== null ? { needVsWant: template.needVsWant } : {}),
    ...(template.purpose !== null ? { purpose: template.purpose } : {}),
    ...(template.countsInDaily !== null
      ? { countsInDaily: template.countsInDaily }
      : {}),
    ...(template.category !== null ? { category: template.category } : {}),
  };
}

/**
 * Classification still required before a payment can be recorded. MONEY-07
 * must ask for these instead of fabricating them.
 */
export function missingPaymentClassification(
  classification: ResolvedObligationClassification,
): readonly string[] {
  return classification.needVsWant === null ? ["needVsWant"] : [];
}

/* -------------------------------------------------------------------------- */
/* Calendar / recurrence math                                                 */
/* -------------------------------------------------------------------------- */

function parseIsoParts(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isIsoDate(value)) return null;
  return { year, month, day };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday, on the calendar axis (no timezone involved). */
function weekdayOf(date: string): number {
  const parts = parseIsoParts(date);
  if (!parts) throw new RangeError(`Invalid date: ${date}`);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

const MONTHS_PER_PERIOD: Readonly<Record<Exclude<ObligationCadence, "weekly">, number>> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export function startOfObligationPeriod(
  date: string,
  cadence: ObligationCadence,
): string {
  const parts = parseIsoParts(date);
  if (!parts) throw new RangeError(`Invalid date: ${date}`);
  if (cadence === "weekly") {
    const diff = (weekdayOf(date) + 6) % 7;
    return addDaysToIsoDate(date, -diff);
  }
  const span = MONTHS_PER_PERIOD[cadence];
  const zeroBased = parts.month - 1;
  const startMonth = Math.floor(zeroBased / span) * span + 1;
  return toIsoDate(parts.year, startMonth, 1);
}

export function addObligationPeriods(
  periodStart: string,
  cadence: ObligationCadence,
  count: number,
): string {
  const parts = parseIsoParts(periodStart);
  if (!parts) throw new RangeError(`Invalid date: ${periodStart}`);
  if (cadence === "weekly") {
    return addDaysToIsoDate(periodStart, count * 7);
  }
  const span = MONTHS_PER_PERIOD[cadence];
  const totalMonths = (parts.year * 12 + (parts.month - 1)) + count * span;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return toIsoDate(year, month, 1);
}

export function endOfObligationPeriod(
  periodStart: string,
  cadence: ObligationCadence,
): string {
  return addDaysToIsoDate(addObligationPeriods(periodStart, cadence, 1), -1);
}

export type ObligationSchedule = Readonly<{
  cadence: ObligationCadence;
  dueDayOfMonth: number | null;
  dueWeekday: number | null;
}>;

/**
 * Due date inside a period. Weekly schedules use the period's week; other
 * cadences use the period's first month with the day clamped to that month's
 * length (a 31st-of-month bill falls on the 28/29/30 in shorter months).
 */
export function dueDateForObligationPeriod(
  schedule: ObligationSchedule,
  periodStart: string,
): string {
  const parts = parseIsoParts(periodStart);
  if (!parts) throw new RangeError(`Invalid date: ${periodStart}`);
  if (schedule.cadence === "weekly") {
    if (schedule.dueWeekday === null) {
      throw new RangeError("A weekly obligation template needs a weekday.");
    }
    const offset = (schedule.dueWeekday - weekdayOf(periodStart) + 7) % 7;
    return addDaysToIsoDate(periodStart, offset);
  }
  if (schedule.dueDayOfMonth === null) {
    throw new RangeError("A monthly-or-longer template needs a day of month.");
  }
  const day = Math.min(
    schedule.dueDayOfMonth,
    daysInMonth(parts.year, parts.month),
  );
  return toIsoDate(parts.year, parts.month, day);
}

export type ObligationGenerationPlan = Readonly<{
  periodStarts: string[];
  truncated: boolean;
}>;

/**
 * Periods a template should have generated through `throughDate`. Bounded by
 * `maxPeriods`; `truncated` states that the cutoff was not reached.
 */
export function listObligationPeriodStarts(
  template: Readonly<{
    cadence: ObligationCadence;
    startDate: string;
    endDate: string | null;
  }>,
  throughDate: string,
  maxPeriods: number = OBLIGATION_GENERATION_MAX_PERIODS,
): ObligationGenerationPlan {
  const firstStart = startOfObligationPeriod(template.startDate, template.cadence);
  const lastStart = startOfObligationPeriod(throughDate, template.cadence);
  if (lastStart < firstStart) return { periodStarts: [], truncated: false };

  const periodStarts: string[] = [];
  let cursor = firstStart;
  let truncated = false;
  while (cursor <= lastStart) {
    if (periodStarts.length >= maxPeriods) {
      truncated = true;
      break;
    }
    const periodEnd = endOfObligationPeriod(cursor, template.cadence);
    const startsBeforeTemplateEnd =
      template.endDate === null || cursor <= template.endDate;
    if (periodEnd >= template.startDate && startsBeforeTemplateEnd) {
      periodStarts.push(cursor);
    }
    cursor = addObligationPeriods(cursor, template.cadence, 1);
  }
  return { periodStarts, truncated };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

export const OBLIGATION_ALLOWED_TRANSITIONS = [
  { from: "pending", to: "paid" },
  { from: "paid", to: "pending" },
  { from: "pending", to: "waived" },
  { from: "pending", to: "cancelled" },
  { from: "waived", to: "pending" },
  { from: "cancelled", to: "pending" },
  { from: "waived", to: "cancelled" },
  { from: "cancelled", to: "waived" },
] as const satisfies readonly { from: ObligationState; to: ObligationState }[];

export type ObligationTransitionFailureReason =
  | "invalid_transition"
  | "no_change"
  | "payment_required"
  | "payment_resolution_required"
  | "invalid_effective_date";

export type ObligationTransitionDecision =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason: ObligationTransitionFailureReason;
      message: string;
    }>;

const INVALID_TRANSITION_MESSAGE =
  "That obligation lifecycle change is not allowed.";

/**
 * Explicit lifecycle decision. Paying is not a status change: `pending -> paid`
 * only happens through the atomic MONEY-07 payment path, and leaving `paid`
 * requires resolving that link there first.
 */
export function decideObligationTransition(input: Readonly<{
  from: ObligationState;
  to: ObligationState;
  effectiveDate: string;
  currentEffectiveDate: string;
}>): ObligationTransitionDecision {
  if (input.from === input.to) {
    return {
      ok: false,
      reason: "no_change",
      message: "The obligation is already in that state.",
    };
  }
  if (!isIsoDate(input.effectiveDate)) {
    return {
      ok: false,
      reason: "invalid_effective_date",
      message: "Effective date must be a real calendar date.",
    };
  }
  const allowed = OBLIGATION_ALLOWED_TRANSITIONS.some(
    (transition) =>
      transition.from === input.from && transition.to === input.to,
  );
  if (!allowed) {
    return {
      ok: false,
      reason: "invalid_transition",
      message: INVALID_TRANSITION_MESSAGE,
    };
  }
  if (input.to === "paid") {
    return {
      ok: false,
      reason: "payment_required",
      message:
        "Paying an obligation requires the atomic MONEY-07 payment path; a status change cannot record or claim a payment.",
    };
  }
  if (input.from === "paid") {
    return {
      ok: false,
      reason: "payment_resolution_required",
      message:
        "This obligation is paid. Resolve the linked payment through the MONEY-07 correction path before changing its state.",
    };
  }
  if (input.effectiveDate < input.currentEffectiveDate) {
    return {
      ok: false,
      reason: "invalid_effective_date",
      message: "The effective date cannot precede the current lifecycle state.",
    };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Cutoff totals                                                              */
/* -------------------------------------------------------------------------- */

/**
 * State effective at an inclusive cutoff. Every non-pending state is reached
 * from `pending` (paid through MONEY-07), so an occurrence whose transition
 * postdates the cutoff was still pending then.
 */
export function obligationStateAtCutoff(
  occurrence: Pick<
    ObligationOccurrence,
    "state" | "stateEffectiveDate" | "stateHistory"
  >,
  cutoffDate: string,
): ObligationState {
  const history = occurrence.stateHistory ?? [];
  if (history.length > 0) {
    let state: ObligationState = "pending";
    for (const event of history) {
      if (event.effectiveDate <= cutoffDate) state = event.state;
    }
    return state;
  }
  if (occurrence.state === "pending") return "pending";
  return occurrence.stateEffectiveDate <= cutoffDate
    ? occurrence.state
    : "pending";
}

export type ObligationTotals = Readonly<{
  currency: ObligationCurrency;
  cutoffDate: string;
  /** Pending and due exactly on the cutoff date. */
  dueMinor: number;
  /** Pending and due before the cutoff date. */
  overdueMinor: number;
  /** Reserve still owed at the cutoff: due + overdue. */
  outstandingMinor: number;
  paidMinor: number;
  pendingCount: number;
  overdueCount: number;
  paidCount: number;
  waivedCount: number;
  cancelledCount: number;
  occurrenceCount: number;
  /** True when the occurrence list was capped, so totals are a lower bound. */
  truncated: boolean;
}>;

/**
 * Integer-centime due/overdue/outstanding totals for complete occurrences at
 * an inclusive cutoff. Waived and cancelled occurrences hold zero reserve, so
 * they never contribute to outstanding amounts.
 */
export function summarizeObligationOccurrences(
  occurrences: readonly ObligationOccurrence[],
  cutoffDate: string,
  options: Readonly<{ truncated?: boolean }> = {},
): ObligationTotals {
  if (!isIsoDate(cutoffDate)) {
    throw new RangeError(`Invalid cutoff date: ${cutoffDate}`);
  }
  let dueMinor = 0;
  let overdueMinor = 0;
  let paidMinor = 0;
  let pendingCount = 0;
  let overdueCount = 0;
  let paidCount = 0;
  let waivedCount = 0;
  let cancelledCount = 0;
  let occurrenceCount = 0;

  for (const occurrence of occurrences) {
    if (occurrence.dueDate > cutoffDate) continue;
    occurrenceCount += 1;
    const state = obligationStateAtCutoff(occurrence, cutoffDate);
    if (state === "pending") {
      pendingCount += 1;
      if (occurrence.dueDate < cutoffDate) {
        overdueCount += 1;
        overdueMinor += occurrence.amountMinor;
      } else {
        dueMinor += occurrence.amountMinor;
      }
    } else if (state === "paid") {
      paidCount += 1;
      paidMinor += occurrence.amountMinor;
    } else if (state === "waived") {
      waivedCount += 1;
    } else {
      cancelledCount += 1;
    }
  }

  return {
    currency: OBLIGATION_CURRENCY,
    cutoffDate,
    dueMinor,
    overdueMinor,
    outstandingMinor: dueMinor + overdueMinor,
    paidMinor,
    pendingCount,
    overdueCount,
    paidCount,
    waivedCount,
    cancelledCount,
    occurrenceCount,
    truncated: options.truncated ?? false,
  };
}

/* -------------------------------------------------------------------------- */
/* Input parsing                                                              */
/* -------------------------------------------------------------------------- */

const CREATE_OCCURRENCE_KEYS = new Set([
  "kind",
  "description",
  "amountMinor",
  "dueDate",
  "periodStart",
  "periodEnd",
  "templateId",
  "needVsWant",
  "purpose",
  "countsInDaily",
  "category",
  "stateEffectiveDate",
  "idempotencyKey",
]);

const UPDATE_OCCURRENCE_KEYS = new Set([
  "version",
  "description",
  "amountMinor",
  "dueDate",
  "periodStart",
  "periodEnd",
  "needVsWant",
  "purpose",
  "countsInDaily",
  "category",
]);

const TRANSITION_KEYS = new Set(["version", "to", "effectiveDate", "reason"]);
const LIST_KEYS = new Set(["kind", "state", "dueFrom", "dueTo", "limit", "offset"]);
const CUTOFF_KEYS = new Set(["cutoff", "kind"]);
const GENERATE_KEYS = new Set(["templateId", "throughDate"]);

const CREATE_TEMPLATE_KEYS = new Set([
  "kind",
  "description",
  "amountMinor",
  "cadence",
  "dueDayOfMonth",
  "dueWeekday",
  "startDate",
  "endDate",
  "needVsWant",
  "purpose",
  "countsInDaily",
  "category",
  "idempotencyKey",
]);

const UPDATE_TEMPLATE_KEYS = new Set([
  "version",
  "description",
  "amountMinor",
  "cadence",
  "dueDayOfMonth",
  "dueWeekday",
  "startDate",
  "endDate",
  "needVsWant",
  "purpose",
  "countsInDaily",
  "category",
  "lifecycle",
]);

export type ObligationCreateInput = Readonly<{
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  /** Omitted means "not supplied by this source" (template/kind default). */
  needVsWant?: ExpenseNeedVsWant | null;
  purpose?: MoneyPurpose | null;
  countsInDaily?: boolean | null;
  category?: ExpenseCategory | null;
  stateEffectiveDate: string;
  templateId: string | null;
  idempotencyKey: string;
}>;

export type ObligationCreateValues = Readonly<{
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  needVsWant: ExpenseNeedVsWant | null;
  purpose: MoneyPurpose;
  countsInDaily: boolean;
  category: ExpenseCategory;
  stateEffectiveDate: string;
  templateId: string | null;
  idempotencyKey: string;
}>;

export type ObligationUpdateChanges = Readonly<{
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

export type ObligationUpdateValues = ObligationUpdateChanges &
  Readonly<{ expectedVersion: number }>;

export type ObligationTransitionValues = Readonly<{
  to: ObligationState;
  effectiveDate: string;
  reason: string | null;
  expectedVersion: number;
}>;

export type ObligationListValues = Readonly<{
  kind: ObligationKind | null;
  state: ObligationState | null;
  dueFrom: string | null;
  dueTo: string | null;
  limit: number;
  offset: number;
}>;

export type ObligationCutoffValues = Readonly<{
  cutoff: string;
  kind: ObligationKind | null;
}>;

export type ObligationTemplateListValues = Readonly<{
  kind: ObligationKind | null;
  includeArchived: boolean;
}>;

export function parseCreateObligationInput(
  input: unknown,
): { ok: true; value: ObligationCreateInput } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, CREATE_OCCURRENCE_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown field "${unknownKey}".`);
  }

  const kind = parseEnum(
    input.kind,
    "kind",
    isObligationKind,
    "Choose bill or subscription.",
  );
  if (!kind.ok) return kind;

  const description = parseBoundedText(
    input.description,
    "description",
    OBLIGATION_DESCRIPTION_MAX_LENGTH,
  );
  if (!description.ok) return description;

  const amountMinor = parseAmountMinor(input.amountMinor);
  if (!amountMinor.ok) return amountMinor;

  const dueDate = parseIsoDateField(input.dueDate, "dueDate");
  if (!dueDate.ok) return dueDate;

  const hasStart = input.periodStart !== undefined && input.periodStart !== null;
  const hasEnd = input.periodEnd !== undefined && input.periodEnd !== null;
  let periodStart = dueDate.value;
  let periodEnd = dueDate.value;
  if (hasStart) {
    const parsed = parseIsoDateField(input.periodStart, "periodStart");
    if (!parsed.ok) return parsed;
    periodStart = parsed.value;
  }
  if (hasEnd) {
    const parsed = parseIsoDateField(input.periodEnd, "periodEnd");
    if (!parsed.ok) return parsed;
    periodEnd = parsed.value;
  }
  const periodFailure = validateObligationPeriod(
    periodStart,
    periodEnd,
    dueDate.value,
  );
  if (periodFailure) return periodFailure;

  let templateId: string | null = null;
  if (input.templateId !== undefined && input.templateId !== null) {
    if (!isObligationId(input.templateId)) {
      return failure("templateId", "Choose a valid template.");
    }
    templateId = input.templateId;
  }

  const stateEffectiveDate = parseIsoDateField(
    input.stateEffectiveDate,
    "stateEffectiveDate",
  );
  if (!stateEffectiveDate.ok) return stateEffectiveDate;

  const classification = parseClassificationFields(input);
  if (!classification.ok) return classification;

  const idempotencyKey = parseBoundedText(
    input.idempotencyKey,
    "idempotencyKey",
    OBLIGATION_IDEMPOTENCY_KEY_MAX_LENGTH,
  );
  if (!idempotencyKey.ok) return idempotencyKey;

  return {
    ok: true,
    value: {
      kind: kind.value,
      description: description.value,
      amountMinor: amountMinor.value,
      periodStart,
      periodEnd,
      dueDate: dueDate.value,
      ...classification.value,
      stateEffectiveDate: stateEffectiveDate.value,
      templateId,
      idempotencyKey: idempotencyKey.value,
    },
  };
}

export function validateObligationPeriod(
  periodStart: string,
  periodEnd: string,
  dueDate: string,
): ObligationValidationFailure | null {
  if (periodEnd < periodStart) {
    return failure("periodEnd", "The period end must be on or after its start.");
  }
  if (dueDate < periodStart || dueDate > periodEnd) {
    return failure("dueDate", "The due date must fall inside the obligation period.");
  }
  return null;
}

export function parseObligationTemplateListQuery(
  input: unknown,
): { ok: true; value: ObligationTemplateListValues } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("query", "Query must be an object.");
  }
  const unknownKey = findUnknownKey(input, new Set(["kind", "includeArchived"]));
  if (unknownKey) {
    return failure(unknownKey, `Unknown query parameter "${unknownKey}".`);
  }
  let kind: ObligationKind | null = null;
  if (input.kind !== undefined && input.kind !== null && input.kind !== "") {
    const parsed = parseEnum(
      input.kind,
      "kind",
      isObligationKind,
      "Choose bill or subscription.",
    );
    if (!parsed.ok) return parsed;
    kind = parsed.value;
  }
  let includeArchived = false;
  if (input.includeArchived !== undefined && input.includeArchived !== null) {
    if (typeof input.includeArchived !== "boolean") {
      return failure("includeArchived", "includeArchived must be true or false.");
    }
    includeArchived = input.includeArchived;
  }
  return { ok: true, value: { kind, includeArchived } };
}

function parseClassificationFields(
  input: Record<string, unknown>,
): { ok: true; value: ObligationClassificationSource } | ObligationValidationFailure {
  const value: {
    needVsWant?: ExpenseNeedVsWant | null;
    purpose?: MoneyPurpose | null;
    countsInDaily?: boolean | null;
    category?: ExpenseCategory | null;
  } = {};

  if ("needVsWant" in input) {
    const parsed = parseNeedVsWant(input.needVsWant, true);
    if (!parsed.ok) return parsed;
    value.needVsWant = parsed.value;
  }
  if (input.purpose !== undefined) {
    const parsed = parsePurpose(input.purpose);
    if (!parsed.ok) return parsed;
    value.purpose = parsed.value;
  }
  if (input.countsInDaily !== undefined) {
    if (typeof input.countsInDaily !== "boolean") {
      return failure("countsInDaily", "Choose whether this counts in daily spending.");
    }
    value.countsInDaily = input.countsInDaily;
  }
  if ("category" in input) {
    const parsed = parseCategory(input.category, true);
    if (!parsed.ok) return parsed;
    value.category = parsed.value;
  }
  return { ok: true, value };
}

export function parseUpdateObligationInput(
  input: unknown,
): { ok: true; value: ObligationUpdateValues } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, UPDATE_OCCURRENCE_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown field "${unknownKey}".`);
  }
  const version = parseVersion(input.version);
  if (!version.ok) return version;

  const changes: {
    description?: string;
    amountMinor?: number;
    periodStart?: string;
    periodEnd?: string;
    dueDate?: string;
    needVsWant?: ExpenseNeedVsWant | null;
    purpose?: MoneyPurpose;
    countsInDaily?: boolean;
    category?: ExpenseCategory | null;
  } = {};

  if (input.description !== undefined) {
    const parsed = parseBoundedText(
      input.description,
      "description",
      OBLIGATION_DESCRIPTION_MAX_LENGTH,
    );
    if (!parsed.ok) return parsed;
    changes.description = parsed.value;
  }
  if (input.amountMinor !== undefined) {
    const parsed = parseAmountMinor(input.amountMinor);
    if (!parsed.ok) return parsed;
    changes.amountMinor = parsed.value;
  }
  if (input.periodStart !== undefined) {
    const parsed = parseIsoDateField(input.periodStart, "periodStart");
    if (!parsed.ok) return parsed;
    changes.periodStart = parsed.value;
  }
  if (input.periodEnd !== undefined) {
    const parsed = parseIsoDateField(input.periodEnd, "periodEnd");
    if (!parsed.ok) return parsed;
    changes.periodEnd = parsed.value;
  }
  if (input.dueDate !== undefined) {
    const parsed = parseIsoDateField(input.dueDate, "dueDate");
    if (!parsed.ok) return parsed;
    changes.dueDate = parsed.value;
  }
  if ("needVsWant" in input) {
    const parsed = parseNeedVsWant(input.needVsWant, true);
    if (!parsed.ok) return parsed;
    changes.needVsWant = parsed.value;
  }
  if (input.purpose !== undefined) {
    const parsed = parsePurpose(input.purpose);
    if (!parsed.ok) return parsed;
    changes.purpose = parsed.value;
  }
  if (input.countsInDaily !== undefined) {
    if (typeof input.countsInDaily !== "boolean") {
      return failure("countsInDaily", "Choose whether this counts in daily spending.");
    }
    changes.countsInDaily = input.countsInDaily;
  }
  if ("category" in input) {
    const parsed = parseCategory(input.category, true);
    if (!parsed.ok) return parsed;
    changes.category = parsed.value;
  }

  if (Object.keys(changes).length === 0) {
    return failure("body", "At least one obligation field must be provided.");
  }
  return { ok: true, value: { ...changes, expectedVersion: version.value } };
}

export function parseObligationTransitionInput(
  input: unknown,
): { ok: true; value: ObligationTransitionValues } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, TRANSITION_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown field "${unknownKey}".`);
  }
  const version = parseVersion(input.version);
  if (!version.ok) return version;

  const to = parseEnum(
    input.to,
    "to",
    isObligationState,
    "Choose pending, paid, waived or cancelled.",
  );
  if (!to.ok) return to;

  const effectiveDate = parseIsoDateField(input.effectiveDate, "effectiveDate");
  if (!effectiveDate.ok) return effectiveDate;

  const reason = parseOptionalBoundedText(
    input.reason,
    "reason",
    OBLIGATION_REASON_MAX_LENGTH,
  );
  if (!reason.ok) return reason;

  return {
    ok: true,
    value: {
      to: to.value,
      effectiveDate: effectiveDate.value,
      reason: reason.value,
      expectedVersion: version.value,
    },
  };
}

function parseIntegerQuery(
  raw: unknown,
  field: string,
  fallback: number,
  max: number,
): { ok: true; value: number } | ObligationValidationFailure {
  if (raw === undefined) return { ok: true, value: fallback };
  if (typeof raw !== "string" || !INTEGER_STRING_RE.test(raw.trim())) {
    return failure(field, `${field} must be a whole number.`);
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value > max) {
    return failure(field, `${field} is out of range.`);
  }
  return { ok: true, value };
}

export function parseObligationListQuery(
  input: unknown,
): { ok: true; value: ObligationListValues } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("query", "Query must be an object.");
  }
  const unknownKey = findUnknownKey(input, LIST_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown query parameter "${unknownKey}".`);
  }

  let kind: ObligationKind | null = null;
  if (input.kind !== undefined && input.kind !== null && input.kind !== "") {
    const parsed = parseEnum(
      input.kind,
      "kind",
      isObligationKind,
      "Choose bill or subscription.",
    );
    if (!parsed.ok) return parsed;
    kind = parsed.value;
  }

  let state: ObligationState | null = null;
  if (input.state !== undefined && input.state !== null && input.state !== "") {
    const parsed = parseEnum(
      input.state,
      "state",
      isObligationState,
      "Choose a supported obligation state.",
    );
    if (!parsed.ok) return parsed;
    state = parsed.value;
  }

  const dueFrom = parseOptionalIsoDateField(input.dueFrom, "dueFrom");
  if (!dueFrom.ok) return dueFrom;
  const dueTo = parseOptionalIsoDateField(input.dueTo, "dueTo");
  if (!dueTo.ok) return dueTo;
  if (dueFrom.value && dueTo.value && dueFrom.value > dueTo.value) {
    return failure("dueFrom", "The start date must be on or before the end date.");
  }

  const limit = parseIntegerQuery(
    input.limit,
    "limit",
    OBLIGATION_LIST_DEFAULT_LIMIT,
    OBLIGATION_LIST_MAX_LIMIT,
  );
  if (!limit.ok) return limit;
  if (limit.value < 1) return failure("limit", "limit must be at least 1.");

  const offset = parseIntegerQuery(
    input.offset,
    "offset",
    0,
    OBLIGATION_LIST_MAX_OFFSET,
  );
  if (!offset.ok) return offset;

  return {
    ok: true,
    value: {
      kind,
      state,
      dueFrom: dueFrom.value,
      dueTo: dueTo.value,
      limit: limit.value,
      offset: offset.value,
    },
  };
}

export function parseObligationCutoffQuery(
  input: unknown,
): { ok: true; value: ObligationCutoffValues } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("query", "Query must be an object.");
  }
  const unknownKey = findUnknownKey(input, CUTOFF_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown query parameter "${unknownKey}".`);
  }
  const cutoff = parseIsoDateField(input.cutoff, "cutoff");
  if (!cutoff.ok) return cutoff;

  let kind: ObligationKind | null = null;
  if (input.kind !== undefined && input.kind !== null && input.kind !== "") {
    const parsed = parseEnum(
      input.kind,
      "kind",
      isObligationKind,
      "Choose bill or subscription.",
    );
    if (!parsed.ok) return parsed;
    kind = parsed.value;
  }
  return { ok: true, value: { cutoff: cutoff.value, kind } };
}

export function parseObligationGenerationInput(
  input: unknown,
): { ok: true; value: { templateId: string; throughDate: string } } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, GENERATE_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);
  if (!isObligationId(input.templateId)) {
    return failure("templateId", "Choose a valid template.");
  }
  const throughDate = parseIsoDateField(input.throughDate, "throughDate");
  if (!throughDate.ok) return throughDate;
  return {
    ok: true,
    value: { templateId: input.templateId, throughDate: throughDate.value },
  };
}

export type ObligationTemplateCreateValues = Readonly<{
  kind: ObligationKind;
  description: string;
  amountMinor: number;
  cadence: ObligationCadence;
  dueDayOfMonth: number | null;
  dueWeekday: number | null;
  startDate: string;
  endDate: string | null;
  needVsWant: ExpenseNeedVsWant | null;
  purpose: MoneyPurpose | null;
  countsInDaily: boolean | null;
  category: ExpenseCategory | null;
  idempotencyKey: string;
}>;

export function parseCreateObligationTemplateInput(
  input: unknown,
): { ok: true; value: ObligationTemplateCreateValues } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, CREATE_TEMPLATE_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);

  const kind = parseEnum(
    input.kind,
    "kind",
    isObligationKind,
    "Choose bill or subscription.",
  );
  if (!kind.ok) return kind;

  const description = parseBoundedText(
    input.description,
    "description",
    OBLIGATION_DESCRIPTION_MAX_LENGTH,
  );
  if (!description.ok) return description;

  const amountMinor = parseAmountMinor(input.amountMinor);
  if (!amountMinor.ok) return amountMinor;

  const cadence = parseEnum(
    input.cadence,
    "cadence",
    isObligationCadence,
    "Choose a supported recurrence.",
  );
  if (!cadence.ok) return cadence;

  const schedule = parseTemplateSchedule(cadence.value, input);
  if (!schedule.ok) return schedule;

  const startDate = parseIsoDateField(input.startDate, "startDate");
  if (!startDate.ok) return startDate;
  const endDate = parseOptionalIsoDateField(input.endDate, "endDate");
  if (!endDate.ok) return endDate;
  if (endDate.value && endDate.value < startDate.value) {
    return failure("endDate", "The end date must be on or after the start date.");
  }

  const needVsWant = parseNeedVsWant(input.needVsWant, true);
  if (!needVsWant.ok) return needVsWant;
  let purpose: MoneyPurpose | null = null;
  if (input.purpose !== undefined && input.purpose !== null) {
    const parsed = parsePurpose(input.purpose);
    if (!parsed.ok) return parsed;
    purpose = parsed.value;
  }
  let countsInDaily: boolean | null = null;
  if (input.countsInDaily !== undefined && input.countsInDaily !== null) {
    if (typeof input.countsInDaily !== "boolean") {
      return failure("countsInDaily", "Choose whether this counts in daily spending.");
    }
    countsInDaily = input.countsInDaily;
  }
  const category = parseCategory(input.category, true);
  if (!category.ok) return category;

  const idempotencyKey = parseBoundedText(
    input.idempotencyKey,
    "idempotencyKey",
    OBLIGATION_IDEMPOTENCY_KEY_MAX_LENGTH,
  );
  if (!idempotencyKey.ok) return idempotencyKey;

  return {
    ok: true,
    value: {
      kind: kind.value,
      description: description.value,
      amountMinor: amountMinor.value,
      cadence: cadence.value,
      dueDayOfMonth: schedule.dueDayOfMonth,
      dueWeekday: schedule.dueWeekday,
      startDate: startDate.value,
      endDate: endDate.value,
      needVsWant: needVsWant.value,
      purpose,
      countsInDaily,
      category: category.value,
      idempotencyKey: idempotencyKey.value,
    },
  };
}

function parseTemplateSchedule(
  cadence: ObligationCadence,
  input: Record<string, unknown>,
):
  | { ok: true; dueDayOfMonth: number | null; dueWeekday: number | null }
  | ObligationValidationFailure {
  const rawDay = input.dueDayOfMonth;
  const rawWeekday = input.dueWeekday;

  if (cadence === "weekly") {
    if (rawDay !== undefined && rawDay !== null) {
      return failure("dueDayOfMonth", "A weekly template uses a weekday, not a day of month.");
    }
    if (
      typeof rawWeekday !== "number" ||
      !Number.isInteger(rawWeekday) ||
      rawWeekday < 0 ||
      rawWeekday > 6
    ) {
      return failure("dueWeekday", "Choose a weekday from 0 (Sunday) to 6 (Saturday).");
    }
    return { ok: true, dueDayOfMonth: null, dueWeekday: rawWeekday };
  }

  if (rawWeekday !== undefined && rawWeekday !== null) {
    return failure("dueWeekday", "Only a weekly template uses a weekday.");
  }
  if (
    typeof rawDay !== "number" ||
    !Number.isInteger(rawDay) ||
    rawDay < 1 ||
    rawDay > 31
  ) {
    return failure("dueDayOfMonth", "Choose a day of month from 1 to 31.");
  }
  return { ok: true, dueDayOfMonth: rawDay, dueWeekday: null };
}

export type ObligationTemplateUpdateValues = Readonly<{
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
  expectedVersion: number;
}>;

export function parseUpdateObligationTemplateInput(
  input: unknown,
): { ok: true; value: ObligationTemplateUpdateValues } | ObligationValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, UPDATE_TEMPLATE_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);
  const version = parseVersion(input.version);
  if (!version.ok) return version;

  const changes: {
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
  } = {};

  if (input.description !== undefined) {
    const parsed = parseBoundedText(
      input.description,
      "description",
      OBLIGATION_DESCRIPTION_MAX_LENGTH,
    );
    if (!parsed.ok) return parsed;
    changes.description = parsed.value;
  }
  if (input.amountMinor !== undefined) {
    const parsed = parseAmountMinor(input.amountMinor);
    if (!parsed.ok) return parsed;
    changes.amountMinor = parsed.value;
  }
  let cadence: ObligationCadence | undefined;
  if (input.cadence !== undefined) {
    const parsed = parseEnum(
      input.cadence,
      "cadence",
      isObligationCadence,
      "Choose a supported recurrence.",
    );
    if (!parsed.ok) return parsed;
    cadence = parsed.value;
    changes.cadence = parsed.value;
  }
  if (input.dueDayOfMonth !== undefined) {
    if (
      input.dueDayOfMonth !== null &&
      (typeof input.dueDayOfMonth !== "number" ||
        !Number.isInteger(input.dueDayOfMonth) ||
        input.dueDayOfMonth < 1 ||
        input.dueDayOfMonth > 31)
    ) {
      return failure("dueDayOfMonth", "Choose a day of month from 1 to 31.");
    }
    changes.dueDayOfMonth = input.dueDayOfMonth as number | null;
  }
  if (input.dueWeekday !== undefined) {
    if (
      input.dueWeekday !== null &&
      (typeof input.dueWeekday !== "number" ||
        !Number.isInteger(input.dueWeekday) ||
        input.dueWeekday < 0 ||
        input.dueWeekday > 6)
    ) {
      return failure("dueWeekday", "Choose a weekday from 0 (Sunday) to 6 (Saturday).");
    }
    changes.dueWeekday = input.dueWeekday as number | null;
  }
  if (cadence !== undefined) {
    if (cadence === "weekly" && changes.dueDayOfMonth) {
      return failure("dueDayOfMonth", "A weekly template uses a weekday, not a day of month.");
    }
    if (cadence !== "weekly" && changes.dueWeekday) {
      return failure("dueWeekday", "Only a weekly template uses a weekday.");
    }
  }
  if (input.startDate !== undefined) {
    const parsed = parseIsoDateField(input.startDate, "startDate");
    if (!parsed.ok) return parsed;
    changes.startDate = parsed.value;
  }
  if ("endDate" in input) {
    const parsed = parseOptionalIsoDateField(input.endDate, "endDate");
    if (!parsed.ok) return parsed;
    changes.endDate = parsed.value;
  }
  if ("needVsWant" in input) {
    const parsed = parseNeedVsWant(input.needVsWant, true);
    if (!parsed.ok) return parsed;
    changes.needVsWant = parsed.value;
  }
  if ("purpose" in input) {
    if (input.purpose === null) changes.purpose = null;
    else {
      const parsed = parsePurpose(input.purpose);
      if (!parsed.ok) return parsed;
      changes.purpose = parsed.value;
    }
  }
  if ("countsInDaily" in input) {
    if (input.countsInDaily !== null && typeof input.countsInDaily !== "boolean") {
      return failure("countsInDaily", "Choose whether this counts in daily spending.");
    }
    changes.countsInDaily = input.countsInDaily as boolean | null;
  }
  if ("category" in input) {
    const parsed = parseCategory(input.category, true);
    if (!parsed.ok) return parsed;
    changes.category = parsed.value;
  }
  if (input.lifecycle !== undefined) {
    if (
      input.lifecycle !== "active" &&
      input.lifecycle !== "archived"
    ) {
      return failure("lifecycle", "Choose active or archived.");
    }
    changes.lifecycle = input.lifecycle;
  }

  if (Object.keys(changes).length === 0) {
    return failure("body", "At least one template field must be provided.");
  }
  return { ok: true, value: { ...changes, expectedVersion: version.value } };
}

/* -------------------------------------------------------------------------- */
/* Payment seam (owned by MONEY-07)                                           */
/* -------------------------------------------------------------------------- */

export type ObligationPaymentCandidate = Readonly<{
  expenseId: string;
  amountMinor: number;
  currency: string;
  direction: string;
  bookingDate: string;
}>;

export type ObligationPaymentRejection =
  | "already_settled"
  | "not_pending"
  | "currency_mismatch"
  | "direction_mismatch"
  | "invalid_booking_date"
  | "partial_payment"
  | "overpayment";

export type ObligationPaymentValidation =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: ObligationPaymentRejection; message: string }>;

/**
 * MONEY-07 transaction seam. The atomic payment use case must call this before
 * linking a canonical ledger payment to an occurrence. This issue never
 * creates the payment; it only freezes the rule so a bare status change cannot
 * manufacture one.
 */
export function validateObligationPayment(
  occurrence: Pick<
    ObligationOccurrence,
    "state" | "amountMinor" | "currency"
  >,
  payment: ObligationPaymentCandidate,
): ObligationPaymentValidation {
  if (occurrence.state === "paid") {
    return {
      ok: false,
      reason: "already_settled",
      message: "This obligation is already paid.",
    };
  }
  if (occurrence.state !== "pending") {
    return {
      ok: false,
      reason: "not_pending",
      message: "Reopen the obligation to pending before paying it.",
    };
  }
  if (payment.currency !== OBLIGATION_CURRENCY) {
    return {
      ok: false,
      reason: "currency_mismatch",
      message: "The obligation payment must be in MAD.",
    };
  }
  if (payment.direction !== "out") {
    return {
      ok: false,
      reason: "direction_mismatch",
      message: "An obligation payment is a cash outflow.",
    };
  }
  if (!isIsoDate(payment.bookingDate)) {
    return {
      ok: false,
      reason: "invalid_booking_date",
      message: "The payment needs a real booking date.",
    };
  }
  if (payment.amountMinor < occurrence.amountMinor) {
    return {
      ok: false,
      reason: "partial_payment",
      message:
        "Partial payments are not supported: one full payment settles the occurrence.",
    };
  }
  if (payment.amountMinor > occurrence.amountMinor) {
    return {
      ok: false,
      reason: "overpayment",
      message:
        "Overpayment is not supported: one full payment settles the occurrence.",
    };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Fingerprints                                                               */
/* -------------------------------------------------------------------------- */

/** Deterministic canonical payload for the immutable occurrence create. */
export function canonicalObligationCreatePayload(
  values: ObligationCreateValues,
): string {
  return JSON.stringify([
    values.kind,
    values.description,
    values.amountMinor,
    values.periodStart,
    values.periodEnd,
    values.dueDate,
    values.needVsWant,
    values.purpose,
    values.countsInDaily,
    values.category,
    values.stateEffectiveDate,
    values.templateId,
    values.idempotencyKey,
  ]);
}

/** Deterministic canonical payload for the immutable template create. */
export function canonicalObligationTemplateCreatePayload(
  values: ObligationTemplateCreateValues,
): string {
  return JSON.stringify([
    values.kind,
    values.description,
    values.amountMinor,
    values.cadence,
    values.dueDayOfMonth,
    values.dueWeekday,
    values.startDate,
    values.endDate,
    values.needVsWant,
    values.purpose,
    values.countsInDaily,
    values.category,
    values.idempotencyKey,
  ]);
}
