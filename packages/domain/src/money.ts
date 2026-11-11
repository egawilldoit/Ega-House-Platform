import {
  EXPENSE_AMOUNT_MINOR_MAX,
  EXPENSE_IDEMPOTENCY_KEY_MAX_LENGTH,
  EXPENSE_LIST_DEFAULT_LIMIT,
  EXPENSE_LIST_MAX_LIMIT,
  EXPENSE_LIST_MAX_OFFSET,
  EXPENSE_LIST_MAX_WINDOW_DAYS,
  EXPENSE_MERCHANT_MAX_LENGTH,
  EXPENSE_NOTE_MAX_LENGTH,
  isExpenseCategory,
  isExpenseNeedVsWant,
  isExpensePaymentMethod,
  isExpensePurpose,
  parseAmountMinor,
  parseBoundedText,
  parseEnum,
  parseOccurredAt,
  type ExpenseCategory,
  type ExpenseCurrency,
  type ExpenseNeedVsWant,
  type ExpensePaymentMethod,
  type ExpenseValidationFailure,
} from "./expenses";
import { addDaysToIsoDate, isIsoDate, isValidIANATimeZone } from "./time-context";

/**
 * MONEY-04: the personal expense journal is the canonical money ledger.
 *
 * A movement is one row of `personal_expenses` extended additively with
 * `kind`, `direction`, `purpose`, `counts_in_daily`, `booking_date` and
 * `period_id`. Amounts are always positive integer MAD centimes; `kind` and
 * `direction` carry the sign so income is never a negative expense.
 */

export const MONEY_KINDS = [
  "expense",
  "income",
  "opening",
  "savings_transfer",
  "reconciliation_adjustment",
] as const;
export type MoneyKind = (typeof MONEY_KINDS)[number];

export const MONEY_DIRECTIONS = ["in", "out"] as const;
export type MoneyDirection = (typeof MONEY_DIRECTIONS)[number];

export const MONEY_PURPOSES = ["fixed", "flexible", "emergency"] as const;
export type MoneyPurpose = (typeof MONEY_PURPOSES)[number];

/**
 * The tracked spendable-cash boundary is explicit: the ledger records cash the
 * owner can spend. A real savings transfer leaves that boundary once (cash
 * down, funded savings up). A transfer between two accounts already inside the
 * boundary has no net effect and is not a money movement in this scope.
 */
export const MONEY_TRACKED_CASH_BOUNDARY = {
  spendableCash: "tracked owner cash recorded in the personal_expenses ledger",
  savingsTransfer: "reduces spendable cash once and increases funded savings once",
  internalTransfer: "no net cash effect when both accounts are inside the boundary",
} as const;
export type MoneyTrackedCashBoundary = typeof MONEY_TRACKED_CASH_BOUNDARY;

