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
  getLocalDayWindow,
  getWeekWindow,
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

/* ------------------------------------------------------------------ */
/* MONEY-05: category taxonomy, period budget plan and coffee visits  */
/* ------------------------------------------------------------------ */

export const EXPENSE_REPORTING_GROUPS = [
  "food",
  "coffee",
  "transport",
  "bills",
  "daily_usage",
  "personal_care",
  "work_tools",
  "fun",
  "emergency",
  "health",
  "other",
] as const;
export type ExpenseReportingGroup = (typeof EXPENSE_REPORTING_GROUPS)[number];

export const EXPENSE_REPORTING_GROUP_LABELS: Readonly<
  Record<ExpenseReportingGroup, string>
> = {
  food: "Food",
  coffee: "Coffee",
  transport: "Transport",
  bills: "Bill",
  daily_usage: "Daily usage",
  personal_care: "Personal care",
  work_tools: "Work/tools",
  fun: "Fun",
  emergency: "Emergency",
  health: "Health",
  other: "Other",
};

/**
 * Every existing and appended category maps to exactly one distinguishable
 * reporting group. Adding a category without extending this record fails the
 * typecheck instead of silently collapsing the detail into "other".
 */
export const EXPENSE_CATEGORY_REPORTING_GROUP: Readonly<
  Record<ExpenseCategory, ExpenseReportingGroup>
> = {
  coffee: "coffee",
  groceries: "food",
  eating_out: "food",
  transport: "transport",
  bills: "bills",
  subscriptions: "bills",
  household: "daily_usage",
  health: "health",
  other: "other",
  daily_usage: "daily_usage",
  personal_care: "personal_care",
  work_tools: "work_tools",
  fun: "fun",
  emergency: "emergency",
};

export const EXPENSE_CATEGORY_LABELS: Readonly<Record<ExpenseCategory, string>> = {
  coffee: "Coffee",
  groceries: "Groceries",
  eating_out: "Eating out",
  transport: "Transport",
  bills: "Bills",
  subscriptions: "Subscriptions",
  household: "Household",
  health: "Health",
  other: "Other",
  daily_usage: "Daily usage",
  personal_care: "Personal care",
  work_tools: "Work/tools",
  fun: "Fun",
  emergency: "Emergency",
};

export type ExpenseCategoryDescription = Readonly<{
  category: ExpenseCategory;
  label: string;
  reportingGroup: ExpenseReportingGroup;
  reportingGroupLabel: string;
}>;

export function describeExpenseCategory(
  category: ExpenseCategory,
): ExpenseCategoryDescription {
  const reportingGroup = EXPENSE_CATEGORY_REPORTING_GROUP[category];
  return {
    category,
    label: EXPENSE_CATEGORY_LABELS[category],
    reportingGroup,
    reportingGroupLabel: EXPENSE_REPORTING_GROUP_LABELS[reportingGroup],
  };
}

export const MONEY_HANDOFF_SOURCE_LABELS = [
  "Start",
  "Transport",
  "Food",
  "Daily usage",
  "Coffee",
  "Bill",
  "Income",
  "Saving",
  "Personal care",
  "Work/tools",
  "Fun",
  "Emergency",
  "Other",
] as const;
export type MoneyHandoffSourceLabel = (typeof MONEY_HANDOFF_SOURCE_LABELS)[number];

export type MoneyHandoffMeaning =
  | "opening"
  | "income"
  | "savings_transfer"
  | "expense";

export type MoneyHandoffMapping = Readonly<{
  sourceLabel: MoneyHandoffSourceLabel;
  meaning: MoneyHandoffMeaning;
  /** Canonical expense category when the source label is an expense. */
  category: ExpenseCategory | null;
  reportingGroup: ExpenseReportingGroup | null;
  purpose: MoneyPurpose | null;
  countsInDailyDefault: boolean;
  note: string;
}>;

/**
 * One explicit published mapping for the handoff labels. Movement kinds own
 * the non-expense meanings; expense labels keep a distinct reporting group so
 * unsupported source labels never collapse into an indistinguishable "other".
 */
