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
  type ExpenseNeedVsWant,
  type ExpensePaymentMethod,
} from "./expenses";
import {
  addDaysToIsoDate,
  isIsoDate,
  isValidIANATimeZone,
} from "./time-context";

/**
 * Canonical money ledger and period rules (MONEY-03 + MONEY-04).
 *
 * This module freezes the shared movement vocabulary from
 * `docs/plans/money-mcp-shared-contract.md` and owns the durable money rules:
 * inclusive period ranges, one tracking period, the single `opening` movement
 * kind, initialization/provenance honesty, date resolution, and the movement
 * create/update/list/state parsers. Money is always a positive integer number
 * of MAD centimes; the opening kind is the only kind that may be zero.
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

export const MONEY_CURRENCY = "MAD" as const;
export type MoneyCurrency = typeof MONEY_CURRENCY;

/** Product default for Money when the owner has no stored IANA context. */
export const MONEY_DEFAULT_TIMEZONE = "Africa/Casablanca" as const;

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

export const MONEY_PERIOD_LIFECYCLES = [
  "tracking",
  "ended",
  "rolled_over",
] as const;
export type MoneyPeriodLifecycle = (typeof MONEY_PERIOD_LIFECYCLES)[number];

export const MONEY_PERIOD_INITIALIZATIONS = [
  "uninitialized",
  "initialized",
  "reconciled",
] as const;
export type MoneyPeriodInitialization =
  (typeof MONEY_PERIOD_INITIALIZATIONS)[number];

export const MONEY_OPENING_SOURCES = [
  "user_entered",
  "carry_forward",
  "verified_source",
] as const;
export type MoneyOpeningSource = (typeof MONEY_OPENING_SOURCES)[number];

export const MONEY_OPENING_AMOUNT_MIN = 0;
export const MONEY_PERIOD_MAX_DAYS = 366;
export const MONEY_SETTINGS_MAX_BYTES = 16_384;
export const MONEY_SETTINGS_MAX_DEPTH = 4;
export const MONEY_SETTINGS_MAX_KEYS = 100;
export const MONEY_OPENING_EVIDENCE_MAX_LENGTH = 500;
export const MONEY_OPENING_NOTE_MAX_LENGTH = 500;
export const MONEY_TIMEZONE_MAX_LENGTH = 128;