/** Minimal compatibility alias for the frozen shared contract shape. */
export type MoneyLedgerRow = Readonly<{
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
  bookingDate: string;
  occurredAt: string | null;
  periodId: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type MoneyCreateValues = Readonly<{
  kind: MoneyKind;
  direction: MoneyDirection;
  amountMinor: number;
  category: ExpenseCategory | null;
  note: string | null;
  merchant: string | null;
  needVsWant: ExpenseNeedVsWant | null;
  paymentMethod: ExpensePaymentMethod | null;
  purpose: MoneyPurpose | null;
  countsInDaily: boolean;
  bookingDate: string;
  occurredAt: string | null;
  idempotencyKey: string;
}>;

export type MoneyUpdateChanges = Readonly<{
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

export type MoneyUpdateValues = MoneyUpdateChanges &
  Readonly<{ expectedVersion: number }>;

export type MoneyListValues = Readonly<{
  limit: number;
  offset: number;
  from: string | null;
  to: string | null;
  cutoff: string | null;
  timezone: string | null;
  kind: MoneyKind | null;
}>;

export type MoneyStateValues = Readonly<{
  cutoff: string | null;
  timezone: string | null;
}>;

const CREATE_KEYS = new Set([
  "kind",
  "direction",
  "amountMinor",
  "category",
  "note",
  "merchant",
  "needVsWant",
  "paymentMethod",
  "purpose",
  "countsInDaily",
  "bookingDate",
  "occurredAt",
  "idempotencyKey",
]);

const UPDATE_KEYS = new Set([
  "bookingDate",
  "occurredAt",
  "amountMinor",
  "category",
  "note",
  "merchant",
  "needVsWant",
  "paymentMethod",
  "purpose",
  "countsInDaily",
  "version",
]);

const LIST_KEYS = new Set([
  "from",
  "to",
  "cutoff",
  "timezone",
  "kind",
  "limit",
  "offset",
]);

const STATE_KEYS = new Set(["cutoff", "timezone"]);

const INTEGER_STRING_RE = /^\d+$/;

function failure(field: string, message: string): ExpenseValidationFailure {
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

export function isMoneyKind(value: unknown): value is MoneyKind {
  return typeof value === "string" && (MONEY_KINDS as readonly string[]).includes(value);
}

export function isMoneyDirection(value: unknown): value is MoneyDirection {
  return value === "in" || value === "out";
}

export function isMoneyPurpose(value: unknown): value is MoneyPurpose {
  return value === "fixed" || value === "flexible" || value === "emergency";
}

/**
 * Product defaults from the frozen shared contract. MONEY-07 defines the
 * fixed-payment default; this issue treats every recorded expense
 * (emergency included) as daily-included unless the owner overrides it.
 */
export function defaultCountsInDaily(kind: MoneyKind): boolean {
  return kind === "expense";
}

/** The only direction each non-adjustment kind can have. */
export function canonicalDirection(kind: MoneyKind): MoneyDirection | null {
  if (kind === "expense" || kind === "savings_transfer") return "out";
  if (kind === "income" || kind === "opening") return "in";
  return null;
}

function parseCountsInDaily(
  raw: unknown,
  fallback: boolean,
): { ok: true; value: boolean } | ExpenseValidationFailure {
  if (raw === undefined) return { ok: true, value: fallback };
  if (typeof raw !== "boolean") {
    return failure("countsInDaily", "countsInDaily must be true or false.");
  }
  return { ok: true, value: raw };
}

function parseBookingDate(
  raw: unknown,
): { ok: true; value: string | null } | ExpenseValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || !isIsoDate(raw.trim())) {
    return failure("bookingDate", "Booking date must be a valid YYYY-MM-DD date.");
  }
  return { ok: true, value: raw.trim() };
}

/**
 * Parse a movement create body shared by HTTP, web actions and MCP. Unknown
 * keys are rejected so a caller can never select an owner, a currency or a
 * mirror column. A date-only movement keeps `occurredAt` null; a timestamped
 * client keeps its real instant and the calendar day it wrote as booking date.
 */
export function parseCreateMovementInput(
  input: unknown,
): { ok: true; value: MoneyCreateValues } | ExpenseValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, CREATE_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);

  const kind = parseEnum(input.kind, "kind", isMoneyKind, "Choose a supported movement kind.");
  if (!kind.ok) return kind;

  const expectedDirection = canonicalDirection(kind.value);
  if (kind.value === "opening") {
    return failure(
      "kind",
      "Opening cash is set when a period is initialized; it is not a manually created movement.",
    );
  }
  let direction: MoneyDirection;
  if (expectedDirection) {
    if (input.direction !== undefined && input.direction !== expectedDirection) {
      return failure("direction", `A ${kind.value} movement must have direction ${expectedDirection}.`);
    }
    direction = expectedDirection;
  } else {
    if (!isMoneyDirection(input.direction)) {
      return failure("direction", "A reconciliation adjustment needs direction in or out.");
    }
    direction = input.direction;
  }

  const amountMinor = parseAmountMinor(input.amountMinor);
  if (!amountMinor.ok) return amountMinor;

  const occurredAtRaw = input.occurredAt;
  let occurredAt: string | null = null;
  let calendarDate: string | null = null;
  if (occurredAtRaw !== undefined && occurredAtRaw !== null) {
    const parsed = parseOccurredAt(occurredAtRaw);
    if (!parsed.ok) return parsed;
    occurredAt = parsed.value;
    calendarDate = parsed.calendarDate;
  }

  const bookingDate = parseBookingDate(input.bookingDate);
  if (!bookingDate.ok) return bookingDate;
  const resolvedBookingDate = bookingDate.value ?? calendarDate;
  if (!resolvedBookingDate) {
    return failure("bookingDate", "A booking date or an occurredAt timestamp is required.");
  }

  const isExpense = kind.value === "expense";
  let category: ExpenseCategory | null = null;
  let needVsWant: ExpenseNeedVsWant | null = null;
  if (isExpense) {
    const parsedCategory = parseEnum(
      input.category,
      "category",
      isExpenseCategory,
      "Choose a supported category.",
    );
    if (!parsedCategory.ok) return parsedCategory;
    category = parsedCategory.value;
    const parsedNeed = parseEnum(
      input.needVsWant,
      "needVsWant",
      isExpenseNeedVsWant,
      "Choose need or want.",
    );
    if (!parsedNeed.ok) return parsedNeed;
    needVsWant = parsedNeed.value;
  } else {
    if (input.category !== undefined && input.category !== null) {
      return failure("category", "Only expense movements have a spending category.");
    }
    if (input.needVsWant !== undefined && input.needVsWant !== null) {
      return failure("needVsWant", "Only expense movements have a need or want classification.");
    }
  }

  let purpose: MoneyPurpose | null = null;
  if (input.purpose !== undefined && input.purpose !== null) {
    if (!isExpense) {
      return failure("purpose", "Only expense movements have a spending purpose.");
    }
    const parsed = parseEnum(
      input.purpose,
      "purpose",
      isExpensePurpose,
      "Choose fixed, flexible or emergency.",
    );
    if (!parsed.ok) return parsed;
    purpose = parsed.value;
  }

  const note = parseBoundedText(input.note, "note", EXPENSE_NOTE_MAX_LENGTH, {
    required: false,
    allowLineControls: true,
  });
  if (!note.ok) return note;

  const merchant = parseBoundedText(
    input.merchant,
    "merchant",
    EXPENSE_MERCHANT_MAX_LENGTH,
    { required: false, allowLineControls: true },
  );
  if (!merchant.ok) return merchant;

  let paymentMethod: ExpensePaymentMethod | null = null;
  if (input.paymentMethod !== undefined && input.paymentMethod !== null) {
    const parsed = parseEnum(
      input.paymentMethod,
      "paymentMethod",
      isExpensePaymentMethod,
      "Choose a supported payment method.",
    );
    if (!parsed.ok) return parsed;
    paymentMethod = parsed.value;
  }

  const countsInDaily = parseCountsInDaily(
    input.countsInDaily,
    defaultCountsInDaily(kind.value),
  );
  if (!countsInDaily.ok) return countsInDaily;

  const idempotencyKey = parseBoundedText(
    input.idempotencyKey,
    "idempotencyKey",
    EXPENSE_IDEMPOTENCY_KEY_MAX_LENGTH,
    { required: true, allowLineControls: false },
  );
  if (!idempotencyKey.ok) return idempotencyKey;

  return {
    ok: true,
    value: {
      kind: kind.value,
      direction,
      amountMinor: amountMinor.value,
      category,
      note: note.value,
      merchant: merchant.value,
      needVsWant,
      paymentMethod,
      purpose,
      countsInDaily: countsInDaily.value,
      bookingDate: resolvedBookingDate,
      occurredAt,
      idempotencyKey: idempotencyKey.value as string,
    },
  };
}