export const MONEY_HANDOFF_CATEGORY_MAPPING: readonly MoneyHandoffMapping[] = [
  {
    sourceLabel: "Start",
    meaning: "opening",
    category: null,
    reportingGroup: null,
    purpose: null,
    countsInDailyDefault: false,
    note: "Canonical opening movement, represented once per owner/period.",
  },
  {
    sourceLabel: "Transport",
    meaning: "expense",
    category: "transport",
    reportingGroup: "transport",
    purpose: null,
    countsInDailyDefault: true,
    note: "Existing transport expense category.",
  },
  {
    sourceLabel: "Food",
    meaning: "expense",
    category: "groceries",
    reportingGroup: "food",
    purpose: null,
    countsInDailyDefault: true,
    note: "Groceries by default; eating_out only when the source establishes it.",
  },
  {
    sourceLabel: "Daily usage",
    meaning: "expense",
    category: "daily_usage",
    reportingGroup: "daily_usage",
    purpose: null,
    countsInDailyDefault: true,
    note: "Household/consumables with a distinct daily_usage reporting group.",
  },
  {
    sourceLabel: "Coffee",
    meaning: "expense",
    category: "coffee",
    reportingGroup: "coffee",
    purpose: null,
    countsInDailyDefault: true,
    note: "Coffee expense plus explicit counted visit metadata; no second cash effect.",
  },
  {
    sourceLabel: "Bill",
    meaning: "expense",
    category: "bills",
    reportingGroup: "bills",
    purpose: "fixed",
    countsInDailyDefault: false,
    note: "Bills or subscriptions from known obligation kind; fixed purpose by default.",
  },
  {
    sourceLabel: "Income",
    meaning: "income",
    category: null,
    reportingGroup: null,
    purpose: null,
    countsInDailyDefault: false,
    note: "Received income movement; never an expense with a negated amount.",
  },
  {
    sourceLabel: "Saving",
    meaning: "savings_transfer",
    category: null,
    reportingGroup: null,
    purpose: null,
    countsInDailyDefault: false,
    note: "Actual savings transfer movement when supported by source.",
  },
  {
    sourceLabel: "Personal care",
    meaning: "expense",
    category: "personal_care",
    reportingGroup: "personal_care",
    purpose: null,
    countsInDailyDefault: true,
    note: "Distinct personal_care reporting group.",
  },
  {
    sourceLabel: "Work/tools",
    meaning: "expense",
    category: "work_tools",
    reportingGroup: "work_tools",
    purpose: null,
    countsInDailyDefault: true,
    note: "Distinct work_tools reporting group.",
  },
  {
    sourceLabel: "Fun",
    meaning: "expense",
    category: "fun",
    reportingGroup: "fun",
    purpose: null,
    countsInDailyDefault: true,
    note: "Distinct fun reporting group.",
  },
  {
    sourceLabel: "Emergency",
    meaning: "expense",
    category: "emergency",
    reportingGroup: "emergency",
    purpose: "emergency",
    countsInDailyDefault: true,
    note: "Emergency purpose, never an invented need/want; daily true by default.",
  },
  {
    sourceLabel: "Other",
    meaning: "expense",
    category: "other",
    reportingGroup: "other",
    purpose: null,
    countsInDailyDefault: true,
    note: "Other expense preserving description and known need/want.",
  },
];

const HANDOFF_MAPPING_BY_LABEL = new Map<string, MoneyHandoffMapping>(
  MONEY_HANDOFF_CATEGORY_MAPPING.map((mapping) => [mapping.sourceLabel, mapping]),
);

export type MoneyHandoffResolution =
  | Readonly<{ known: true; mapping: MoneyHandoffMapping }>
  | Readonly<{
      known: false;
      /** Original source label preserved so unsupported detail is not lost. */
      preservedSourceLabel: string;
      fallbackCategory: "other";
      fallbackReportingGroup: "other";
    }>;

/**
 * Resolve a handoff source label without inventing a category. An unrecognised
 * label keeps its original text and falls back to `other` with an explicit
 * `known: false` marker, so reports can show what was actually imported.
 */
export function resolveHandoffSourceLabel(label: string): MoneyHandoffResolution {
  const trimmed = label.trim();
  const mapping = HANDOFF_MAPPING_BY_LABEL.get(trimmed);
  if (mapping) return { known: true, mapping };
  return {
    known: false,
    preservedSourceLabel: trimmed,
    fallbackCategory: "other",
    fallbackReportingGroup: "other",
  };
}

