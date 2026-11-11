import {
  EXPENSE_AMOUNT_MINOR_MAX,
  type ExpenseCategory,
  type ExpenseCurrency,
  type ExpenseNeedVsWant,
  type ExpensePaymentMethod,
} from "./expenses";
import { isIsoDate, isValidIANATimeZone } from "./time-context";

/**
 * Canonical money ledger and period rules (MONEY-03).
 *
 * This module freezes the shared movement vocabulary from
 * `docs/plans/money-mcp-shared-contract.md` and owns the durable period rules:
 * inclusive date ranges, one tracking period, the single `opening` movement
 * kind, initialization/provenance honesty and date resolution. Money is always
 * a positive integer number of MAD centimes; the opening kind is the only kind
 * that may be zero.
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

function parseBoundedText(
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

  const evidence = parseBoundedText(
    raw.evidence,
    "opening.evidence",
    MONEY_OPENING_EVIDENCE_MAX_LENGTH,
    { required: raw.source === "verified_source" },
  );
  if (!evidence.ok) return evidence;

  const note = parseBoundedText(
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