/** Validate a PATCH body. Kind and direction are immutable after creation. */
export function parseUpdateMovementInput(
  input: unknown,
): { ok: true; value: MoneyUpdateValues } | ExpenseValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, UPDATE_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);

  const rawVersion = input.version;
  if (
    typeof rawVersion !== "number" ||
    !Number.isInteger(rawVersion) ||
    rawVersion < 1 ||
    rawVersion > EXPENSE_AMOUNT_MINOR_MAX
  ) {
    return failure("version", "A positive expected version is required.");
  }

  const changes: {
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
  } = {};

  if (input.bookingDate !== undefined) {
    const parsed = parseBookingDate(input.bookingDate);
    if (!parsed.ok) return parsed;
    if (!parsed.value) {
      return failure("bookingDate", "Booking date must be a valid YYYY-MM-DD date.");
    }
    changes.bookingDate = parsed.value;
  }

  if (input.occurredAt !== undefined) {
    if (input.occurredAt === null) {
      changes.occurredAt = null;
    } else {
      const parsed = parseOccurredAt(input.occurredAt);
      if (!parsed.ok) return parsed;
      changes.occurredAt = parsed.value;
    }
  }

  if (input.amountMinor !== undefined) {
    const parsed = parseAmountMinor(input.amountMinor);
    if (!parsed.ok) return parsed;
    changes.amountMinor = parsed.value;
  }

  if (input.category !== undefined) {
    const parsed = parseEnum(
      input.category,
      "category",
      isExpenseCategory,
      "Choose a supported category.",
    );
    if (!parsed.ok) return parsed;
    changes.category = parsed.value;
  }

  if (input.needVsWant !== undefined) {
    const parsed = parseEnum(
      input.needVsWant,
      "needVsWant",
      isExpenseNeedVsWant,
      "Choose need or want.",
    );
    if (!parsed.ok) return parsed;
    changes.needVsWant = parsed.value;
  }

  if (input.note !== undefined) {
    const parsed = parseBoundedText(input.note, "note", EXPENSE_NOTE_MAX_LENGTH, {
      required: false,
      allowLineControls: true,
    });
    if (!parsed.ok) return parsed;
    changes.note = parsed.value;
  }

  if (input.merchant !== undefined) {
    const parsed = parseBoundedText(
      input.merchant,
      "merchant",
      EXPENSE_MERCHANT_MAX_LENGTH,
      { required: false, allowLineControls: true },
    );
    if (!parsed.ok) return parsed;
    changes.merchant = parsed.value;
  }

  if (input.paymentMethod !== undefined) {
    if (input.paymentMethod === null) {
      changes.paymentMethod = null;
    } else {
      const parsed = parseEnum(
        input.paymentMethod,
        "paymentMethod",
        isExpensePaymentMethod,
        "Choose a supported payment method.",
      );
      if (!parsed.ok) return parsed;
      changes.paymentMethod = parsed.value;
    }
  }

  if (input.purpose !== undefined) {
    if (input.purpose === null) {
      changes.purpose = null;
    } else {
      const parsed = parseEnum(
        input.purpose,
        "purpose",
        isMoneyPurpose,
        "Choose fixed, flexible or emergency.",
      );
      if (!parsed.ok) return parsed;
      changes.purpose = parsed.value;
    }
  }

  if (input.countsInDaily !== undefined) {
    if (typeof input.countsInDaily !== "boolean") {
      return failure("countsInDaily", "countsInDaily must be true or false.");
    }
    changes.countsInDaily = input.countsInDaily;
  }

  if (Object.keys(changes).length === 0) {
    return failure("body", "At least one movement field must be provided.");
  }

  return { ok: true, value: { ...changes, expectedVersion: rawVersion } };
}