/** Persisted ledger shape from the frozen shared contract. */
export type MoneyLedgerRow = Readonly<{
  id: string;
  kind: MoneyKind;
  direction: MoneyDirection;
  amountMinor: number;
  currency: MoneyCurrency;
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

export type MoneyOpeningCorrection = Readonly<{
  at: string;
  amountMinor: number;
  previousAmountMinor: number;
  ledgerVersion: number;
  source: MoneyOpeningSource;
  note: string | null;
}>;

export type MoneyOpeningProvenance = Readonly<{
  source: MoneyOpeningSource;
  recordedAt: string;
  cutoffDate: string | null;
  evidence: string | null;
  note: string | null;
  corrections: readonly MoneyOpeningCorrection[];
}>;

export type MoneyPeriodProvenance = Readonly<{
  opening: MoneyOpeningProvenance | null;
  createdFrom: "web" | "mcp";
}>;

export type MoneyPeriodSettings = Readonly<Record<string, unknown>>;

export type MoneyPeriod = Readonly<{
  id: string;
  startDate: string;
  endDate: string;
  currency: MoneyCurrency;
  timezone: string;
  activeDate: string;
  lifecycle: MoneyPeriodLifecycle;
  initialization: MoneyPeriodInitialization;
  openingMovementId: string | null;
  provenance: MoneyPeriodProvenance;
  settings: MoneyPeriodSettings;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type MoneyOpening = Readonly<{
  id: string;
  amountMinor: number;
  currency: MoneyCurrency;
  bookingDate: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type MoneyOpeningInput = Readonly<{
  amountMinor: number;
  source: MoneyOpeningSource;
  cutoffDate: string | null;
  evidence: string | null;
  note: string | null;
}>;

export type MoneyPeriodCreateValues = Readonly<{
  startDate: string;
  endDate: string;
  timezone: string;
  activeDate: string;
  opening: MoneyOpeningInput | null;
  settings: MoneyPeriodSettings;
}>;

export type MoneyPeriodUpdateValues = Readonly<{
  expectedVersion: number;
  activeDate?: string;
  opening?: MoneyOpeningInput;
  settings?: MoneyPeriodSettings;
}>;

export type MoneyValidationFailure = Readonly<{
  ok: false;
  field: string;
  message: string;
}>;

export type MoneyDateRelation = "in_period" | "before_period" | "after_period";

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CREATE_KEYS = new Set([
  "startDate",
  "endDate",
  "timezone",
  "activeDate",
  "opening",
  "settings",
]);
const UPDATE_KEYS = new Set(["version", "activeDate", "opening", "settings"]);
const OPENING_KEYS = new Set([
  "amountMinor",
  "source",
  "cutoffDate",
  "evidence",
  "note",
]);
const FORBIDDEN_SETTING_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const MOVEMENT_CREATE_KEYS = new Set([
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

const MOVEMENT_UPDATE_KEYS = new Set([
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

function failure(field: string, message: string): MoneyValidationFailure {
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
  return (
    typeof value === "string" &&
    (MONEY_KINDS as readonly string[]).includes(value)
  );
}

export function isMoneyDirection(value: unknown): value is MoneyDirection {
  return value === "in" || value === "out";
}

export function isMoneyPurpose(value: unknown): value is MoneyPurpose {
  return value === "fixed" || value === "flexible" || value === "emergency";
}

export function isMoneyPeriodLifecycle(
  value: unknown,
): value is MoneyPeriodLifecycle {
  return (
    typeof value === "string" &&
    (MONEY_PERIOD_LIFECYCLES as readonly string[]).includes(value)
  );
}

export function isMoneyPeriodInitialization(
  value: unknown,
): value is MoneyPeriodInitialization {
  return (
    typeof value === "string" &&
    (MONEY_PERIOD_INITIALIZATIONS as readonly string[]).includes(value)
  );
}

export function isMoneyOpeningSource(
  value: unknown,
): value is MoneyOpeningSource {
  return (
    typeof value === "string" &&
    (MONEY_OPENING_SOURCES as readonly string[]).includes(value)
  );
}

export function isMoneyPeriodId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Opening zero is valid; every other kind amount must be positive. */
export function isMoneyAmountMinor(
  value: unknown,
  options: Readonly<{ allowZero: boolean }>,
): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  if (value > EXPENSE_AMOUNT_MINOR_MAX) return false;
  return options.allowZero ? value >= 0 : value >= 1;
}

/**
 * Product defaults from the frozen shared contract. MONEY-07 defines the
 * fixed-payment default; this module treats every recorded expense
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

function parseBoundedMovementText(
  raw: unknown,
  field: string,
  maxLength: number,
  options: Readonly<{ required: boolean }>,
): { ok: true; value: string | null } | MoneyValidationFailure {
  if (raw === undefined || raw === null) {
    return options.required ? failure(field, "This value is required.") : { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return failure(field, "This value must be text.");
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
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

function parseOptionalIsoDate(
  raw: unknown,
  field: string,
): { ok: true; value: string | null } | MoneyValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || !isIsoDate(raw.trim())) {
    return failure(field, `${field} must be a valid YYYY-MM-DD date.`);
  }
  return { ok: true, value: raw.trim() };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function isValidSettingsValue(value: unknown, depth: number): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (depth >= MONEY_SETTINGS_MAX_DEPTH) return false;
    return value.every((item) => isValidSettingsValue(item, depth + 1));
  }
  if (isRecord(value)) {
    if (depth >= MONEY_SETTINGS_MAX_DEPTH) return false;
    const keys = Object.keys(value);
    if (keys.length > MONEY_SETTINGS_MAX_KEYS) return false;
    for (const key of keys) {
      if (key.length === 0 || key.length > 128) return false;
      if (FORBIDDEN_SETTING_KEYS.has(key)) return false;
      if (!isValidSettingsValue(value[key], depth + 1)) return false;
    }
    return true;
  }
  return false;
}

/**
 * Period settings are a bounded JSON object. They are historical policy state,
 * so changing today's targets never rewrites a stored period's settings.
 */
export function parseMoneySettings(
  raw: unknown,
): { ok: true; value: MoneyPeriodSettings } | MoneyValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) {
    return failure("settings", "Settings must be a JSON object.");
  }
  if (!isValidSettingsValue(raw, 0)) {
    return failure("settings", "Settings contain unsupported or oversized values.");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return failure("settings", "Settings must be JSON-serializable.");
  }
  if (utf8ByteLength(serialized) > MONEY_SETTINGS_MAX_BYTES) {
    return failure("settings", "Settings are too large.");
  }
  return { ok: true, value: JSON.parse(serialized) as MoneyPeriodSettings };
}

function parseOpening(
  raw: unknown,
): { ok: true; value: MoneyOpeningInput | null } | MoneyValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isRecord(raw)) {
    return failure("opening", "Opening must be a JSON object or omitted.");
  }
  const unknownKey = findUnknownKey(raw, OPENING_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown field "${unknownKey}".`);
  }

  if (!isMoneyAmountMinor(raw.amountMinor, { allowZero: true })) {
    return failure(
      "opening.amountMinor",
      "Opening cash must be a whole number of centimes, including zero.",
    );
  }
  if (!isMoneyOpeningSource(raw.source)) {
    return failure("opening.source", "Choose a supported opening source.");
  }

  const cutoffDate = parseOptionalIsoDate(raw.cutoffDate, "opening.cutoffDate");
  if (!cutoffDate.ok) return cutoffDate;

  const evidence = parseBoundedMovementText(
    raw.evidence,
    "opening.evidence",
    MONEY_OPENING_EVIDENCE_MAX_LENGTH,
    { required: raw.source === "verified_source" },
  );
  if (!evidence.ok) return evidence;

  const note = parseBoundedMovementText(
    raw.note,
    "opening.note",
    MONEY_OPENING_NOTE_MAX_LENGTH,
    { required: false },
  );
  if (!note.ok) return note;

  if (raw.source === "verified_source" && !cutoffDate.value) {
    return failure(
      "opening.cutoffDate",
      "A verified opening needs the cutoff date its evidence describes.",
    );
  }

  return {
    ok: true,
    value: {
      amountMinor: raw.amountMinor,
      source: raw.source,
      cutoffDate: cutoffDate.value,
      evidence: evidence.value,
      note: note.value,
    },
  };
}

/** An opening cutoff cannot describe the future of the period start. */
export function validateOpeningAgainstPeriod(
  opening: MoneyOpeningInput,
  startDate: string,
): MoneyValidationFailure | null {
  if (opening.cutoffDate && opening.cutoffDate > startDate) {
    return failure(
      "opening.cutoffDate",
      "The opening cutoff date must be on or before the period start date.",
    );
  }
  return null;
}

export function moneyTimezoneOrDefault(requested: string | null | undefined): string {
  const raw = typeof requested === "string" ? requested.trim() : "";
  return raw ? raw : MONEY_DEFAULT_TIMEZONE;
}

function resolveActiveDate(
  raw: unknown,
  startDate: string,
  endDate: string,
  today: string,
): { ok: true; value: string } | MoneyValidationFailure {
  if (raw === undefined || raw === null) {
    if (today >= startDate && today <= endDate) {
      return { ok: true, value: today };
    }
    return failure(
      "activeDate",
      `Today (${today}) is outside the period. Provide an explicit activeDate between ${startDate} and ${endDate}.`,
    );
  }
  const parsed = parseOptionalIsoDate(raw, "activeDate");
  if (!parsed.ok) return parsed;
  const value = parsed.value as string;
  if (value < startDate || value > endDate) {
    return failure(
      "activeDate",
      `The active date must be between ${startDate} and ${endDate}.`,
    );
  }
  return { ok: true, value };
}

/**
 * Validate a period create request. Boundaries are inclusive. A partial month
 * (for example 2026-11-09..2026-11-30) is valid; the active date defaults to
 * owner-local today only when today is inside the period.
 */
export function parseCreateMoneyPeriodInput(
  input: unknown,
  context: Readonly<{ today: string; timezone?: string | null }>,
): { ok: true; value: MoneyPeriodCreateValues } | MoneyValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, CREATE_KEYS);
  if (unknownKey) {
    return failure(unknownKey, `Unknown field "${unknownKey}".`);
  }

  if (typeof input.startDate !== "string" || !isIsoDate(input.startDate.trim())) {
    return failure("startDate", "The period start must be a valid YYYY-MM-DD date.");
  }
  if (typeof input.endDate !== "string" || !isIsoDate(input.endDate.trim())) {
    return failure("endDate", "The period end must be a valid YYYY-MM-DD date.");
  }
  const startDate = input.startDate.trim();
  const endDate = input.endDate.trim();
  if (startDate > endDate) {
    return failure("endDate", "The period start must be on or before its end.");
  }
  const spanDays =
    (Date.parse(`${endDate}T00:00:00.000Z`) -
      Date.parse(`${startDate}T00:00:00.000Z`)) /
      86_400_000 +
    1;
  if (spanDays > MONEY_PERIOD_MAX_DAYS) {
    return failure("endDate", `A period must be ${MONEY_PERIOD_MAX_DAYS} days or fewer.`);
  }

  let timezone = moneyTimezoneOrDefault(context.timezone);
  if (input.timezone !== undefined && input.timezone !== null) {
    if (typeof input.timezone !== "string" || !input.timezone.trim()) {
      return failure("timezone", "Timezone must be a valid IANA timezone.");
    }
    timezone = input.timezone.trim();
  }
  if (!isValidIANATimeZone(timezone)) {
    return failure("timezone", "Timezone must be a valid IANA timezone.");
  }

  const activeDate = resolveActiveDate(input.activeDate, startDate, endDate, context.today);
  if (!activeDate.ok) return activeDate;

  const opening = parseOpening(input.opening);
  if (!opening.ok) return opening;
  if (opening.value) {
    const cutoffFailure = validateOpeningAgainstPeriod(opening.value, startDate);
    if (cutoffFailure) return cutoffFailure;
  }

  const settings = parseMoneySettings(input.settings);
  if (!settings.ok) return settings;

  return {
    ok: true,
    value: {
      startDate,
      endDate,
      timezone,
      activeDate: activeDate.value,
      opening: opening.value,
      settings: settings.value,
    },
  };
}

/** Validate a settings/active-date/opening update. A positive version is required. */
export function parseUpdateMoneySettingsInput(
  input: unknown,
): { ok: true; value: MoneyPeriodUpdateValues } | MoneyValidationFailure {
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
    expectedVersion: number;
    activeDate?: string;
    opening?: MoneyOpeningInput;
    settings?: MoneyPeriodSettings;
  } = { expectedVersion: rawVersion };

  if (input.activeDate !== undefined) {
    if (input.activeDate === null) {
      return failure("activeDate", "activeDate must be a valid YYYY-MM-DD date.");
    }
    const parsed = parseOptionalIsoDate(input.activeDate, "activeDate");
    if (!parsed.ok) return parsed;
    changes.activeDate = parsed.value as string;
  }
  if (input.opening !== undefined) {
    const parsed = parseOpening(input.opening);
    if (!parsed.ok) return parsed;
    if (!parsed.value) {
      return failure(
        "opening",
        "Omit opening to keep it unchanged; an opening object is required to initialize or correct it.",
      );
    }
    changes.opening = parsed.value;
  }
  if (input.settings !== undefined) {
    const parsed = parseMoneySettings(input.settings);
    if (!parsed.ok) return parsed;
    changes.settings = parsed.value;
  }

  if (
    changes.activeDate === undefined &&
    changes.opening === undefined &&
    changes.settings === undefined
  ) {
    return failure("body", "Provide an active date, opening or settings change.");
  }

  return { ok: true, value: changes };
}

/** A tracking period is the only one accepting routine writes. */
export function periodAcceptsRoutineEntries(period: MoneyPeriod): boolean {
  return period.lifecycle === "tracking";
}

export function periodsOverlap(
  left: Readonly<{ startDate: string; endDate: string }>,
  right: Readonly<{ startDate: string; endDate: string }>,
): boolean {
  return left.startDate <= right.endDate && right.startDate <= left.endDate;
}

export function classifyDateInPeriod(
  date: string,
  period: Readonly<{ startDate: string; endDate: string }>,
): MoneyDateRelation {
  if (date < period.startDate) return "before_period";
  if (date > period.endDate) return "after_period";
  return "in_period";
}

function parseCountsInDaily(
  raw: unknown,
  fallback: boolean,
): { ok: true; value: boolean } | MoneyValidationFailure {
  if (raw === undefined) return { ok: true, value: fallback };
  if (typeof raw !== "boolean") {
    return failure("countsInDaily", "countsInDaily must be true or false.");
  }
  return { ok: true, value: raw };
}

function parseBookingDate(
  raw: unknown,
): { ok: true; value: string | null } | MoneyValidationFailure {
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
): { ok: true; value: MoneyCreateValues } | MoneyValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, MOVEMENT_CREATE_KEYS);
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
): { ok: true; value: MoneyUpdateValues } | MoneyValidationFailure {
  if (!isRecord(input)) {
    return failure("body", "Request body must be a JSON object.");
  }
  const unknownKey = findUnknownKey(input, MOVEMENT_UPDATE_KEYS);
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
): { ok: true; value: number } | MoneyValidationFailure {
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

function parseOptionalMovementKind(
  raw: unknown,
): { ok: true; value: MoneyKind | null } | MoneyValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isMoneyKind(raw)) {
    return failure("kind", "Choose a supported movement kind.");
  }
  return { ok: true, value: raw };
}

function parseTimezone(
  raw: unknown,
  fallback: string | null | undefined,
): { ok: true; value: string | null } | MoneyValidationFailure {
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
): { ok: true; value: MoneyListValues } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("query", "Query must be an object.");
  const unknownKey = findUnknownKey(input, LIST_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown query parameter "${unknownKey}".`);

  const limit = parseIntegerQuery(
    input.limit,
    "limit",
    EXPENSE_LIST_DEFAULT_LIMIT,
    EXPENSE_LIST_MAX_LIMIT,
  );
  if (!limit.ok) return limit;
  if (limit.value < 1) return failure("limit", "limit must be at least 1.");

  const offset = parseIntegerQuery(input.offset, "offset", 0, EXPENSE_LIST_MAX_OFFSET);
  if (!offset.ok) return offset;

  const from = parseOptionalIsoDate(input.from, "from");
  if (!from.ok) return from;
  const to = parseOptionalIsoDate(input.to, "to");
  if (!to.ok) return to;
  const cutoff = parseOptionalIsoDate(input.cutoff, "cutoff");
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

  const kind = parseOptionalMovementKind(input.kind);
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
): { ok: true; value: MoneyStateValues } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("query", "Query must be an object.");
  const unknownKey = findUnknownKey(input, STATE_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown query parameter "${unknownKey}".`);

  const cutoff = parseOptionalIsoDate(input.cutoff, "cutoff");
  if (!cutoff.ok) return cutoff;

  const timezone = parseTimezone(input.timezone, options.timezone);
  if (!timezone.ok) return timezone;

  return { ok: true, value: { cutoff: cutoff.value, timezone: timezone.value } };
}

/**
 * Deterministic, platform-neutral canonical payload for opening create/correct
 * receipts. The application hashes it so raw evidence text is never duplicated
 * in a receipt column.
 */
export function canonicalMoneyOpeningPayload(
  opening: MoneyOpeningInput,
): string {
  return JSON.stringify([
    opening.amountMinor,
    opening.source,
    opening.cutoffDate,
    opening.evidence,
    opening.note,
  ]);
}

export function canonicalMoneyPeriodCreatePayload(
  values: MoneyPeriodCreateValues,
): string {
  return JSON.stringify([
    values.startDate,
    values.endDate,
    values.timezone,
    values.activeDate,
    values.opening ? canonicalMoneyOpeningPayload(values.opening) : null,
    values.settings,
  ]);
}

export function canonicalMoneyUpdatePayload(
  values: MoneyPeriodUpdateValues,
): string {
  return JSON.stringify([
    values.activeDate ?? null,
    values.opening ? canonicalMoneyOpeningPayload(values.opening) : null,
    values.settings ?? null,
  ]);
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