export function isExpenseReportingGroup(
  value: unknown,
): value is ExpenseReportingGroup {
  return (
    typeof value === "string" &&
    (EXPENSE_REPORTING_GROUPS as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------------ */
/* Period budget plan                                                 */
/* ------------------------------------------------------------------ */

/** PostgreSQL int4 upper bound for an allocation/target amount. */
export const MONEY_BUDGET_AMOUNT_MAX = 2_147_483_647;
export const MONEY_BUDGET_PERIOD_LABEL = "Period budget allocation";
export const MONEY_ADVISORY_CAP_LABEL = "Advisory monthly category cap";

export type MoneyBudgetAllocations = Partial<Record<ExpenseCategory, number>>;

/**
 * A budget plan belongs to exactly one canonical `money_periods` row. The
 * period id is the durable identity; the dates are its read-only projection so
 * a client never edits period boundaries through the budget surface.
 */
export type MoneyBudgetPlan = Readonly<{
  id: string;
  periodId: string;
  periodStartDate: string;
  periodEndDate: string;
  currency: MoneyCurrency;
  allocations: MoneyBudgetAllocations;
  savingsTargetMinor: number | null;
  emergencyTargetMinor: number | null;
  coffeeWeeklySpendLimitMinor: number | null;
  coffeeWeeklyVisitLimit: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type MoneyBudgetPlanValues = Readonly<{
  periodId: string;
  periodStartDate: string;
  periodEndDate: string;
  allocations: MoneyBudgetAllocations;
  savingsTargetMinor: number | null;
  emergencyTargetMinor: number | null;
  coffeeWeeklySpendLimitMinor: number | null;
  coffeeWeeklyVisitLimit: number | null;
}>;

export type MoneyBudgetPlanSaveValues = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
  allocations: MoneyBudgetAllocations;
  savingsTargetMinor: number | null;
  emergencyTargetMinor: number | null;
  coffeeWeeklySpendLimitMinor: number | null;
  coffeeWeeklyVisitLimit: number | null;
  expectedVersion: number;
}>;

export type MoneyBudgetPatchValues = Readonly<{
  periodStartDate: string;
  periodEndDate: string;
  allocations?: Partial<Record<ExpenseCategory, number | null>>;
  savingsTargetMinor?: number | null;
  emergencyTargetMinor?: number | null;
  coffeeWeeklySpendLimitMinor?: number | null;
  coffeeWeeklyVisitLimit?: number | null;
  expectedVersion: number;
}>;

const BUDGET_PERIOD_KEYS = new Set(["periodStartDate", "periodEndDate"]);

/** Validate the period identity used to read or patch one plan. */
export function parseMoneyBudgetPeriodInput(
  input: unknown,
): { ok: true; value: { periodStartDate: string; periodEndDate: string } } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("query", "Period must be an object.");
  const unknownKey = findUnknownKey(input, BUDGET_PERIOD_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);
  const period = parsePeriodDates(input.periodStartDate, input.periodEndDate);
  if (!period.ok) return period;
  return {
    ok: true,
    value: { periodStartDate: period.startDate, periodEndDate: period.endDate },
  };
}

export function isMoneyBudgetAmountMinor(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MONEY_BUDGET_AMOUNT_MAX
  );
}

function parseBudgetOptionalAmount(
  raw: unknown,
  field: string,
): { ok: true; value: number | null } | MoneyValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isMoneyBudgetAmountMinor(raw)) {
    return failure(field, "Use a whole non-negative amount of MAD centimes.");
  }
  return { ok: true, value: raw };
}

function parsePeriodDates(
  start: unknown,
  end: unknown,
): { ok: true; startDate: string; endDate: string } | MoneyValidationFailure {
  if (typeof start !== "string" || !isIsoDate(start.trim())) {
    return failure("periodStartDate", "Use a valid YYYY-MM-DD start date.");
  }
  if (typeof end !== "string" || !isIsoDate(end.trim())) {
    return failure("periodEndDate", "Use a valid YYYY-MM-DD end date.");
  }
  const startDate = start.trim();
  const endDate = end.trim();
  if (startDate > endDate) {
    return failure("periodStartDate", "The period start must be on or before its end.");
  }
  return { ok: true, startDate, endDate };
}

function parseBudgetExpectedVersion(
  raw: unknown,
): { ok: true; value: number } | MoneyValidationFailure {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 0 ||
    raw > MONEY_BUDGET_AMOUNT_MAX
  ) {
    return failure(
      "version",
      "Provide the current plan version (0 when creating the first plan).",
    );
  }
  return { ok: true, value: raw };
}

function parseAllocations(
  raw: unknown,
  options: Readonly<{ allowNullValues: boolean }>,
): { ok: true; value: MoneyBudgetAllocations } | MoneyValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) {
    return failure("allocations", "Allocations must be an object of categories.");
  }
  const allocations: Record<string, number | null> = {};
  for (const [category, amount] of Object.entries(raw)) {
    if (!isExpenseCategory(category)) {
      return failure("allocations", `Unsupported category "${category}".`);
    }
    if (amount === null && options.allowNullValues) {
      allocations[category] = null;
      continue;
    }
    if (!isMoneyBudgetAmountMinor(amount)) {
      return failure(
        "allocations",
        "Each allocation must be a whole non-negative amount of MAD centimes.",
      );
    }
    allocations[category] = amount;
  }
  return { ok: true, value: allocations as MoneyBudgetAllocations };
}

