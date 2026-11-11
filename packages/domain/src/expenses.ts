import {
  addDaysToIsoDate,
  getLocalDayWindow,
  isIsoDate,
  isValidIANATimeZone,
} from "./time-context";

/**
 * Owner-scoped personal expense ledger (PO-06 Slice A, issue #346).
 *
 * Pure parsing and bounds for the single-currency (MAD) ledger. Money is
 * always stored as a positive integer amount of centimes so no floating point
 * value ever reaches persistence. The same rules are shared by the Hono
 * transport, application use cases, data-access adapter and future clients.
 */

export const EXPENSE_CURRENCY = "MAD" as const;
export type ExpenseCurrency = typeof EXPENSE_CURRENCY;

export const EXPENSE_CATEGORY_VALUES = [
  "coffee",
  "groceries",
  "eating_out",
  "transport",
  "bills",
  "subscriptions",
  "household",
  "health",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORY_VALUES)[number];

export const EXPENSE_NEED_VS_WANT_VALUES = ["need", "want"] as const;
export type ExpenseNeedVsWant = (typeof EXPENSE_NEED_VS_WANT_VALUES)[number];

export const EXPENSE_PAYMENT_METHOD_VALUES = [
  "cash",
  "card",
  "bank_transfer",
  "mobile_wallet",
  "other",
] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHOD_VALUES)[number];

/** PostgreSQL int4 upper bound: the ledger cannot store a larger amount. */
export const EXPENSE_AMOUNT_MINOR_MIN = 1;
export const EXPENSE_AMOUNT_MINOR_MAX = 2_147_483_647;

export const EXPENSE_NOTE_MAX_LENGTH = 500;
export const EXPENSE_MERCHANT_MAX_LENGTH = 120;
export const EXPENSE_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export const EXPENSE_LIST_DEFAULT_LIMIT = 50;
export const EXPENSE_LIST_MAX_LIMIT = 100;
export const EXPENSE_LIST_MAX_OFFSET = 1_000_000;
export const EXPENSE_LIST_MAX_WINDOW_DAYS = 366;

/**
 * Persisted value shape. This is deliberately transport-neutral and contains
 * no Supabase/PostgREST or UI concepts.
 *
 * MONEY-04 extends the row additively into the single money ledger: an expense
 * is one `kind` of movement. Type-only imports keep this module runtime-free of
 * `money.ts` (which owns the movement kinds and imports these validators).
 */