function parseIntegerQuery(
  raw: unknown,
  field: string,
  fallback: number,
  max: number,
): { ok: true; value: number } | ExpenseValidationFailure {
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

function parseOptionalDate(
  raw: unknown,
  field: string,
): { ok: true; value: string | null } | ExpenseValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || !isIsoDate(raw.trim())) {
    return failure(field, `${field} must be a valid YYYY-MM-DD date.`);
  }
  return { ok: true, value: raw.trim() };
}

function parseOptionalKind(
  raw: unknown,
): { ok: true; value: MoneyKind | null } | ExpenseValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isMoneyKind(raw)) {
    return failure("kind", "Choose a supported movement kind.");
  }
  return { ok: true, value: raw };
}

function parseTimezone(
  raw: unknown,
  fallback: string | null | undefined,
): { ok: true; value: string | null } | ExpenseValidationFailure {
  let timezone: string | null = null;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "string" || !raw.trim()) {
      return failure("timezone", "Timezone must be a valid IANA timezone.");
    }
    timezone = raw.trim();
  } else if (typeof fallback === "string" && fallback.trim()) {
    timezone = fallback.trim();
  }
  if (timezone !== null && !isValidIANATimeZone(timezone)) {
    return failure("timezone", "Timezone must be a valid IANA timezone.");
  }
  return { ok: true, value: timezone };
}