const BUDGET_SAVE_KEYS = new Set([
  "periodStartDate",
  "periodEndDate",
  "allocations",
  "savingsTargetMinor",
  "emergencyTargetMinor",
  "coffeeWeeklySpendLimitMinor",
  "coffeeWeeklyVisitLimit",
  "version",
]);

const BUDGET_PATCH_KEYS = BUDGET_SAVE_KEYS;

function parseVisitLimit(
  raw: unknown,
  field: string,
): { ok: true; value: number | null } | MoneyValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 0 ||
    raw > MONEY_BUDGET_AMOUNT_MAX
  ) {
    return failure(field, "Use a whole non-negative visit limit.");
  }
  return { ok: true, value: raw };
}

/** Validate a full budget-plan save (web form). Absent limits mean "not set". */
export function parseMoneyBudgetPlanSaveInput(
  input: unknown,
): { ok: true; value: MoneyBudgetPlanSaveValues } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("body", "Request body must be an object.");
  const unknownKey = findUnknownKey(input, BUDGET_SAVE_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);

  const period = parsePeriodDates(input.periodStartDate, input.periodEndDate);
  if (!period.ok) return period;
  const version = parseBudgetExpectedVersion(input.version);
  if (!version.ok) return version;
  // A full save replaces the allocation set. An omitted/null field must not
  // silently clear every stored allocation; the wire contract requires it.
  if (!isRecord(input.allocations)) {
    return failure("allocations", "Allocations must be an object of categories.");
  }
  const allocations = parseAllocations(input.allocations, { allowNullValues: false });
  if (!allocations.ok) return allocations;
  const savings = parseBudgetOptionalAmount(input.savingsTargetMinor, "savingsTargetMinor");
  if (!savings.ok) return savings;
  const emergency = parseBudgetOptionalAmount(
    input.emergencyTargetMinor,
    "emergencyTargetMinor",
  );
  if (!emergency.ok) return emergency;
  const coffeeSpend = parseBudgetOptionalAmount(
    input.coffeeWeeklySpendLimitMinor,
    "coffeeWeeklySpendLimitMinor",
  );
  if (!coffeeSpend.ok) return coffeeSpend;
  const coffeeVisits = parseVisitLimit(
    input.coffeeWeeklyVisitLimit,
    "coffeeWeeklyVisitLimit",
  );
  if (!coffeeVisits.ok) return coffeeVisits;

  return {
    ok: true,
    value: {
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      allocations: allocations.value,
      savingsTargetMinor: savings.value,
      emergencyTargetMinor: emergency.value,
      coffeeWeeklySpendLimitMinor: coffeeSpend.value,
      coffeeWeeklyVisitLimit: coffeeVisits.value,
      expectedVersion: version.value,
    },
  };
}

/**
 * Validate a partial allocation/target edit. Absent fields are unchanged;
 * explicit `null` clears an allocation or target. At least one field must be
 * present so an accidental empty write cannot bump the version.
 */
export function parseMoneyBudgetPatchInput(
  input: unknown,
): { ok: true; value: MoneyBudgetPatchValues } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("body", "Request body must be an object.");
  const unknownKey = findUnknownKey(input, BUDGET_PATCH_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);

  const period = parsePeriodDates(input.periodStartDate, input.periodEndDate);
  if (!period.ok) return period;
  const version = parseBudgetExpectedVersion(input.version);
  if (!version.ok) return version;

  let hasChange = false;
  const value: {
    periodStartDate: string;
    periodEndDate: string;
    allocations?: Partial<Record<ExpenseCategory, number | null>>;
    savingsTargetMinor?: number | null;
    emergencyTargetMinor?: number | null;
    coffeeWeeklySpendLimitMinor?: number | null;
    coffeeWeeklyVisitLimit?: number | null;
    expectedVersion: number;
  } = {
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    expectedVersion: version.value,
  };

  if (input.allocations !== undefined) {
    const allocations = parseAllocations(input.allocations, { allowNullValues: true });
    if (!allocations.ok) return allocations;
    // An empty object changes no entry; do not advance the plan version for it.
    if (Object.keys(allocations.value).length > 0) {
      value.allocations = allocations.value;
      hasChange = true;
    }
  }
  if (input.savingsTargetMinor !== undefined) {
    const parsed = parseBudgetOptionalAmount(
      input.savingsTargetMinor,
      "savingsTargetMinor",
    );
    if (!parsed.ok) return parsed;
    value.savingsTargetMinor = parsed.value;
    hasChange = true;
  }
  if (input.emergencyTargetMinor !== undefined) {
    const parsed = parseBudgetOptionalAmount(
      input.emergencyTargetMinor,
      "emergencyTargetMinor",
    );
    if (!parsed.ok) return parsed;
    value.emergencyTargetMinor = parsed.value;
    hasChange = true;
  }
  if (input.coffeeWeeklySpendLimitMinor !== undefined) {
    const parsed = parseBudgetOptionalAmount(
      input.coffeeWeeklySpendLimitMinor,
      "coffeeWeeklySpendLimitMinor",
    );
    if (!parsed.ok) return parsed;
    value.coffeeWeeklySpendLimitMinor = parsed.value;
    hasChange = true;
  }
  if (input.coffeeWeeklyVisitLimit !== undefined) {
    const parsed = parseVisitLimit(
      input.coffeeWeeklyVisitLimit,
      "coffeeWeeklyVisitLimit",
    );
    if (!parsed.ok) return parsed;
    value.coffeeWeeklyVisitLimit = parsed.value;
    hasChange = true;
  }

  if (!hasChange) {
    return failure("body", "Provide at least one allocation or target to change.");
  }
  return { ok: true, value };
}