export type PersonalExpense = Readonly<{
  id: string;
  kind: "expense";
  direction: "out";
  /** Null means a date-only booking; `bookingDate` remains known. */
  occurredAt: string | null;
  bookingDate: string;
  amountMinor: number;
  currency: ExpenseCurrency;
  category: ExpenseCategory;
  note: string | null;
  merchant: string | null;
  needVsWant: ExpenseNeedVsWant;
  paymentMethod: ExpensePaymentMethod | null;
  purpose: ExpensePurpose | null;
  countsInDaily: boolean;
  periodId: string | null;
  idempotencyKey: string;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ExpenseCreateValues = Readonly<{
  occurredAt: string;
  /** Owner-local booking day carried by the request's calendar date. */
  bookingDate: string;
  amountMinor: number;
  category: ExpenseCategory;
  note: string | null;
  merchant: string | null;
  needVsWant: ExpenseNeedVsWant;
  paymentMethod: ExpensePaymentMethod | null;
  idempotencyKey: string;
}>;

export type ExpensePurpose = "fixed" | "flexible" | "emergency";

export type ExpenseUpdateChanges = Readonly<{
  occurredAt?: string;
  bookingDate?: string;
  amountMinor?: number;
  category?: ExpenseCategory;
  note?: string | null;
  merchant?: string | null;
  needVsWant?: ExpenseNeedVsWant;
  paymentMethod?: ExpensePaymentMethod | null;
  purpose?: ExpensePurpose | null;
  countsInDaily?: boolean;
}>;

export type ExpenseUpdateValues = ExpenseUpdateChanges &
  Readonly<{
    expectedVersion: number;
  }>;

export type ExpenseListValues = Readonly<{
  limit: number;
  offset: number;
  from: string | null;
  to: string | null;
  timezone: string | null;
  startUtcIso: string | null;
  endUtcExclusiveIso: string | null;
  /**
   * Owner-local booking-date window `[startBookingDate, endBookingDateExclusive)`.
   * Reporting uses this so date-only rows (unknown instant) and timestamped rows
   * are counted on the same resolved day.
   */
  startBookingDate: string | null;
  endBookingDateExclusive: string | null;
}>;

export type ExpenseValidationFailure = Readonly<{
  ok: false;
  field: string;
  message: string;
}>;

const ISO_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER_STRING_RE = /^\d+$/;

const CREATE_KEYS = new Set([
  "occurredAt",
  "amountMinor",
  "category",
  "note",
  "merchant",
  "needVsWant",
  "paymentMethod",
  "idempotencyKey",
]);

const UPDATE_KEYS = new Set([
  "occurredAt",
  "bookingDate",
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

const LIST_KEYS = new Set(["from", "to", "limit", "offset", "timezone"]);

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

export function isExpensePurpose(value: unknown): value is ExpensePurpose {
  return value === "fixed" || value === "flexible" || value === "emergency";
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return (
    typeof value === "string" &&
    (EXPENSE_CATEGORY_VALUES as readonly string[]).includes(value)
  );
}

export function isExpenseNeedVsWant(value: unknown): value is ExpenseNeedVsWant {
  return (
    typeof value === "string" &&
    (EXPENSE_NEED_VS_WANT_VALUES as readonly string[]).includes(value)
  );
}

export function isExpensePaymentMethod(
  value: unknown,
): value is ExpensePaymentMethod {
  return (
    typeof value === "string" &&
    (EXPENSE_PAYMENT_METHOD_VALUES as readonly string[]).includes(value)
  );
}

export function isExpenseId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function parseAmountMinor(
  raw: unknown,
): { ok: true; value: number } | ExpenseValidationFailure {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return failure("amountMinor", "Amount must be a whole number of centimes.");
  }
  if (raw < EXPENSE_AMOUNT_MINOR_MIN) {
    return failure("amountMinor", "Amount must be greater than zero.");
  }
  if (raw > EXPENSE_AMOUNT_MINOR_MAX) {
    return failure("amountMinor", "Amount is too large.");
  }
  return { ok: true, value: raw };
}

export function parseOccurredAt(
  raw: unknown,
): { ok: true; value: string; calendarDate: string } | ExpenseValidationFailure {
  if (typeof raw !== "string") {
    return failure("occurredAt", "Date and time are required.");
  }
  const trimmed = raw.trim();
  const match = ISO_DATE_TIME_RE.exec(trimmed);
  if (!match) {
    return failure("occurredAt", "Date and time must be an ISO timestamp.");
  }

  const [, year, month, day, hour, minute, second, , zone, , offsetHour, offsetMinute] =
    match;
  if (!isIsoDate(`${year}-${month}-${day}`)) {
    return failure("occurredAt", "Date and time must be a real calendar date.");
  }
  if (
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    (second !== undefined && Number(second) > 59)
  ) {
    return failure("occurredAt", "Date and time must use a valid clock time.");
  }
  if (zone !== "Z" && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) {
    return failure("occurredAt", "Date and time must use a valid UTC offset.");
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return failure("occurredAt", "Date and time must be an ISO timestamp.");
  }
  return {
    ok: true,
    value: new Date(parsed).toISOString(),
    // The calendar day the caller wrote, before conversion to UTC. This keeps
    // a 23:30 +01:00 purchase on its owner-local booking day instead of
    // shifting it to the previous UTC day.
    calendarDate: `${year}-${month}-${day}`,
  };
}

/**
 * Reject NUL, unpaired UTF-16 surrogates and disallowed C0/DEL control
 * characters. Note and merchant may contain tab/newline/CR; an idempotency
 * key is a stable token and may not contain any control character.
 */
function findUnsupportedCharacters(
  value: string,
  allowLineControls: boolean,
): string | null {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return "NUL";
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return "surrogate";
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return "surrogate";
    if (code === 0x7f) return "control";
    if (
      code < 0x20 &&
      !(allowLineControls && (code === 0x09 || code === 0x0a || code === 0x0d))
    ) {
      return "control";
    }
  }
  return null;
}

export function parseBoundedText(
  raw: unknown,
  field: string,
  maxLength: number,
  options: Readonly<{ required: boolean; allowLineControls: boolean }>,
): { ok: true; value: string | null } | ExpenseValidationFailure {
  if (raw === undefined || raw === null) {
    return options.required
      ? failure(field, "This value is required.")
      : { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return failure(field, "This value must be text.");
  }
  const unsupported = findUnsupportedCharacters(raw, options.allowLineControls);
  if (unsupported) {
    return failure(field, "This value contains unsupported characters.");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return options.required
      ? failure(field, "This value is required.")
      : { ok: true, value: null };
  }
  if (Array.from(trimmed).length > maxLength) {
    return failure(field, `This value must be ${maxLength} characters or fewer.`);
  }
  return { ok: true, value: trimmed };
}

export function parseEnum<T extends string>(
  raw: unknown,
  field: string,
  isValue: (value: unknown) => value is T,
  message: string,
): { ok: true; value: T } | ExpenseValidationFailure {
  if (!isValue(raw)) return failure(field, message);
  return { ok: true, value: raw };
}

/**
 * Validate a create body. Unknown keys (including caller-supplied owner or
 * user ids and a caller-selected currency) are rejected rather than ignored so
 * a caller cannot smuggle another identity into persistence.
 */
export function parseCreateExpenseInput(
  input: unknown,
): { ok: true; value: ExpenseCreateValues } | ExpenseValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, CREATE_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown field "${unknownKey}".`);
  }

  const occurredAt = parseOccurredAt(input.occurredAt);
  if (!occurredAt.ok) return occurredAt;

  const amountMinor = parseAmountMinor(input.amountMinor);
  if (!amountMinor.ok) return amountMinor;

  const category = parseEnum(
    input.category,
    "category",
    isExpenseCategory,
    "Choose a supported category.",
  );
  if (!category.ok) return category;

  const needVsWant = parseEnum(
    input.needVsWant,
    "needVsWant",
    isExpenseNeedVsWant,
    "Choose need or want.",
  );
  if (!needVsWant.ok) return needVsWant;

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
      occurredAt: occurredAt.value,
      bookingDate: occurredAt.calendarDate,
      amountMinor: amountMinor.value,
      category: category.value,
      note: note.value,
      merchant: merchant.value,
      needVsWant: needVsWant.value,
      paymentMethod,
      idempotencyKey: idempotencyKey.value as string,
    },
  };
}

/**
 * Validate a PATCH body. A positive expected `version` is required so a stale
 * writer can never silently overwrite a newer expense.
 */
export function parseUpdateExpenseInput(
  input: unknown,
): { ok: true; value: ExpenseUpdateValues } | ExpenseValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, UPDATE_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown field "${unknownKey}".`);
  }

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
    occurredAt?: string;
    bookingDate?: string;
    amountMinor?: number;
    category?: ExpenseCategory;
    note?: string | null;
    merchant?: string | null;
    needVsWant?: ExpenseNeedVsWant;
    paymentMethod?: ExpensePaymentMethod | null;
    purpose?: ExpensePurpose | null;
    countsInDaily?: boolean;
  } = {};

  if (input.occurredAt !== undefined) {
    const parsed = parseOccurredAt(input.occurredAt);
    if (!parsed.ok) return parsed;
    changes.occurredAt = parsed.value;
  }

  if (input.bookingDate !== undefined && input.occurredAt !== undefined) {
    return failure(
      "body",
      "Provide either occurredAt or bookingDate, not both: an instant already determines the booking day.",
    );
  }

  if (input.bookingDate !== undefined) {
    if (typeof input.bookingDate !== "string" || !isIsoDate(input.bookingDate.trim())) {
      return failure("bookingDate", "Booking date must be a valid YYYY-MM-DD date.");
    }
    changes.bookingDate = input.bookingDate.trim();
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
        isExpensePurpose,
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
    return failure("body", "At least one expense field must be provided.");
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

function parseOptionalIsoDate(
  raw: unknown,
  field: string,
): { ok: true; value: string | null } | ExpenseValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || !isIsoDate(raw.trim())) {
    return failure(field, `${field} must be a valid YYYY-MM-DD date.`);
  }
  return { ok: true, value: raw.trim() };
}