/**
 * Validate movement list pagination. `from`/`to`/`cutoff` are inclusive
 * booking dates: booking date is the owner-resolved day a movement belongs to,
 * not the UTC instant a legacy timestamp happened to convert to.
 */
export function parseMoneyListQuery(
  input: unknown,
  options: Readonly<{ timezone?: string | null }> = {},
): { ok: true; value: MoneyListValues } | ExpenseValidationFailure {
  if (!isRecord(input)) return failure("query", "Query must be an object.");
  const unknownKey = findUnknownKey(input, LIST_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown query parameter "${unknownKey}".`);

  const limit = parseIntegerQuery(input.limit, "limit", EXPENSE_LIST_DEFAULT_LIMIT, EXPENSE_LIST_MAX_LIMIT);
  if (!limit.ok) return limit;
  if (limit.value < 1) return failure("limit", "limit must be at least 1.");

  const offset = parseIntegerQuery(input.offset, "offset", 0, EXPENSE_LIST_MAX_OFFSET);
  if (!offset.ok) return offset;

  const from = parseOptionalDate(input.from, "from");
  if (!from.ok) return from;
  const to = parseOptionalDate(input.to, "to");
  if (!to.ok) return to;
  const cutoff = parseOptionalDate(input.cutoff, "cutoff");
  if (!cutoff.ok) return cutoff;

  if (from.value && to.value) {
    if (from.value > to.value) {
      return failure("from", "The start date must be on or before the end date.");
    }
    if (to.value > addDaysToIsoDate(from.value, EXPENSE_LIST_MAX_WINDOW_DAYS - 1)) {
      return failure("to", `The date range must be ${EXPENSE_LIST_MAX_WINDOW_DAYS} days or fewer.`);
    }
  }
  if (to.value && cutoff.value && cutoff.value < to.value) {
    return failure("cutoff", "The cutoff must be on or after the end date.");
  }

  const timezone = parseTimezone(input.timezone, options.timezone);
  if (!timezone.ok) return timezone;

  const kind = parseOptionalKind(input.kind);
  if (!kind.ok) return kind;

  return {
    ok: true,
    value: {
      limit: limit.value,
      offset: offset.value,
      from: from.value,
      to: to.value,
      cutoff: cutoff.value,
      timezone: timezone.value,
      kind: kind.value,
    },
  };
}

/** Validate the optional cutoff/timezone of a cash-state read. */
export function parseMoneyStateQuery(
  input: unknown,
  options: Readonly<{ timezone?: string | null }> = {},
): { ok: true; value: MoneyStateValues } | ExpenseValidationFailure {
  if (!isRecord(input)) return failure("query", "Query must be an object.");
  const unknownKey = findUnknownKey(input, STATE_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown query parameter "${unknownKey}".`);

  const cutoff = parseOptionalDate(input.cutoff, "cutoff");
  if (!cutoff.ok) return cutoff;

  const timezone = parseTimezone(input.timezone, options.timezone);
  if (!timezone.ok) return timezone;

  return { ok: true, value: { cutoff: cutoff.value, timezone: timezone.value } };
}

/**
 * Deterministic canonical payload for the immutable movement create request.
 * It carries every semantic field, including `countsInDaily`, so a retry with a
 * different daily-inclusion flag can never replay an earlier movement.
 */
export function canonicalMovementCreatePayload(values: MoneyCreateValues): string {
  return JSON.stringify([
    values.kind,
    values.direction,
    values.amountMinor,
    values.category,
    values.note,
    values.merchant,
    values.needVsWant,
    values.paymentMethod,
    values.purpose,
    values.countsInDaily,
    values.bookingDate,
    values.occurredAt === null ? null : Date.parse(values.occurredAt),
    values.idempotencyKey,
  ]);
}