export type CategoryBudgetPrecedence = Readonly<{
  category: ExpenseCategory;
  /** Editable period plan value; `null` means the period plan does not set it. */
  allocationMinor: number | null;
  /** Advisory monthly cap; `null` means no cap is configured. */
  advisoryCapMinor: number | null;
  /** The single target a report may compare spending against. */
  targetMinor: number | null;
  targetSource: "period_allocation" | "advisory_cap" | "none";
  allocationLabel: string;
  advisoryCapLabel: string;
  /**
   * Never auto-write one owner from the other. A period allocation takes
   * precedence for plan consumption while the advisory cap stays visible.
   */
  precedence: "period_allocation_over_advisory_cap";
}>;

export function resolveCategoryBudgetPrecedence(
  category: ExpenseCategory,
  allocationMinor: number | null,
  advisoryCapMinor: number | null,
): CategoryBudgetPrecedence {
  if (allocationMinor !== null) {
    return {
      category,
      allocationMinor,
      advisoryCapMinor,
      targetMinor: allocationMinor,
      targetSource: "period_allocation",
      allocationLabel: MONEY_BUDGET_PERIOD_LABEL,
      advisoryCapLabel: MONEY_ADVISORY_CAP_LABEL,
      precedence: "period_allocation_over_advisory_cap",
    };
  }
  if (advisoryCapMinor !== null) {
    return {
      category,
      allocationMinor: null,
      advisoryCapMinor,
      targetMinor: advisoryCapMinor,
      targetSource: "advisory_cap",
      allocationLabel: MONEY_BUDGET_PERIOD_LABEL,
      advisoryCapLabel: MONEY_ADVISORY_CAP_LABEL,
      precedence: "period_allocation_over_advisory_cap",
    };
  }
  return {
    category,
    allocationMinor: null,
    advisoryCapMinor: null,
    targetMinor: null,
    targetSource: "none",
    allocationLabel: MONEY_BUDGET_PERIOD_LABEL,
    advisoryCapLabel: MONEY_ADVISORY_CAP_LABEL,
    precedence: "period_allocation_over_advisory_cap",
  };
}

/* ------------------------------------------------------------------ */
/* Counted coffee visits                                              */
/* ------------------------------------------------------------------ */

export const MONEY_COFFEE_VISIT_MAX_EXPENSES = 50;
export const MONEY_COFFEE_VISIT_KEY_MAX_LENGTH = 128;
export const MONEY_COFFEE_NOTE_MAX_LENGTH = 500;

export type MoneyCoffeeVisit = Readonly<{
  id: string;
  visitKey: string;
  /** SHA-256 of the canonical visit payload; detects key reuse on retry. */
  visitFingerprint: string;
  localDate: string;
  timezone: string;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type MoneyCoffeeVisitLine = Readonly<{
  expenseId: string;
  amountMinor: number;
  category: string;
  /** Current canonical booking day; must match the visit day to count. */
  bookingDate: string;
  deletedAt: string | null;
}>;

export type MoneyCoffeeVisitRecord = MoneyCoffeeVisit &
  Readonly<{ lines: MoneyCoffeeVisitLine[] }>;

export type MoneyCoffeeVisitValues = Readonly<{
  visitKey: string;
  localDate: string;
  timezone: string;
  expenseIds: string[];
  note: string | null;
}>;

export function isMoneyCoffeeVisitKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MONEY_COFFEE_VISIT_KEY_MAX_LENGTH
  );
}