/**
 * Validate list pagination and resolve optional local-date boundaries into the
 * half-open UTC range `[startUtcIso, endUtcExclusiveIso)`. The timezone is the
 * caller's resolved owner time context (or an explicit IANA override), never a
 * global constant. A window needs an explicit/resolved timezone.
 */
export function parseExpenseListQuery(
  input: unknown,
  options: Readonly<{ timezone?: string | null }> = {},
): { ok: true; value: ExpenseListValues } | ExpenseValidationFailure {
  if (!isRecord(input)) {
    return failure("query", "Query must be an object.");
  }
  const unknownKey = findUnknownKey(input, LIST_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown query parameter "${unknownKey}".`);
  }

  const limit = parseIntegerQuery(
    input.limit,
    "limit",
    EXPENSE_LIST_DEFAULT_LIMIT,
    EXPENSE_LIST_MAX_LIMIT,
  );
  if (!limit.ok) return limit;
  if (limit.value < 1) {
    return failure("limit", "limit must be at least 1.");
  }

  const offset = parseIntegerQuery(
    input.offset,
    "offset",
    0,
    EXPENSE_LIST_MAX_OFFSET,
  );
  if (!offset.ok) return offset;

  const from = parseOptionalIsoDate(input.from, "from");
  if (!from.ok) return from;
  const to = parseOptionalIsoDate(input.to, "to");
  if (!to.ok) return to;

  const hasWindow = from.value !== null || to.value !== null;

  let timezone: string | null = null;
  if (input.timezone !== undefined && input.timezone !== null) {
    if (typeof input.timezone !== "string" || !input.timezone.trim()) {
      return failure("timezone", "Timezone must be a valid IANA timezone.");
    }
    timezone = input.timezone.trim();
  } else if (typeof options.timezone === "string" && options.timezone.trim()) {
    timezone = options.timezone.trim();
  }

  if (timezone !== null && !isValidIANATimeZone(timezone)) {
    return failure("timezone", "Timezone must be a valid IANA timezone.");
  }

  if (from.value && to.value) {
    if (from.value > to.value) {
      return failure("from", "The start date must be on or before the end date.");
    }
    const lastIncludedDay = addDaysToIsoDate(
      from.value,
      EXPENSE_LIST_MAX_WINDOW_DAYS - 1,
    );
    if (to.value > lastIncludedDay) {
      return failure(
        "to",
        `The date range must be ${EXPENSE_LIST_MAX_WINDOW_DAYS} days or fewer.`,
      );
    }
  }

  let startUtcIso: string | null = null;
  let endUtcExclusiveIso: string | null = null;
  const startBookingDate = from.value;
  const endBookingDateExclusive = to.value
    ? addDaysToIsoDate(to.value, 1)
    : null;

  if (hasWindow) {
    if (timezone === null) {
      return failure(
        "timezone",
        "Timezone is required to resolve local expense dates.",
      );
    }
    try {
      if (from.value) {
        startUtcIso = getLocalDayWindow(timezone, from.value).startUtcIso;
      }
      if (to.value) {
        endUtcExclusiveIso = getLocalDayWindow(timezone, to.value).endUtcIso;
      }
    } catch {
      return failure("from", "Unable to resolve the requested date range.");
    }
  }

  return {
    ok: true,
    value: {
      limit: limit.value,
      offset: offset.value,
      from: from.value,
      to: to.value,
      timezone,
      startUtcIso,
      endUtcExclusiveIso,
      startBookingDate,
      endBookingDateExclusive,
    },
  };
}

/**
 * Deterministic, platform-neutral canonical payload for the immutable original
 * create request. The application hashes this string before persistence, so a
 * retry is compared with the request that created the row, not with fields
 * that later edits may change, and the raw note/merchant are never duplicated
 * in the receipt column. JSON arrays keep a stable field order and epoch
 * milliseconds make equivalent `Z`/offset spellings equal.
 *
 * `bookingDate` is intentionally absent: it is derived deterministically from
 * `occurredAt` for the legacy expense path, and changing this payload would
 * invalidate every already-stored MONEY-01 idempotency receipt.
 */
export function canonicalExpenseCreatePayload(values: ExpenseCreateValues): string {
  return JSON.stringify([
    Date.parse(values.occurredAt),
    values.amountMinor,
    values.category,
    values.note,
    values.merchant,
    values.needVsWant,
    values.paymentMethod,
    values.idempotencyKey,
  ]);
}