const COFFEE_VISIT_KEYS = new Set([
  "visitKey",
  "localDate",
  "timezone",
  "expenseIds",
  "note",
]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function parseCoffeeNote(
  raw: unknown,
): { ok: true; value: string | null } | MoneyValidationFailure {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return failure("note", "Note must be text.");
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (Array.from(trimmed).length > MONEY_COFFEE_NOTE_MAX_LENGTH) {
    return failure(
      "note",
      `Note must be ${MONEY_COFFEE_NOTE_MAX_LENGTH} characters or fewer.`,
    );
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate a counted visit. Every referenced expense is canonical spending;
 * the visit itself never creates a cash movement.
 */
export function parseMoneyCoffeeVisitInput(
  input: unknown,
): { ok: true; value: MoneyCoffeeVisitValues } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("body", "Request body must be an object.");
  const unknownKey = findUnknownKey(input, COFFEE_VISIT_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);

  if (!isMoneyCoffeeVisitKey(input.visitKey)) {
    return failure(
      "visitKey",
      `A stable visit key of ${MONEY_COFFEE_VISIT_KEY_MAX_LENGTH} characters or fewer is required.`,
    );
  }
  if (typeof input.localDate !== "string" || !isIsoDate(input.localDate.trim())) {
    return failure("localDate", "Use the owner-local visit date (YYYY-MM-DD).");
  }
  if (
    typeof input.timezone !== "string" ||
    !isValidIANATimeZone(input.timezone.trim())
  ) {
    return failure("timezone", "Use a valid IANA timezone for the visit date.");
  }
  if (
    !Array.isArray(input.expenseIds) ||
    input.expenseIds.length < 1 ||
    input.expenseIds.length > MONEY_COFFEE_VISIT_MAX_EXPENSES
  ) {
    return failure(
      "expenseIds",
      `Provide between 1 and ${MONEY_COFFEE_VISIT_MAX_EXPENSES} canonical expenses.`,
    );
  }
  const expenseIds: string[] = [];
  for (const rawId of input.expenseIds) {
    if (!isUuid(rawId)) {
      return failure("expenseIds", "Every expense id must be a UUID.");
    }
    const normalized = rawId.toLowerCase();
    if (!expenseIds.includes(normalized)) expenseIds.push(normalized);
  }
  const note = parseCoffeeNote(input.note);
  if (!note.ok) return note;

  return {
    ok: true,
    value: {
      visitKey: (input.visitKey as string).trim(),
      localDate: (input.localDate as string).trim(),
      timezone: (input.timezone as string).trim(),
      expenseIds,
      note: note.value,
    },
  };
}

/**
 * Deterministic replay identity for a counted visit. Expense ids are sorted so
 * a retry with the same lines in another order is still the same visit.
 */
export function canonicalCoffeeVisitPayload(values: MoneyCoffeeVisitValues): string {
  return JSON.stringify([
    values.visitKey,
    values.localDate,
    values.timezone,
    [...values.expenseIds].sort(),
    values.note,
  ]);
}

export type CoffeeWeekWindow = Readonly<{
  localDate: string;
  timezone: string;
  periodStartDate: string;
  periodEndDate: string;
  weekStart: string;
  weekEnd: string;
  startUtcIso: string;
  endUtcExclusiveIso: string;
  clippedToPeriod: boolean;
}>;

/**
 * Owner-local ISO week (Monday–Sunday) clipped to the selected period. A
 * partial first/last week reports only its in-period days and says so.
 */
export function getCoffeeWeekWindow(input: Readonly<{
  localDate: string;
  timezone: string;
  periodStartDate: string;
  periodEndDate: string;
}>): CoffeeWeekWindow {
  const period = parsePeriodDates(input.periodStartDate, input.periodEndDate);
  if (!period.ok) throw new Error(period.message);
  if (!isIsoDate(input.localDate)) throw new Error("Invalid local date.");
  if (!isValidIANATimeZone(input.timezone)) throw new Error("Invalid timezone.");
  if (input.localDate < period.startDate || input.localDate > period.endDate) {
    throw new Error("The selected date is outside the period.");
  }

  const week = getWeekWindow(input.timezone, input.localDate);
  const weekStart = week.weekStart > period.startDate ? week.weekStart : period.startDate;
  const weekEnd = week.weekEnd < period.endDate ? week.weekEnd : period.endDate;
  if (weekStart > weekEnd) {
    throw new Error("The selected date is outside the period.");
  }
  return {
    localDate: input.localDate,
    timezone: input.timezone,
    periodStartDate: period.startDate,
    periodEndDate: period.endDate,
    weekStart,
    weekEnd,
    startUtcIso: getLocalDayWindow(input.timezone, weekStart).startUtcIso,
    endUtcExclusiveIso: getLocalDayWindow(input.timezone, weekEnd).endUtcIso,
    clippedToPeriod:
      weekStart !== week.weekStart || weekEnd !== week.weekEnd,
  };
}

export type CoffeeWindowSummary = Readonly<{
  currency: MoneyCurrency;
  weekStart: string;
  weekEnd: string;
  clippedToPeriod: boolean;
  /** True when the bounded visit scan hit its cap; counts are lower bounds. */
  truncated: boolean;
  /** Distinct counted values: visits vs money vs category projection. */
  countedVisitCount: number;
  countedVisitSpendMinor: number;
  categoryCoffeeSpendMinor: number;
  /** Category-coffee spending not linked to a counted visit. */
  uncountedCategoryCoffeeSpendMinor: number;
  spendLimitMinor: number | null;
  visitLimit: number | null;
  remainingSpendMinor: number | null;
  spendOvershootMinor: number | null;
  remainingVisits: number | null;
  visitOvershoot: number | null;
  /** Reason the counted and category projections can differ. */
  projectionNote: string;
}>;

export function summarizeCoffeeWindow(input: Readonly<{
  window: CoffeeWeekWindow;
  truncated: boolean;
  countedVisitCount: number;
  countedVisitSpendMinor: number;
  categoryCoffeeSpendMinor: number;
  spendLimitMinor: number | null;
  visitLimit: number | null;
}>): CoffeeWindowSummary {
  const spendLimit = input.spendLimitMinor;
  const visitLimit = input.visitLimit;
  const remainingSpend =
    spendLimit === null
      ? null
      : Math.max(0, spendLimit - input.countedVisitSpendMinor);
  const spendOvershoot =
    spendLimit === null
      ? null
      : Math.max(0, input.countedVisitSpendMinor - spendLimit);
  const remainingVisits =
    visitLimit === null ? null : Math.max(0, visitLimit - input.countedVisitCount);
  const visitOvershoot =
    visitLimit === null ? null : Math.max(0, input.countedVisitCount - visitLimit);
  return {
    currency: MONEY_CURRENCY,
    weekStart: input.window.weekStart,
    weekEnd: input.window.weekEnd,
    clippedToPeriod: input.window.clippedToPeriod,
    truncated: input.truncated,
    countedVisitCount: input.countedVisitCount,
    countedVisitSpendMinor: input.countedVisitSpendMinor,
    categoryCoffeeSpendMinor: input.categoryCoffeeSpendMinor,
    uncountedCategoryCoffeeSpendMinor: Math.max(
      0,
      input.categoryCoffeeSpendMinor - input.countedVisitSpendMinor,
    ),
    spendLimitMinor: spendLimit,
    visitLimit,
    remainingSpendMinor: remainingSpend,
    spendOvershootMinor: spendOvershoot,
    remainingVisits,
    visitOvershoot,
    projectionNote:
      "Counted coffee uses amounts linked to counted visits. Category coffee is a separate projection and can include uncounted coffee purchases.",
  };
}

/* ------------------------------------------------------------------ */
/* Classification and coffee read inputs                              */
/* ------------------------------------------------------------------ */

export type MoneyExpenseClassificationValues = Readonly<{
  expenseId: string;
  expectedVersion: number;
  category: ExpenseCategory;
  note: string | null | undefined;
  needVsWant: ExpenseNeedVsWant | undefined;
}>;

const CLASSIFICATION_KEYS = new Set([
  "expenseId",
  "version",
  "category",
  "note",
  "needVsWant",
]);

/**
 * Validate an explicit category classification. This is an ordinary expense
 * update with version fencing; it never fabricates a new expense and never
 * creates a counted visit. A coffee purchase classified as groceries therefore
 * stays groceries and leaves counted coffee usage unchanged.
 */
export function parseMoneyExpenseClassificationInput(
  input: unknown,
): { ok: true; value: MoneyExpenseClassificationValues } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("body", "Request body must be an object.");
  const unknownKey = findUnknownKey(input, CLASSIFICATION_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);
  if (!isUuid(input.expenseId)) {
    return failure("expenseId", "A valid expense id is required.");
  }
  const version = parseBudgetExpectedVersion(input.version);
  if (!version.ok) return version;
  if (!isExpenseCategory(input.category)) {
    return failure("category", "Choose a supported category.");
  }
  let note: string | null | undefined;
  if (input.note !== undefined) {
    const parsed = parseCoffeeNote(input.note);
    if (!parsed.ok) return parsed;
    note = parsed.value;
  }
  let needVsWant: ExpenseNeedVsWant | undefined;
  if (input.needVsWant !== undefined) {
    if (input.needVsWant !== "need" && input.needVsWant !== "want") {
      return failure("needVsWant", "Choose need or want.");
    }
    needVsWant = input.needVsWant;
  }
  return {
    ok: true,
    value: {
      expenseId: input.expenseId.toLowerCase(),
      expectedVersion: version.value,
      category: input.category,
      note,
      needVsWant,
    },
  };
}

export type MoneyCoffeeWindowValues = Readonly<{
  localDate: string;
  timezone: string;
  periodStartDate: string;
  periodEndDate: string;
  spendLimitMinor: number | null;
  visitLimit: number | null;
}>;

const COFFEE_WINDOW_KEYS = new Set([
  "localDate",
  "timezone",
  "periodStartDate",
  "periodEndDate",
  "spendLimitMinor",
  "visitLimit",
]);

export function parseMoneyCoffeeWindowInput(
  input: unknown,
): { ok: true; value: MoneyCoffeeWindowValues } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("query", "Query must be an object.");
  const unknownKey = findUnknownKey(input, COFFEE_WINDOW_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);
  if (typeof input.localDate !== "string" || !isIsoDate(input.localDate.trim())) {
    return failure("localDate", "Use the owner-local date (YYYY-MM-DD).");
  }
  if (
    typeof input.timezone !== "string" ||
    !isValidIANATimeZone(input.timezone.trim())
  ) {
    return failure("timezone", "Use a valid IANA timezone.");
  }
  const period = parsePeriodDates(input.periodStartDate, input.periodEndDate);
  if (!period.ok) return period;
  const spendLimit = parseBudgetOptionalAmount(
    input.spendLimitMinor,
    "spendLimitMinor",
  );
  if (!spendLimit.ok) return spendLimit;
  const visitLimit = parseVisitLimit(input.visitLimit, "visitLimit");
  if (!visitLimit.ok) return visitLimit;
  return {
    ok: true,
    value: {
      localDate: input.localDate.trim(),
      timezone: input.timezone.trim(),
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      spendLimitMinor: spendLimit.value,
      visitLimit: visitLimit.value,
    },
  };
}

export type MoneyCoffeeVisitListValues = Readonly<{
  from: string;
  to: string;
  limit: number;
  offset: number;
}>;

export const MONEY_COFFEE_LIST_DEFAULT_LIMIT = 50;
export const MONEY_COFFEE_LIST_MAX_LIMIT = 200;

const COFFEE_LIST_KEYS = new Set(["from", "to", "limit", "offset"]);

/** Query strings are canonical integers at the HTTP boundary; MCP sends numbers. */
function parseCoffeeListInteger(
  raw: unknown,
  field: string,
  min: number,
  max: number,
): { ok: true; value: number } | MoneyValidationFailure {
  let parsed: number;
  if (typeof raw === "number" && Number.isInteger(raw)) {
    parsed = raw;
  } else if (typeof raw === "string" && /^(0|[1-9][0-9]*)$/.test(raw.trim())) {
    parsed = Number(raw.trim());
  } else {
    return failure(field, `${field} must be a whole number.`);
  }
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return failure(
      field,
      `${field} must be a whole number between ${min} and ${max}.`,
    );
  }
  return { ok: true, value: parsed };
}

export function parseMoneyCoffeeVisitListInput(
  input: unknown,
): { ok: true; value: MoneyCoffeeVisitListValues } | MoneyValidationFailure {
  if (!isRecord(input)) return failure("query", "Query must be an object.");
  const unknownKey = findUnknownKey(input, COFFEE_LIST_KEYS);
  if (unknownKey) return failure(unknownKey, `Unknown field "${unknownKey}".`);
  const period = parsePeriodDates(input.from, input.to);
  if (!period.ok) {
    return failure(
      "from",
      "Provide valid inclusive from/to owner-local visit dates.",
    );
  }
  const limitRaw = input.limit === undefined ? MONEY_COFFEE_LIST_DEFAULT_LIMIT : input.limit;
  const limit = parseCoffeeListInteger(limitRaw, "limit", 1, MONEY_COFFEE_LIST_MAX_LIMIT);
  if (!limit.ok) return limit;
  const offsetRaw = input.offset === undefined ? 0 : input.offset;
  const offset = parseCoffeeListInteger(
    offsetRaw,
    "offset",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (!offset.ok) return offset;
  return {
    ok: true,
    value: {
      from: period.startDate,
      to: period.endDate,
      limit: limit.value,
      offset: offset.value,
    },
  };
}
