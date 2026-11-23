import {
  EXPENSE_AMOUNT_MINOR_MAX,
  isExpenseCategory,
  isExpenseNeedVsWant,
  type ExpenseCategory,
  type ExpenseNeedVsWant,
} from "./expenses";
import type {
  MoneyDirection,
  MoneyKind,
  MoneyPurpose,
} from "./money";
import { isIsoDate, isValidIANATimeZone } from "./time-context";

/**
 * November workbook import and adoption rules (issue #433 / MONEY-13).
 *
 * This module is pure: it validates an owner-scoped workbook snapshot, turns
 * rows into an exact candidate manifest, and validates the explicit approval
 * that gates a write. It never reads a database, a clock, a network resource or
 * an environment variable. The application layer supplies the target read model
 * and the canonical money writers; data access owns the adoption receipt.
 *
 * Money remains a non-negative integer number of MAD centimes plus an explicit
 * direction. A signed effect is derived exactly once at this boundary.
 */

export const MONEY_IMPORT_VERSION = "money-001-november-v1" as const;

export const MONEY_IMPORT_CLASSIFICATIONS = [
  "opening",
  "income",
  "expense",
  "savings_transfer",
  "reconciliation_adjustment",
  "coffee_link",
  "bill_link",
  "settings_metadata",
  "derived",
  "unresolved",
] as const;
export type MoneyImportClassification =
  (typeof MONEY_IMPORT_CLASSIFICATIONS)[number];

export const MONEY_IMPORT_ACTIONS = [
  "insert",
  "link",
  "skip",
  "conflict",
] as const;
export type MoneyImportAction = (typeof MONEY_IMPORT_ACTIONS)[number];

export const MONEY_IMPORT_OPENING_STRATEGIES = [
  "verified_cutover_opening",
  "full_history",
] as const;
export type MoneyImportOpeningStrategy =
  (typeof MONEY_IMPORT_OPENING_STRATEGIES)[number];

export const MONEY_IMPORT_ADOPTION_STATUSES = [
  "applying",
  "adopted",
  "review_needed",
] as const;
export type MoneyImportAdoptionStatus =
  (typeof MONEY_IMPORT_ADOPTION_STATUSES)[number];

export const MONEY_IMPORT_SNAPSHOT_ID_MAX_LENGTH = 48;
export const MONEY_IMPORT_SOURCE_ROW_ID_MAX_LENGTH = 64;
export const MONEY_IMPORT_WORKBOOK_ID_MAX_LENGTH = 128;
export const MONEY_IMPORT_SOURCE_IDENTITY_MAX_LENGTH = 512;
export const MONEY_IMPORT_SHEET_MAX_LENGTH = 100;
export const MONEY_IMPORT_TEXT_MAX_LENGTH = 500;
export const MONEY_IMPORT_EVIDENCE_MAX_LENGTH = 500;
export const MONEY_IMPORT_MAX_ROWS = 10_000;

const STABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;

export type MoneyImportSourceRow = Readonly<{
  sourceRowId: string;
  sheet: string;
  rowIndex: number;
  raw: Readonly<Record<string, unknown>>;
}>;

export type MoneyImportSourceSnapshot = Readonly<{
  version: typeof MONEY_IMPORT_VERSION;
  snapshotId: string;
  workbookId: string;
  sourceIdentity: string;
  retrievedAt: string;
  extractionDate: string;
  month: string;
  timezone: string;
  currency: "MAD";
  rows: readonly MoneyImportSourceRow[];
  tabs: readonly string[];
}>;

export type MoneyImportCutover = Readonly<{
  date: string;
  reportedBalanceMinor: number;
  verified: boolean;
  evidenceRef: string;
  uncoveredDates: readonly string[];
}>;

export type MoneyImportTargetMovement = Readonly<{
  id: string;
  idempotencyKey: string;
  kind: MoneyKind;
  direction: MoneyDirection;
  amountMinor: number;
  category: ExpenseCategory | null;
  note: string | null;
  merchant: string | null;
  bookingDate: string;
  deletedAt: string | null;
}>;

export type MoneyImportTargetObligation = Readonly<{
  id: string;
  description: string;
  amountMinor: number;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  state: string;
  paymentExpenseId: string | null;
}>;

export type MoneyImportTargetCoffeeVisit = Readonly<{
  id: string;
  visitKey: string;
  localDate: string;
  expenseIds: readonly string[];
}>;

export type MoneyImportTarget = Readonly<{
  ownerId: string;
  environment: string;
  movements: readonly MoneyImportTargetMovement[];
  obligations: readonly MoneyImportTargetObligation[];
  coffeeVisits: readonly MoneyImportTargetCoffeeVisit[];
}>;

/** Exact owner-scoped target state the approved manifest was built from. */
export type MoneyImportTargetBaseline = Readonly<{
  movements: readonly Readonly<{
    id: string;
    idempotencyKey: string;
    kind: MoneyKind;
    direction: MoneyDirection;
    amountMinor: number;
    category: ExpenseCategory | null;
    note: string | null;
    merchant: string | null;
    bookingDate: string;
    deletedAt: string | null;
  }>[];
  obligations: readonly Readonly<{
    id: string;
    description: string;
    amountMinor: number;
    dueDate: string;
    state: string;
    paymentExpenseId: string | null;
  }>[];
  coffeeVisits: readonly Readonly<{
    visitKey: string;
    localDate: string;
    expenseIds: readonly string[];
  }>[];
}>;

export type MoneyImportTargetDrift =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reasons: readonly string[] }>;

export type MoneyImportClassificationProvenance = Readonly<{
  category: "source" | "default";
  needVsWant: "source" | "default";
  purpose: "source" | "default";
  countsInDaily: "source" | "default";
}>;

export type MoneyImportLinkEvidence = Readonly<{
  target: "source_row" | "movement" | "obligation";
  id: string;
  evidence:
    | "link_to"
    | "source_record_id"
    | "matched_target"
    | "matched_obligation";
}>;

export type MoneyImportCoffeeVisitCandidate = Readonly<{
  localDate: string;
  linkedSourceRowId: string | null;
  targetMovementId: string | null;
  note: string | null;
}>;

export type MoneyImportBillCandidate = Readonly<{
  dueDate: string;
  paid: boolean;
  linkedSourceRowId: string | null;
  targetObligationId: string | null;
  targetMovementId: string | null;
  description: string | null;
}>;

export type MoneyImportCandidate = Readonly<{
  sourceRowId: string;
  sheet: string;
  rowIndex: number;
  classification: MoneyImportClassification;
  action: MoneyImportAction;
  kind: MoneyKind | null;
  direction: MoneyDirection | null;
  /** Magnitude in centimes; never a negative ledger amount. */
  amountMinor: number | null;
  signedEffectMinor: number;
  bookingDate: string | null;
  category: ExpenseCategory | null;
  needVsWant: ExpenseNeedVsWant | null;
  purpose: MoneyPurpose | null;
  countsInDaily: boolean;
  merchant: string | null;
  note: string | null;
  description: string | null;
  provenance: MoneyImportClassificationProvenance;
  link: MoneyImportLinkEvidence | null;
  targetMovementId: string | null;
  targetMovementIdempotencyKey: string | null;
  targetObligationId: string | null;
  coffeeVisit: MoneyImportCoffeeVisitCandidate | null;
  bill: MoneyImportBillCandidate | null;
  countsTowardCashEquation: boolean;
  reason: string | null;
}>;

export type MoneyImportDiscrepancy = Readonly<{
  id: string;
  severity: "blocking" | "acknowledged";
  code: string;
  message: string;
  sourceRowIds: readonly string[];
}>;

export type MoneyImportCashEquation = Readonly<{
  openingMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  savingsMinor: number;
  adjustmentNetMinor: number;
  expectedClosingMinor: number;
  reportedClosingMinor: number | null;
  differenceMinor: number | null;
  balanced: boolean;
  openingKnown: boolean;
}>;

export type MoneyImportDayTotal = Readonly<{
  inMinor: number;
  outMinor: number;
  netMinor: number;
}>;

export type MoneyImportSummary = Readonly<{
  rowCounts: Readonly<Record<MoneyImportClassification | "total", number>>;
  kindTotals: Readonly<Partial<Record<MoneyKind, number>>>;
  categoryTotals: Readonly<Partial<Record<ExpenseCategory, number>>>;
  dayTotals: Readonly<Record<string, MoneyImportDayTotal>>;
  cashEquation: MoneyImportCashEquation;
  linkCoverage: Readonly<{
    coffeeRows: number;
    coffeeLinked: number;
    coffeeUnlinked: number;
    billRows: number;
    paidBills: number;
    unpaidBills: number;
    unresolvedBills: number;
    targetMovementLinks: number;
    obligationLinks: number;
  }>;
  unknowns: number;
}>;

export type MoneyImportManifest = Readonly<{
  version: typeof MONEY_IMPORT_VERSION;
  snapshotId: string;
  snapshotDigest?: string;
  sourceIdentity: string;
  target: Readonly<{ ownerId: string; environment: string }>;
  period: Readonly<{
    startDate: string;
    endDate: string;
    timezone: string;
    activeDate: string;
    opening: Readonly<{
      amountMinor: number | null;
      cutoffDate: string | null;
      evidence: string | null;
    }>;
  }>;
  openingStrategy: MoneyImportOpeningStrategy;
  cutover: MoneyImportCutover;
  targetBaseline: MoneyImportTargetBaseline;
  candidates: readonly MoneyImportCandidate[];
  summary: MoneyImportSummary;
  discrepancies: readonly MoneyImportDiscrepancy[];
  blockers: readonly string[];
}>;

export type MoneyImportApproval = Readonly<{
  status: "approved";
  manifestDigest: string;
  snapshotDigest: string;
  ownerId: string;
  environment: string;
  approvedAt: string;
  approvedBy: string;
  acknowledgedDiscrepancyIds: readonly string[];
}>;

export type MoneyImportApprovalExpected = Readonly<{
  ownerId: string;
  environment: string;
  snapshotDigest: string;
}>;

export type MoneyImportApprovalFailure = Readonly<{
  ok: false;
  code: "validation" | "conflict" | "forbidden";
  reason: string;
  message: string;
}>;

export type MoneyImportApprovalValidation =
  | Readonly<{ ok: true; acknowledgedDiscrepancyIds: readonly string[] }>
  | MoneyImportApprovalFailure;

export class MoneyImportSourceError extends Error {
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string, message: string) {
    super(message);
    this.name = "MoneyImportSourceError";
    this.field = field;
    this.reason = reason;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only JSON object literals may enter frozen source/manifest evidence. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(field: string, reason: string, message: string): never {
  throw new MoneyImportSourceError(field, reason, message);
}

function boundedText(
  raw: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof raw !== "string") {
    fail(field, "invalid_text", `${field} must be text.`);
  }
  const trimmed = raw.trim();
  if (!trimmed) fail(field, "empty_text", `${field} is required.`);
  if (Array.from(trimmed).length > maxLength) {
    fail(
      field,
      "text_too_long",
      `${field} must be ${maxLength} characters or fewer.`,
    );
  }
  return trimmed;
}

function stableId(raw: unknown, field: string, maxLength: number): string {
  const value = boundedText(raw, field, maxLength);
  if (!STABLE_ID_RE.test(value) || value.includes(":")) {
    fail(
      field,
      "invalid_stable_id",
      `${field} must use letters, numbers, dots, underscores or hyphens.`,
    );
  }
  return value;
}

function assertJsonValue(
  value: unknown,
  field: string,
  depth = 0,
): asserts value is unknown {
  if (value === null) return;
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(field, "invalid_number", `${field} contains a non-finite number.`);
    }
    return;
  }
  if (depth >= 8) {
    fail(field, "too_deep", `${field} is nested too deeply.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertJsonValue(item, `${field}[${index}]`, depth + 1),
    );
    return;
  }
  if (isPlainRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${field}.${key}`, depth + 1);
    }
    return;
  }
  fail(field, "invalid_value", `${field} must be plain JSON data.`);
}

function deepFreezeClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeClone(item))) as T;
  }
  if (isPlainRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = deepFreezeClone(item);
    }
    return Object.freeze(copy) as T;
  }
  return value;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function lastDayOfMonth(month: string): string {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  const day = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function monthStartOf(month: string): string {
  return `${month}-01`;
}

export function isMoneyImportOpeningStrategy(
  value: unknown,
): value is MoneyImportOpeningStrategy {
  return (
    typeof value === "string" &&
    (MONEY_IMPORT_OPENING_STRATEGIES as readonly string[]).includes(value)
  );
}

/** Validate a cutover descriptor before the application reads target state. */
export function parseMoneyImportCutover(
  raw: unknown,
): { ok: true; value: MoneyImportCutover } | { ok: false; field: string; message: string } {
  if (!isRecord(raw)) {
    return { ok: false, field: "cutover", message: "Cutover evidence is required." };
  }
  if (typeof raw.date !== "string" || !isIsoDate(raw.date.trim())) {
    return {
      ok: false,
      field: "cutover.date",
      message: "Cutover date must be a valid YYYY-MM-DD date.",
    };
  }
  if (
    typeof raw.reportedBalanceMinor !== "number" ||
    !Number.isSafeInteger(raw.reportedBalanceMinor) ||
    raw.reportedBalanceMinor < 0 ||
    raw.reportedBalanceMinor > EXPENSE_AMOUNT_MINOR_MAX
  ) {
    return {
      ok: false,
      field: "cutover.reportedBalanceMinor",
      message: "Cutover balance must be a non-negative whole number of centimes.",
    };
  }
  if (typeof raw.verified !== "boolean") {
    return {
      ok: false,
      field: "cutover.verified",
      message: "Cutover verification state must be explicit.",
    };
  }
  if (typeof raw.evidenceRef !== "string" || !raw.evidenceRef.trim()) {
    return {
      ok: false,
      field: "cutover.evidenceRef",
      message: "Cutover evidence reference is required.",
    };
  }
  if (
    Array.from(raw.evidenceRef.trim()).length > MONEY_IMPORT_EVIDENCE_MAX_LENGTH
  ) {
    return {
      ok: false,
      field: "cutover.evidenceRef",
      message: "Cutover evidence reference is too long.",
    };
  }
  const uncoveredRaw = raw.uncoveredDates ?? [];
  if (!Array.isArray(uncoveredRaw)) {
    return {
      ok: false,
      field: "cutover.uncoveredDates",
      message: "Uncovered cutover dates must be a list.",
    };
  }
  const uncoveredDates: string[] = [];
  for (const entry of uncoveredRaw) {
    if (typeof entry !== "string" || !isIsoDate(entry.trim())) {
      return {
        ok: false,
        field: "cutover.uncoveredDates",
        message: "Every uncovered cutover date must be a valid YYYY-MM-DD date.",
      };
    }
    if (!uncoveredDates.includes(entry.trim())) uncoveredDates.push(entry.trim());
  }
  return {
    ok: true,
    value: {
      date: raw.date.trim(),
      reportedBalanceMinor: raw.reportedBalanceMinor,
      verified: raw.verified,
      evidenceRef: raw.evidenceRef.trim(),
      uncoveredDates,
    },
  };
}

/** Validate and deeply freeze a workbook export without mutating the caller. */
export function createMoneyImportSnapshot(input: unknown): MoneyImportSourceSnapshot {
  if (!isRecord(input)) {
    fail("snapshot", "invalid_snapshot", "Snapshot must be a JSON object.");
  }
  const allowed = new Set([
    "version",
    "snapshotId",
    "workbookId",
    "sourceIdentity",
    "retrievedAt",
    "extractionDate",
    "month",
    "timezone",
    "currency",
    "rows",
    "tabs",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      fail(key, "unknown_field", `Unknown snapshot field "${key}".`);
    }
  }
  if (input.version !== MONEY_IMPORT_VERSION) {
    fail(
      "version",
      "unsupported_version",
      `Snapshot version must be ${MONEY_IMPORT_VERSION}.`,
    );
  }
  const snapshotId = stableId(
    input.snapshotId,
    "snapshotId",
    MONEY_IMPORT_SNAPSHOT_ID_MAX_LENGTH,
  );
  const workbookId = boundedText(
    input.workbookId,
    "workbookId",
    MONEY_IMPORT_WORKBOOK_ID_MAX_LENGTH,
  );
  const sourceIdentity = boundedText(
    input.sourceIdentity,
    "sourceIdentity",
    MONEY_IMPORT_SOURCE_IDENTITY_MAX_LENGTH,
  );
  if (
    typeof input.retrievedAt !== "string" ||
    !ISO_INSTANT_RE.test(input.retrievedAt.trim()) ||
    Number.isNaN(Date.parse(input.retrievedAt.trim()))
  ) {
    fail(
      "retrievedAt",
      "invalid_instant",
      "retrievedAt must be an ISO-8601 timestamp.",
    );
  }
  if (typeof input.extractionDate !== "string" || !isIsoDate(input.extractionDate.trim())) {
    fail(
      "extractionDate",
      "invalid_date",
      "extractionDate must be a valid YYYY-MM-DD date.",
    );
  }
  if (typeof input.month !== "string" || !MONTH_RE.test(input.month.trim())) {
    fail("month", "invalid_month", "month must use YYYY-MM.");
  }
  const month = input.month.trim();
  if (
    typeof input.timezone !== "string" ||
    !isValidIANATimeZone(input.timezone.trim())
  ) {
    fail("timezone", "invalid_timezone", "timezone must be a valid IANA zone.");
  }
  if (input.currency !== "MAD") {
    fail("currency", "invalid_currency", "Only MAD workbooks are supported.");
  }
  if (!Array.isArray(input.tabs) || input.tabs.length === 0) {
    fail("tabs", "invalid_tabs", "tabs must list at least one sheet.");
  }
  const tabs: string[] = [];
  for (const entry of input.tabs) {
    const tab = boundedText(entry, "tabs", MONEY_IMPORT_SHEET_MAX_LENGTH);
    if (!tabs.includes(tab)) tabs.push(tab);
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    fail("rows", "invalid_rows", "Snapshot must include source rows.");
  }
  if (input.rows.length > MONEY_IMPORT_MAX_ROWS) {
    fail("rows", "too_many_rows", "Snapshot contains too many rows.");
  }

  const rows: MoneyImportSourceRow[] = [];
  const seen = new Set<string>();
  for (const [index, rawRow] of input.rows.entries()) {
    const field = `rows[${index}]`;
    if (!isRecord(rawRow)) {
      fail(field, "invalid_row", "Every source row must be an object.");
    }
    for (const key of Object.keys(rawRow)) {
      if (!["sourceRowId", "sheet", "rowIndex", "raw"].includes(key)) {
        fail(`${field}.${key}`, "unknown_field", `Unknown row field "${key}".`);
      }
    }
    const sourceRowId = stableId(
      rawRow.sourceRowId,
      `${field}.sourceRowId`,
      MONEY_IMPORT_SOURCE_ROW_ID_MAX_LENGTH,
    );
    if (seen.has(sourceRowId)) {
      fail(
        `${field}.sourceRowId`,
        "duplicate_source_row_id",
        `Source row id "${sourceRowId}" is repeated.`,
      );
    }
    seen.add(sourceRowId);
    const sheet = boundedText(
      rawRow.sheet,
      `${field}.sheet`,
      MONEY_IMPORT_SHEET_MAX_LENGTH,
    );
    if (!tabs.includes(sheet)) {
      fail(`${field}.sheet`, "unknown_sheet", "Row sheet is not listed in tabs.");
    }
    if (
      typeof rawRow.rowIndex !== "number" ||
      !Number.isInteger(rawRow.rowIndex) ||
      rawRow.rowIndex < 0 ||
      rawRow.rowIndex > 1_000_000
    ) {
      fail(`${field}.rowIndex`, "invalid_row_index", "Row number must be a positive integer.");
    }
    if (!isRecord(rawRow.raw)) {
      fail(`${field}.raw`, "invalid_raw", "Row raw values must be an object.");
    }
    assertJsonValue(rawRow.raw, `${field}.raw`);

    const raw = rawRow.raw;
    if (raw.workbookId !== undefined) {
      if (typeof raw.workbookId !== "string") {
        fail(
          `${field}.raw.workbookId`,
          "invalid_workbook",
          "Row workbook identity must be text.",
        );
      }
      if (raw.workbookId.trim() !== workbookId) {
        fail(
          `${field}.raw.workbookId`,
          "foreign_workbook",
          "Row belongs to a different workbook.",
        );
      }
    }
    if (raw.month !== undefined) {
      if (typeof raw.month !== "string") {
        fail(
          `${field}.raw.month`,
          "invalid_month",
          "Row month must be text.",
        );
      }
      if (raw.month.trim() !== month) {
        fail(
          `${field}.raw.month`,
          "foreign_month",
          "Row belongs to a different workbook month.",
        );
      }
    }
    for (const dateField of [
      "date",
      "bookingDate",
      "dueDate",
      "localDate",
      "cutoverDate",
    ]) {
      const value = raw[dateField];
      if (value === undefined || value === null) continue;
      if (typeof value !== "string" || !isIsoDate(value.trim())) {
        fail(
          `${field}.raw.${dateField}`,
          "invalid_date",
          `${dateField} must be a valid YYYY-MM-DD date.`,
        );
      }
    }

    rows.push(
      Object.freeze({
        sourceRowId,
        sheet,
        rowIndex: rawRow.rowIndex,
        raw: deepFreezeClone(raw),
      }),
    );
  }

  return Object.freeze({
    version: MONEY_IMPORT_VERSION,
    snapshotId,
    workbookId,
    sourceIdentity,
    retrievedAt: String(input.retrievedAt).trim(),
    extractionDate: String(input.extractionDate).trim(),
    month,
    timezone: String(input.timezone).trim(),
    currency: "MAD" as const,
    rows: Object.freeze(rows),
    tabs: Object.freeze(tabs),
  });
}

/** Stable payload used for the frozen snapshot digest. */
export function canonicalMoneyImportSnapshotPayload(
  snapshot: MoneyImportSourceSnapshot,
): string {
  const rows = [...snapshot.rows].sort((left, right) => {
    if (left.sheet !== right.sheet) return left.sheet < right.sheet ? -1 : 1;
    return left.sourceRowId < right.sourceRowId ? -1 : left.sourceRowId > right.sourceRowId ? 1 : 0;
  });
  return stableJson({
    version: snapshot.version,
    snapshotId: snapshot.snapshotId,
    workbookId: snapshot.workbookId,
    sourceIdentity: snapshot.sourceIdentity,
    retrievedAt: snapshot.retrievedAt,
    extractionDate: snapshot.extractionDate,
    month: snapshot.month,
    timezone: snapshot.timezone,
    currency: snapshot.currency,
    tabs: snapshot.tabs,
    rows,
  });
}

/**
 * Parse a workbook amount into exact signed centimes. No floating point
 * multiplication and no rounding: a value with more than two decimals is an
 * error even when a rounded centime would look plausible.
 */
export function parseMoneyImportAmountMinor(
  raw: unknown,
): { ok: true; valueMinor: number } | { ok: false; reason: string } {
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "not_finite" };
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.trim();
  } else {
    return { ok: false, reason: "not_numeric" };
  }
  if (!text) return { ok: false, reason: "empty" };
  if (/[eE]/.test(text)) return { ok: false, reason: "exponent" };
  if (/,/.test(text) || /\s/.test(text)) {
    return { ok: false, reason: "not_numeric" };
  }
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) {
    return { ok: false, reason: "not_numeric" };
  }
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  if (fractionPart.length > 2) return { ok: false, reason: "overprecision" };
  const paddedFraction = fractionPart.padEnd(2, "0");
  let valueMinor: number;
  try {
    const minor =
      BigInt(integerPart || "0") * BigInt(100) +
      BigInt(paddedFraction || "0");
    if (minor > BigInt(EXPENSE_AMOUNT_MINOR_MAX)) {
      return { ok: false, reason: "out_of_range" };
    }
    valueMinor = Number(minor) * (negative ? -1 : 1);
  } catch {
    return { ok: false, reason: "not_numeric" };
  }
  return { ok: true, valueMinor };
}

/** Apply the direction exactly once. Amounts stay non-negative magnitudes. */
export function moneyImportSignedEffectMinor(
  candidate: Pick<MoneyImportCandidate, "kind" | "direction" | "amountMinor">,
): number {
  if (candidate.kind === null || candidate.amountMinor === null) return 0;
  if (
    !Number.isSafeInteger(candidate.amountMinor) ||
    candidate.amountMinor < 0
  ) {
    throw new Error("A money import candidate amount must be a non-negative integer.");
  }
  if (candidate.direction !== "in" && candidate.direction !== "out") {
    throw new Error("A money import cash candidate needs an explicit direction.");
  }
  return candidate.direction === "in"
    ? candidate.amountMinor
    : -candidate.amountMinor;
}

export function moneyImportMovementKey(
  snapshotId: string,
  sourceRowId: string,
): string {
  if (!STABLE_ID_RE.test(snapshotId) || !STABLE_ID_RE.test(sourceRowId)) {
    throw new Error("Import identity must be a stable non-empty id.");
  }
  const key = `mi-mv:${snapshotId}:${sourceRowId}`;
  if (key.length > 128) {
    throw new Error("Import movement key exceeds the canonical 128 character limit.");
  }
  return key;
}

export function moneyImportCoffeeVisitKey(
  snapshotId: string,
  sourceRowId: string,
): string {
  if (!STABLE_ID_RE.test(snapshotId) || !STABLE_ID_RE.test(sourceRowId)) {
    throw new Error("Import identity must be a stable non-empty id.");
  }
  const key = `mi-cf:${snapshotId}:${sourceRowId}`;
  if (key.length > 128) {
    throw new Error("Import coffee visit key exceeds the canonical 128 character limit.");
  }
  return key;
}

const ROW_TYPE_ALIASES: Readonly<Record<string, MoneyImportClassification>> =
  Object.freeze({
    opening: "opening",
    income: "income",
    inflow: "income",
    revenue: "income",
    expense: "expense",
    outflow: "expense",
    spending: "expense",
    savings_transfer: "savings_transfer",
    savings: "savings_transfer",
    transfer: "savings_transfer",
    reconciliation_adjustment: "reconciliation_adjustment",
    reconciliation: "reconciliation_adjustment",
    adjustment: "reconciliation_adjustment",
    coffee: "coffee_link",
    coffee_visit: "coffee_link",
    bill: "bill_link",
    bills: "bill_link",
    dashboard: "derived",
    derived: "derived",
    formula: "derived",
    running_balance: "derived",
    settings: "settings_metadata",
    setting: "settings_metadata",
    metadata: "settings_metadata",
  });

const RAW_TYPE_KEYS = ["type", "classification", "rowType", "kind"] as const;
const RAW_DATE_KEYS = ["date", "bookingDate"] as const;
const RAW_AMOUNT_KEYS = ["amount", "amountMad", "value"] as const;
const RAW_MERCHANT_KEYS = ["merchant", "payee"] as const;
const RAW_NOTE_KEYS = ["note", "notes"] as const;
const RAW_DESCRIPTION_KEYS = ["description", "label"] as const;
const RAW_CATEGORY_KEYS = ["category"] as const;
const RAW_NEED_KEYS = ["needVsWant", "needOrWant", "need_vs_want"] as const;
const RAW_PURPOSE_KEYS = ["purpose"] as const;
const RAW_COUNTS_KEYS = ["countsInDaily", "counts_in_daily"] as const;

type MoneyImportSheetRole =
  | "ledger"
  | "tracker"
  | "coffee"
  | "bills"
  | "savings"
  | "dashboard"
  | "settings";

const SHEET_ROLE_ALIASES: Readonly<Record<string, MoneyImportSheetRole>> =
  Object.freeze({
    ledger: "ledger",
    expenses: "ledger",
    expense: "ledger",
    movements: "ledger",
    opening: "ledger",
    daily_tracker: "tracker",
    tracker: "tracker",
    coffee: "coffee",
    coffee_tracker: "coffee",
    bills: "bills",
    bill: "bills",
    subscriptions: "bills",
    subscription: "bills",
    fixed_bills: "bills",
    fixed_bill: "bills",
    fixed_expenses: "bills",
    bills_tracker: "bills",
    savings: "savings",
    transfers: "savings",
    transfer: "savings",
    savings_tracker: "savings",
    dashboard: "dashboard",
    summary: "dashboard",
    settings: "settings",
    targets: "settings",
    target: "settings",
    budget_plan: "settings",
    budget: "settings",
  });

const SHEET_ALLOWED_CLASSIFICATIONS: Readonly<
  Record<MoneyImportSheetRole, ReadonlySet<MoneyImportClassification>>
> = Object.freeze({
  ledger: new Set<MoneyImportClassification>([
    "opening",
    "income",
    "expense",
    "savings_transfer",
    "reconciliation_adjustment",
    "derived",
    "unresolved",
  ]),
  tracker: new Set<MoneyImportClassification>(["derived", "unresolved"]),
  coffee: new Set<MoneyImportClassification>([
    "coffee_link",
    "derived",
    "unresolved",
  ]),
  bills: new Set<MoneyImportClassification>([
    "bill_link",
    "derived",
    "unresolved",
  ]),
  // A savings/transfers sheet may hold the transfer itself or ordinary ledger
  // rows that the owner recorded on that tab.
  savings: new Set<MoneyImportClassification>([
    "opening",
    "income",
    "expense",
    "savings_transfer",
    "reconciliation_adjustment",
    "derived",
    "unresolved",
  ]),
  dashboard: new Set<MoneyImportClassification>(["derived", "unresolved"]),
  settings: new Set<MoneyImportClassification>(["settings_metadata", "unresolved"]),
});

function sheetRoleFor(sheet: string): MoneyImportSheetRole | null {
  const normalized = sheet.trim().toLowerCase().replace(/[\s_-]+/g, "_");
  return SHEET_ROLE_ALIASES[normalized] ?? null;
}

function sheetAllowsClassification(
  role: MoneyImportSheetRole,
  classification: MoneyImportClassification,
): boolean {
  return SHEET_ALLOWED_CLASSIFICATIONS[role].has(classification);
}

function rawValue(
  raw: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined) return raw[key];
  }
  return undefined;
}

function rawText(
  raw: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  const value = rawValue(raw, keys);
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizedText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || null;
}

function classificationFor(
  raw: Readonly<Record<string, unknown>>,
): MoneyImportClassification {
  if (raw.derived === true) return "derived";
  const typeValue = rawText(raw, RAW_TYPE_KEYS);
  if (!typeValue) return "unresolved";
  const normalized = typeValue
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  return ROW_TYPE_ALIASES[normalized] ?? "unresolved";
}

function parseBooleanText(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

type RawAmountResult = Readonly<{
  amountMinor: number | null;
  reason: string | null;
}>;

function rawAmount(
  raw: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): RawAmountResult {
  const value = rawValue(raw, keys);
  if (value === undefined || value === null) {
    return { amountMinor: null, reason: "unknown_amount" };
  }
  const parsed = parseMoneyImportAmountMinor(value);
  if (!parsed.ok) return { amountMinor: null, reason: parsed.reason };
  return { amountMinor: parsed.valueMinor, reason: null };
}

function emptyProvenance(): MoneyImportClassificationProvenance {
  return {
    category: "default",
    needVsWant: "default",
    purpose: "default",
    countsInDaily: "default",
  };
}

function candidateBase(row: MoneyImportSourceRow): Pick<
  MoneyImportCandidate,
  | "sourceRowId"
  | "sheet"
  | "rowIndex"
  | "kind"
  | "direction"
  | "amountMinor"
  | "signedEffectMinor"
  | "bookingDate"
  | "category"
  | "needVsWant"
  | "purpose"
  | "countsInDaily"
  | "merchant"
  | "note"
  | "description"
  | "provenance"
  | "link"
  | "targetMovementId"
  | "targetMovementIdempotencyKey"
  | "targetObligationId"
  | "coffeeVisit"
  | "bill"
  | "countsTowardCashEquation"
  | "reason"
> {
  return {
    sourceRowId: row.sourceRowId,
    sheet: row.sheet,
    rowIndex: row.rowIndex,
    kind: null,
    direction: null,
    amountMinor: null,
    signedEffectMinor: 0,
    bookingDate: null,
    category: null,
    needVsWant: null,
    purpose: null,
    countsInDaily: false,
    merchant: null,
    note: null,
    description: null,
    provenance: emptyProvenance(),
    link: null,
    targetMovementId: null,
    targetMovementIdempotencyKey: null,
    targetObligationId: null,
    coffeeVisit: null,
    bill: null,
    countsTowardCashEquation: false,
    reason: null,
  };
}

function candidate(
  row: MoneyImportSourceRow,
  values: Omit<MoneyImportCandidate, "sourceRowId" | "sheet" | "rowIndex">,
): MoneyImportCandidate {
  return Object.freeze({ ...candidateBase(row), ...values });
}

type SheetBlock = Readonly<{
  code: "unsupported_sheet" | "sheet_classification_mismatch";
  message: string;
}>;

type ClassifiedImportRow = Readonly<{
  row: MoneyImportSourceRow;
  classification: MoneyImportClassification;
  sheetBlock: SheetBlock | null;
}>;

function buildSheetBlockedCandidate(
  row: MoneyImportSourceRow,
  block: SheetBlock,
): { candidate: MoneyImportCandidate; discrepancies: MoneyImportDiscrepancy[] } {
  const base = candidateBase(row);
  return {
    candidate: candidate(row, {
      ...base,
      classification: "unresolved",
      action: "conflict",
      reason: block.code,
    }),
    discrepancies: [
      {
        id: `${block.code}:${row.sourceRowId}`,
        severity: "blocking",
        code: block.code,
        message: block.message,
        sourceRowIds: [row.sourceRowId],
      },
    ],
  };
}

type MatchOutcome = Readonly<{
  action: MoneyImportAction;
  targetMovementId: string | null;
  targetMovementIdempotencyKey: string | null;
  reason: string | null;
  discrepancy: MoneyImportDiscrepancy | null;
}>;

function findTargetMovementMatch(
  candidateMovement: Readonly<{
    kind: MoneyKind;
    direction: MoneyDirection;
    amountMinor: number;
    bookingDate: string;
    category: ExpenseCategory | null;
    merchant: string | null;
    note: string | null;
  }>,
  importKey: string,
  targetMovements: readonly MoneyImportTargetMovement[],
  sourceRowId: string,
): MatchOutcome {
  const alive = targetMovements.filter((movement) => movement.deletedAt === null);
  const idempotent = alive.find(
    (movement) => movement.idempotencyKey === importKey,
  );
  if (idempotent) {
    return {
      action: "skip",
      targetMovementId: idempotent.id,
      targetMovementIdempotencyKey: idempotent.idempotencyKey,
      reason: "already_applied",
      discrepancy: null,
    };
  }

  const core = alive.filter(
    (movement) =>
      movement.kind === candidateMovement.kind &&
      movement.direction === candidateMovement.direction &&
      movement.amountMinor === candidateMovement.amountMinor &&
      movement.bookingDate === candidateMovement.bookingDate &&
      movement.category === candidateMovement.category,
  );
  const candidateMerchant = normalizedText(candidateMovement.merchant);
  const candidateNote = normalizedText(candidateMovement.note);
  const strong = core.filter((movement) => {
    const merchantMatches =
      candidateMerchant !== null &&
      normalizedText(movement.merchant) === candidateMerchant;
    const noteMatches =
      candidateNote !== null && normalizedText(movement.note) === candidateNote;
    return merchantMatches || noteMatches;
  });

  if (strong.length === 1) {
    return {
      action: "link",
      targetMovementId: strong[0].id,
      targetMovementIdempotencyKey: strong[0].idempotencyKey,
      reason: "matched_existing_movement",
      discrepancy: null,
    };
  }
  if (strong.length > 1 || core.length > 0) {
    return {
      action: "conflict",
      targetMovementId: null,
      targetMovementIdempotencyKey: null,
      reason: "ambiguous_existing_match",
      discrepancy: {
        id: `ambiguous_existing_match:${sourceRowId}`,
        severity: "blocking",
        code: "ambiguous_existing_match",
        message:
          "An existing target movement could match this source row but the match is not unique. Resolve the duplicate before adopting.",
        sourceRowIds: [sourceRowId],
      },
    };
  }
  return {
    action: "insert",
    targetMovementId: null,
    targetMovementIdempotencyKey: null,
    reason: null,
    discrepancy: null,
  };
}

function resolveSourceLink(
  raw: Readonly<Record<string, unknown>>,
  rowIds: ReadonlySet<string>,
  targetMovements: readonly MoneyImportTargetMovement[],
): { link: MoneyImportLinkEvidence; targetMovementId: string | null } | null {
  const linkValue = rawValue(raw, ["linkTo", "linkToSourceRowId"]);
  if (typeof linkValue === "string" && rowIds.has(linkValue.trim())) {
    return {
      link: {
        target: "source_row",
        id: linkValue.trim(),
        evidence: "link_to",
      },
      targetMovementId: null,
    };
  }
  const recordValue = rawValue(raw, ["sourceRecordId"]);
  if (typeof recordValue === "string") {
    const target = targetMovements.find(
      (movement) => movement.id === recordValue.trim(),
    );
    if (target) {
      return {
        link: {
          target: "movement",
          id: target.id,
          evidence: "source_record_id",
        },
        targetMovementId: target.id,
      };
    }
  }
  if (typeof linkValue === "string") {
    const target = targetMovements.find(
      (movement) => movement.id === linkValue.trim(),
    );
    if (target) {
      return {
        link: {
          target: "movement",
          id: target.id,
          evidence: "link_to",
        },
        targetMovementId: target.id,
      };
    }
  }
  return null;
}

type CashKind = "income" | "expense" | "savings_transfer" | "reconciliation_adjustment";

function cashKindFor(
  classification: MoneyImportClassification,
): CashKind | null {
  if (
    classification === "income" ||
    classification === "expense" ||
    classification === "savings_transfer" ||
    classification === "reconciliation_adjustment"
  ) {
    return classification;
  }
  return null;
}

function buildLedgerCandidate(input: Readonly<{
  row: MoneyImportSourceRow;
  classification: MoneyImportClassification;
  snapshot: MoneyImportSourceSnapshot;
  openingStrategy: MoneyImportOpeningStrategy;
  cutover: MoneyImportCutover;
  periodStartDate: string;
  monthEnd: string;
  targetMovements: readonly MoneyImportTargetMovement[];
}>): { candidate: MoneyImportCandidate; discrepancies: MoneyImportDiscrepancy[]; reportedClosing: number | null } {
  const { row, classification, snapshot, openingStrategy, cutover, periodStartDate, monthEnd } = input;
  const base = candidateBase(row);
  const discrepancies: MoneyImportDiscrepancy[] = [];
  const date = rawText(row.raw, RAW_DATE_KEYS);
  const amount = rawAmount(row.raw, RAW_AMOUNT_KEYS);
  const merchant = rawText(row.raw, RAW_MERCHANT_KEYS);
  const note = rawText(row.raw, RAW_NOTE_KEYS);
  const description = rawText(row.raw, RAW_DESCRIPTION_KEYS);
  const sourceNote = note ?? description;

  const unresolved = (
    code: string,
    message: string,
    reason: string,
  ): { candidate: MoneyImportCandidate; discrepancies: MoneyImportDiscrepancy[]; reportedClosing: null } => ({
    candidate: candidate(row, {
      ...base,
      classification: "unresolved",
      action: "conflict",
      merchant,
      note,
      description,
      reason,
    }),
    discrepancies: [
      {
        id: `${code}:${row.sourceRowId}`,
        severity: "blocking",
        code,
        message,
        sourceRowIds: [row.sourceRowId],
      },
    ],
    reportedClosing: null,
  });

  if (classification === "opening") {
    if (!date) {
      return unresolved(
        "unknown_date",
        "An opening row needs its owner-local date.",
        "unknown_date",
      );
    }
    if (date > monthEnd) {
      return unresolved(
        "outside_snapshot_month",
        "A cash row outside the snapshot month cannot be imported.",
        "outside_snapshot_month",
      );
    }
    if (amount.amountMinor === null) {
      return unresolved(
        amount.reason ?? "unknown_amount",
        "An opening row needs an exact non-negative centime amount.",
        amount.reason ?? "unknown_amount",
      );
    }
    if (amount.amountMinor < 0) {
      return unresolved(
        "invalid_opening_amount",
        "An opening balance cannot be negative.",
        "invalid_opening_amount",
      );
    }
    if (openingStrategy === "verified_cutover_opening") {
      if (date !== cutover.date) {
        return unresolved(
          "cutover_opening_date_mismatch",
          "The verified opening row must book on the cutover date.",
          "cutover_opening_date_mismatch",
        );
      }
    }
    return {
      candidate: candidate(row, {
        ...base,
        classification: "opening",
        action: "skip",
        kind: "opening",
        direction: "in",
        amountMinor: amount.amountMinor,
        signedEffectMinor: 0,
        bookingDate: date,
        merchant,
        note,
        description,
        provenance: emptyProvenance(),
        reason: "period_opening",
      }),
      discrepancies,
      reportedClosing: null,
    };
  }

  if (!date) {
    return unresolved(
      "unknown_date",
      "This row needs its owner-local booking date.",
      "unknown_date",
    );
  }
  if (date > monthEnd) {
    return unresolved(
      "outside_snapshot_month",
      "A cash row outside the snapshot month cannot be imported.",
      "outside_snapshot_month",
    );
  }
  if (amount.amountMinor === null) {
    return unresolved(
      amount.reason ?? "unknown_amount",
      "This row needs an exact centime amount.",
      amount.reason ?? "unknown_amount",
    );
  }
  if (amount.amountMinor === 0) {
    return unresolved(
      "zero_amount",
      "Only an opening balance may be zero; this row has no cash effect to record.",
      "zero_amount",
    );
  }

  const kind = cashKindFor(classification) as CashKind;
  const sourceDirection: MoneyDirection =
    amount.amountMinor < 0 ? "out" : "in";
  if (classification === "income" && sourceDirection !== "in") {
    return unresolved(
      "direction_conflict",
      "An income row cannot carry a negative source amount.",
      "direction_conflict",
    );
  }
  if (
    (classification === "expense" || classification === "savings_transfer") &&
    sourceDirection !== "out"
  ) {
    return unresolved(
      "direction_conflict",
      "An expense or savings transfer must be a source outflow.",
      "direction_conflict",
    );
  }

  if (
    openingStrategy === "verified_cutover_opening" &&
    date < cutover.date
  ) {
    return {
      candidate: candidate(row, {
        ...base,
        classification,
        action: "skip",
        kind,
        direction: sourceDirection,
        amountMinor: Math.abs(amount.amountMinor),
        signedEffectMinor: 0,
        bookingDate: date,
        merchant,
        note,
        description,
        reason: "included_in_cutover_opening",
      }),
      discrepancies,
      reportedClosing: null,
    };
  }
  if (
    openingStrategy === "full_history" &&
    date < periodStartDate
  ) {
    return {
      candidate: candidate(row, {
        ...base,
        classification,
        action: "skip",
        kind,
        direction: sourceDirection,
        amountMinor: Math.abs(amount.amountMinor),
        signedEffectMinor: 0,
        bookingDate: date,
        merchant,
        note,
        description,
        reason: "before_opening_balance",
      }),
      discrepancies,
      reportedClosing: null,
    };
  }

  let category: ExpenseCategory | null = null;
  let needVsWant: ExpenseNeedVsWant | null = null;
  let purpose: MoneyPurpose | null = null;
  let countsInDaily = false;
  const provenance = {
    category: "default" as "source" | "default",
    needVsWant: "default" as "source" | "default",
    purpose: "default" as "source" | "default",
    countsInDaily: "default" as "source" | "default",
  };
  if (classification === "expense") {
    const rawCategory = rawText(row.raw, RAW_CATEGORY_KEYS);
    const categoryValue = rawCategory?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
    if (!categoryValue || !isExpenseCategory(categoryValue)) {
      return unresolved(
        "unknown_category",
        "An expense row needs a supported source category.",
        "unknown_category",
      );
    }
    category = categoryValue;
    const rawNeed = rawText(row.raw, RAW_NEED_KEYS);
    const needValue = rawNeed?.toLowerCase() ?? null;
    if (needValue !== null && !isExpenseNeedVsWant(needValue)) {
      return unresolved(
        "invalid_need_vs_want",
        "The source need/want value is not supported.",
        "invalid_need_vs_want",
      );
    }
    needVsWant = needValue ?? "want";
    const rawPurpose = rawText(row.raw, RAW_PURPOSE_KEYS);
    const purposeValue = rawPurpose?.toLowerCase() ?? null;
    if (
      purposeValue !== null &&
      purposeValue !== "fixed" &&
      purposeValue !== "flexible" &&
      purposeValue !== "emergency"
    ) {
      return unresolved(
        "invalid_purpose",
        "The source purpose value is not supported.",
        "invalid_purpose",
      );
    }
    purpose = (purposeValue as MoneyPurpose | null) ?? "flexible";
    const rawCounts = rawValue(row.raw, RAW_COUNTS_KEYS);
    const parsedCounts = parseBooleanText(rawCounts);
    if (rawCounts !== undefined && parsedCounts === null) {
      return unresolved(
        "invalid_counts_in_daily",
        "The source daily-count flag must be true or false.",
        "invalid_counts_in_daily",
      );
    }
    countsInDaily = parsedCounts ?? true;
    provenance.category = "source";
    provenance.needVsWant = rawNeed === null ? "default" : "source";
    provenance.purpose = rawPurpose === null ? "default" : "source";
    provenance.countsInDaily = parsedCounts === null ? "default" : "source";
  }

  const magnitude = Math.abs(amount.amountMinor);
  const importKey = moneyImportMovementKey(
    snapshot.snapshotId,
    row.sourceRowId,
  );
  const match = findTargetMovementMatch(
    {
      kind,
      direction: sourceDirection,
      amountMinor: magnitude,
      bookingDate: date,
      category,
      merchant,
      note: sourceNote,
    },
    importKey,
    input.targetMovements,
    row.sourceRowId,
  );
  if (match.discrepancy) discrepancies.push(match.discrepancy);

  return {
    candidate: candidate(row, {
      ...base,
      classification,
      action: match.action,
      kind,
      direction: sourceDirection,
      amountMinor: magnitude,
      signedEffectMinor: moneyImportSignedEffectMinor({
        kind,
        direction: sourceDirection,
        amountMinor: magnitude,
      }),
      bookingDate: date,
      category,
      needVsWant,
      purpose,
      countsInDaily,
      merchant,
      note,
      description,
      provenance,
      link: match.targetMovementId
        ? {
            target: "movement",
            id: match.targetMovementId,
            evidence: "matched_target",
          }
        : null,
      targetMovementId: match.targetMovementId,
      targetMovementIdempotencyKey: match.targetMovementIdempotencyKey,
      countsTowardCashEquation: true,
      reason: match.reason,
    }),
    discrepancies,
    reportedClosing: null,
  };
}

function buildCoffeeCandidate(input: Readonly<{
  row: MoneyImportSourceRow;
  snapshot: MoneyImportSourceSnapshot;
  rowsById: ReadonlyMap<string, MoneyImportSourceRow>;
  ledgerCandidates: ReadonlyMap<string, MoneyImportCandidate>;
  target: MoneyImportTarget;
  monthEnd: string;
}>): { candidate: MoneyImportCandidate; discrepancies: MoneyImportDiscrepancy[] } {
  const { row, snapshot, rowsById, ledgerCandidates, target, monthEnd } = input;
  const base = candidateBase(row);
  const date = rawText(row.raw, ["date", "bookingDate", "localDate"]);
  const amount = rawAmount(row.raw, RAW_AMOUNT_KEYS);
  const note = rawText(row.raw, RAW_NOTE_KEYS);
  const description = rawText(row.raw, RAW_DESCRIPTION_KEYS);
  const merchant = rawText(row.raw, RAW_MERCHANT_KEYS);
  const visitKey = moneyImportCoffeeVisitKey(
    snapshot.snapshotId,
    row.sourceRowId,
  );

  const conflict = (
    code: string,
    message: string,
  ): { candidate: MoneyImportCandidate; discrepancies: MoneyImportDiscrepancy[] } => ({
    candidate: candidate(row, {
      ...base,
      classification: "coffee_link",
      action: "conflict",
      amountMinor: amount.amountMinor === null ? null : Math.abs(amount.amountMinor),
      bookingDate: date,
      merchant,
      note,
      description,
      reason: code,
    }),
    discrepancies: [
      {
        id: `${code}:${row.sourceRowId}`,
        severity: "blocking",
        code,
        message,
        sourceRowIds: [row.sourceRowId],
      },
    ],
  });

  if (!date) {
    return conflict("unknown_date", "A coffee row needs its owner-local date.");
  }
  if (date > monthEnd) {
    return conflict(
      "outside_snapshot_month",
      "A coffee row outside the snapshot month cannot be imported.",
    );
  }
  if (amount.amountMinor === null || amount.amountMinor <= 0) {
    return conflict(
      amount.reason ?? "invalid_coffee_amount",
      "A coffee row needs an exact positive centime amount.",
    );
  }
  if (target.coffeeVisits.some((visit) => visit.visitKey === visitKey)) {
    return {
      candidate: candidate(row, {
        ...base,
        classification: "coffee_link",
        action: "skip",
        amountMinor: amount.amountMinor,
        bookingDate: date,
        merchant,
        note,
        description,
        coffeeVisit: {
          localDate: date,
          linkedSourceRowId: null,
          targetMovementId: null,
          note: note ?? description,
        },
        reason: "already_applied",
      }),
      discrepancies: [],
    };
  }

  const sourceLink = resolveSourceLink(row.raw, new Set(rowsById.keys()), target.movements);
  if (sourceLink && sourceLink.link.target === "source_row") {
    const sourceRow = rowsById.get(sourceLink.link.id);
    if (!sourceRow) {
      return conflict("coffee_link_missing", "The linked purchase row is not in this snapshot.");
    }
    const linkedCandidate = ledgerCandidates.get(sourceRow.sourceRowId);
    if (
      !linkedCandidate ||
      linkedCandidate.classification !== "expense" ||
      linkedCandidate.kind !== "expense" ||
      linkedCandidate.category !== "coffee" ||
      linkedCandidate.action === "conflict" ||
      (linkedCandidate.action === "skip" &&
        linkedCandidate.reason !== "already_applied")
    ) {
      return conflict(
        "coffee_link_invalid",
        "A coffee row must link to a valid non-conflicting coffee-category expense ledger row.",
      );
    }
    if (linkedCandidate.bookingDate !== date) {
      return conflict(
        "coffee_link_date_mismatch",
        "The linked purchase date must equal the coffee visit date.",
      );
    }
    if (linkedCandidate.amountMinor !== amount.amountMinor) {
      return conflict(
        "coffee_link_amount_mismatch",
        "The linked purchase amount must equal the coffee row amount.",
      );
    }
    return {
      candidate: candidate(row, {
        ...base,
        classification: "coffee_link",
        action: "link",
        amountMinor: amount.amountMinor,
        bookingDate: date,
        merchant,
        note,
        description,
        link: sourceLink.link,
        targetMovementId: linkedCandidate.targetMovementId,
        targetMovementIdempotencyKey: linkedCandidate.targetMovementIdempotencyKey,
        coffeeVisit: {
          localDate: date,
          linkedSourceRowId: linkedCandidate.sourceRowId,
          targetMovementId: linkedCandidate.targetMovementId,
          note: note ?? description,
        },
        reason: "coffee_visit_link",
      }),
      discrepancies: [],
    };
  }

  if (sourceLink && sourceLink.targetMovementId) {
    const linked = target.movements.find(
      (movement) => movement.id === sourceLink.targetMovementId,
    );
    if (!linked || linked.deletedAt !== null || linked.category !== "coffee") {
      return conflict(
        "coffee_link_invalid",
        "A linked target record must be a coffee-category expense.",
      );
    }
    if (linked.bookingDate !== date || linked.amountMinor !== amount.amountMinor) {
      return conflict(
        "coffee_link_mismatch",
        "The linked target record must match the coffee date and amount.",
      );
    }
    return {
      candidate: candidate(row, {
        ...base,
        classification: "coffee_link",
        action: "link",
        amountMinor: amount.amountMinor,
        bookingDate: date,
        merchant,
        note,
        description,
        link: sourceLink.link,
        targetMovementId: linked.id,
        targetMovementIdempotencyKey: linked.idempotencyKey,
        coffeeVisit: {
          localDate: date,
          linkedSourceRowId: null,
          targetMovementId: linked.id,
          note: note ?? description,
        },
        reason: "coffee_visit_link",
      }),
      discrepancies: [],
    };
  }

  const possible = target.movements.filter(
    (movement) =>
      movement.deletedAt === null &&
      movement.kind === "expense" &&
      movement.category === "coffee" &&
      movement.bookingDate === date &&
      movement.amountMinor === amount.amountMinor,
  );
  if (possible.length === 1) {
    return {
      candidate: candidate(row, {
        ...base,
        classification: "coffee_link",
        action: "link",
        amountMinor: amount.amountMinor,
        bookingDate: date,
        merchant,
        note,
        description,
        link: {
          target: "movement",
          id: possible[0].id,
          evidence: "matched_target",
        },
        targetMovementId: possible[0].id,
        targetMovementIdempotencyKey: possible[0].idempotencyKey,
        coffeeVisit: {
          localDate: date,
          linkedSourceRowId: null,
          targetMovementId: possible[0].id,
          note: note ?? description,
        },
        reason: "coffee_visit_link",
      }),
      discrepancies: [],
    };
  }
  if (possible.length > 1) {
    return conflict(
      "ambiguous_coffee_link",
      "More than one target coffee purchase matches this coffee row.",
    );
  }
  return conflict(
    "coffee_link_missing",
    "A coffee row must link to exactly one canonical coffee purchase.",
  );
}

function buildBillCandidate(input: Readonly<{
  row: MoneyImportSourceRow;
  rowsById: ReadonlyMap<string, MoneyImportSourceRow>;
  ledgerCandidates: ReadonlyMap<string, MoneyImportCandidate>;
  target: MoneyImportTarget;
}>): { candidate: MoneyImportCandidate; discrepancies: MoneyImportDiscrepancy[] } {
  const { row, rowsById, ledgerCandidates, target } = input;
  const base = candidateBase(row);
  const dueDate = rawText(row.raw, ["dueDate", "date"]);
  const amount = rawAmount(row.raw, RAW_AMOUNT_KEYS);
  const description =
    rawText(row.raw, RAW_DESCRIPTION_KEYS) ?? rawText(row.raw, RAW_NOTE_KEYS);
  const note = rawText(row.raw, RAW_NOTE_KEYS);
  const merchant = rawText(row.raw, RAW_MERCHANT_KEYS);
  const paid = parseBooleanText(rawValue(row.raw, ["paid"]));

  const conflict = (
    code: string,
    message: string,
  ): { candidate: MoneyImportCandidate; discrepancies: MoneyImportDiscrepancy[] } => ({
    candidate: candidate(row, {
      ...base,
      classification: "bill_link",
      action: "conflict",
      amountMinor: amount.amountMinor === null ? null : Math.abs(amount.amountMinor),
      bookingDate: dueDate,
      merchant,
      note,
      description,
      bill:
        dueDate && paid !== null
          ? {
              dueDate,
              paid,
              linkedSourceRowId: null,
              targetObligationId: null,
              targetMovementId: null,
              description,
            }
          : null,
      reason: code,
    }),
    discrepancies: [
      {
        id: `${code}:${row.sourceRowId}`,
        severity: "blocking",
        code,
        message,
        sourceRowIds: [row.sourceRowId],
      },
    ],
  });

  if (!dueDate) {
    return conflict("unknown_date", "A bill row needs its due date.");
  }
  if (amount.amountMinor === null || amount.amountMinor <= 0) {
    return conflict(
      amount.reason ?? "invalid_bill_amount",
      "A bill row needs an exact positive centime amount.",
    );
  }
  if (paid === null) {
    return conflict(
      "unknown_bill_state",
      "A bill row must state whether it was paid.",
    );
  }
  if (!paid) {
    return {
      candidate: candidate(row, {
        ...base,
        classification: "bill_link",
        action: "skip",
        amountMinor: amount.amountMinor,
        bookingDate: dueDate,
        merchant,
        note,
        description,
        bill: {
          dueDate,
          paid: false,
          linkedSourceRowId: null,
          targetObligationId: null,
          targetMovementId: null,
          description,
        },
        reason: "unpaid_bill_metadata",
      }),
      discrepancies: [],
    };
  }

  const sourceLink = resolveSourceLink(row.raw, new Set(rowsById.keys()), target.movements);
  if (sourceLink && sourceLink.link.target === "source_row") {
    const sourceRow = rowsById.get(sourceLink.link.id);
    if (!sourceRow) {
      return conflict("bill_link_missing", "The linked payment row is not in this snapshot.");
    }
    const linkedCandidate = ledgerCandidates.get(sourceRow.sourceRowId);
    if (!linkedCandidate || linkedCandidate.classification !== "expense") {
      return conflict(
        "bill_link_invalid",
        "A paid bill must link to an expense ledger row.",
      );
    }
    if (linkedCandidate.action === "skip" && linkedCandidate.reason === "included_in_cutover_opening") {
      return conflict(
        "bill_link_unavailable",
        "The linked payment is already inside the cutover opening and cannot be replayed.",
      );
    }
    if (linkedCandidate.bookingDate !== dueDate) {
      return conflict(
        "bill_link_date_mismatch",
        "The linked payment date must equal the bill due date.",
      );
    }
    if (linkedCandidate.amountMinor !== amount.amountMinor) {
      return conflict(
        "bill_link_amount_mismatch",
        "The linked payment amount must equal the bill amount.",
      );
    }
    if (linkedCandidate.action === "conflict") {
      return conflict(
        "bill_link_invalid",
        "The linked payment has an unresolved target conflict.",
      );
    }
    return {
      candidate: candidate(row, {
        ...base,
        classification: "bill_link",
        action: "link",
        amountMinor: amount.amountMinor,
        bookingDate: dueDate,
        merchant,
        note,
        description,
        link: sourceLink.link,
        targetMovementId: linkedCandidate.targetMovementId,
        targetMovementIdempotencyKey: linkedCandidate.targetMovementIdempotencyKey,
        bill: {
          dueDate,
          paid: true,
          linkedSourceRowId: linkedCandidate.sourceRowId,
          targetObligationId: null,
          targetMovementId: linkedCandidate.targetMovementId,
          description,
        },
        reason: "bill_payment_link",
      }),
      discrepancies: [],
    };
  }

  if (sourceLink && sourceLink.targetMovementId) {
    const linked = target.movements.find(
      (movement) => movement.id === sourceLink.targetMovementId,
    );
    if (
      !linked ||
      linked.deletedAt !== null ||
      linked.kind !== "expense" ||
      linked.bookingDate !== dueDate ||
      linked.amountMinor !== amount.amountMinor
    ) {
      return conflict(
        "bill_link_invalid",
        "A linked target record must be a matching expense payment.",
      );
    }
    return {
      candidate: candidate(row, {
        ...base,
        classification: "bill_link",
        action: "link",
        amountMinor: amount.amountMinor,
        bookingDate: dueDate,
        merchant,
        note,
        description,
        link: sourceLink.link,
        targetMovementId: linked.id,
        targetMovementIdempotencyKey: linked.idempotencyKey,
        bill: {
          dueDate,
          paid: true,
          linkedSourceRowId: null,
          targetObligationId: null,
          targetMovementId: linked.id,
          description,
        },
        reason: "bill_payment_link",
      }),
      discrepancies: [],
    };
  }

  const normalizedDescription = normalizedText(description);
  const obligationMatches = target.obligations.filter(
    (obligation) =>
      obligation.state === "paid" &&
      obligation.amountMinor === amount.amountMinor &&
      obligation.dueDate === dueDate &&
      normalizedText(obligation.description) === normalizedDescription,
  );
  if (obligationMatches.length === 1) {
    return {
      candidate: candidate(row, {
        ...base,
        classification: "bill_link",
        action: "link",
        amountMinor: amount.amountMinor,
        bookingDate: dueDate,
        merchant,
        note,
        description,
        link: {
          target: "obligation",
          id: obligationMatches[0].id,
          evidence: "matched_obligation",
        },
        targetObligationId: obligationMatches[0].id,
        bill: {
          dueDate,
          paid: true,
          linkedSourceRowId: null,
          targetObligationId: obligationMatches[0].id,
          targetMovementId: obligationMatches[0].paymentExpenseId,
          description,
        },
        reason: "bill_obligation_link",
      }),
      discrepancies: [],
    };
  }
  if (obligationMatches.length > 1) {
    return conflict(
      "ambiguous_bill_link",
      "More than one paid obligation matches this bill row.",
    );
  }

  const movementMatches = target.movements.filter(
    (movement) =>
      movement.deletedAt === null &&
      movement.kind === "expense" &&
      movement.amountMinor === amount.amountMinor &&
      movement.bookingDate === dueDate &&
      normalizedDescription !== null &&
      (normalizedText(movement.note) === normalizedDescription ||
        normalizedText(movement.merchant) === normalizedDescription),
  );
  if (movementMatches.length === 1) {
    return {
      candidate: candidate(row, {
        ...base,
        classification: "bill_link",
        action: "link",
        amountMinor: amount.amountMinor,
        bookingDate: dueDate,
        merchant,
        note,
        description,
        link: {
          target: "movement",
          id: movementMatches[0].id,
          evidence: "matched_target",
        },
        targetMovementId: movementMatches[0].id,
        targetMovementIdempotencyKey: movementMatches[0].idempotencyKey,
        bill: {
          dueDate,
          paid: true,
          linkedSourceRowId: null,
          targetObligationId: null,
          targetMovementId: movementMatches[0].id,
          description,
        },
        reason: "bill_payment_link",
      }),
      discrepancies: [],
    };
  }
  if (movementMatches.length > 1) {
    return conflict(
      "ambiguous_bill_link",
      "More than one target payment matches this bill row.",
    );
  }
  return conflict(
    "bill_link_missing",
    "A paid bill must link to exactly one payment or paid obligation.",
  );
}

function buildMetadataCandidate(
  row: MoneyImportSourceRow,
): { candidate: MoneyImportCandidate; discrepancies: MoneyImportDiscrepancy[]; reportedClosing: number | null } {
  const classification = classificationFor(row.raw);
  const date = rawText(row.raw, RAW_DATE_KEYS);
  const description =
    rawText(row.raw, RAW_DESCRIPTION_KEYS) ?? rawText(row.raw, RAW_NOTE_KEYS);
  const note = rawText(row.raw, RAW_NOTE_KEYS);
  const base = candidateBase(row);

  if (classification === "derived") {
    const reported = rawAmount(row.raw, [
      "reportedClosing",
      "reportedBalance",
      "closingBalance",
    ]);
    if (reported.reason && reported.reason !== "unknown_amount") {
      return {
        candidate: candidate(row, {
          ...base,
          classification: "derived",
          action: "skip",
          bookingDate: date,
          note,
          description,
          reason: "derived_source_row",
        }),
        discrepancies: [
          {
            id: `invalid_reported_closing:${row.sourceRowId}`,
            severity: "blocking",
            code: "invalid_reported_closing",
            message: "The derived reported closing is not an exact centime amount.",
            sourceRowIds: [row.sourceRowId],
          },
        ],
        reportedClosing: null,
      };
    }
    return {
      candidate: candidate(row, {
        ...base,
        classification: "derived",
        action: "skip",
        amountMinor:
          reported.amountMinor === null ? null : Math.abs(reported.amountMinor),
        bookingDate: date,
        note,
        description,
        reason: "derived_source_row",
      }),
      discrepancies: [],
      reportedClosing: reported.amountMinor,
    };
  }

  if (classification === "settings_metadata") {
    const savingsTarget = rawAmount(row.raw, ["savingsTarget"]);
    if (
      (savingsTarget.reason && savingsTarget.reason !== "unknown_amount") ||
      (savingsTarget.amountMinor !== null && savingsTarget.amountMinor < 0)
    ) {
      return {
        candidate: candidate(row, {
          ...base,
          classification: "settings_metadata",
          action: "skip",
          bookingDate: date,
          note,
          description,
          reason: "settings_metadata_only",
        }),
        discrepancies: [
          {
            id: `invalid_settings_amount:${row.sourceRowId}`,
            severity: "blocking",
            code: "invalid_settings_amount",
            message: "The source settings amount is not an exact centime amount.",
            sourceRowIds: [row.sourceRowId],
          },
        ],
        reportedClosing: null,
      };
    }
    return {
      candidate: candidate(row, {
        ...base,
        classification: "settings_metadata",
        action: "skip",
        amountMinor:
          savingsTarget.amountMinor === null
            ? null
            : Math.abs(savingsTarget.amountMinor),
        bookingDate: date,
        note,
        description,
        reason: "settings_metadata_only",
      }),
      discrepancies: [],
      reportedClosing: null,
    };
  }

  return {
    candidate: candidate(row, {
      ...base,
      classification: "unresolved",
      action: "conflict",
      bookingDate: date,
      note,
      description,
      reason: "unresolved_row",
    }),
    discrepancies: [
      {
        id: `unresolved_row:${row.sourceRowId}`,
        severity: "blocking",
        code: "unresolved_row",
        message: "This source row does not have a supported workbook classification.",
        sourceRowIds: [row.sourceRowId],
      },
    ],
    reportedClosing: null,
  };
}

function computeCashEquation(
  candidates: readonly MoneyImportCandidate[],
  openingMinor: number | null,
  reportedClosingMinor: number | null,
): MoneyImportCashEquation {
  let incomeMinor = 0;
  let expenseMinor = 0;
  let savingsMinor = 0;
  let adjustmentNetMinor = 0;
  for (const entry of candidates) {
    if (!entry.countsTowardCashEquation) continue;
    const effect = entry.signedEffectMinor;
    if (entry.classification === "income") {
      incomeMinor += effect;
    } else if (entry.classification === "expense") {
      expenseMinor += Math.abs(effect);
    } else if (entry.classification === "savings_transfer") {
      savingsMinor += Math.abs(effect);
    } else if (entry.classification === "reconciliation_adjustment") {
      adjustmentNetMinor += effect;
    }
  }
  const openingKnown = openingMinor !== null;
  const opening = openingMinor ?? 0;
  const expectedClosingMinor =
    opening + incomeMinor - expenseMinor - savingsMinor + adjustmentNetMinor;
  const differenceMinor =
    reportedClosingMinor === null
      ? null
      : expectedClosingMinor - reportedClosingMinor;
  return {
    openingMinor: opening,
    incomeMinor,
    expenseMinor,
    savingsMinor,
    adjustmentNetMinor,
    expectedClosingMinor,
    reportedClosingMinor,
    differenceMinor,
    balanced:
      openingKnown && (differenceMinor === null || differenceMinor === 0),
    openingKnown,
  };
}

function targetBaselineFrom(target: MoneyImportTarget): MoneyImportTargetBaseline {
  const movements = target.movements
    .map((movement) =>
      Object.freeze({
        id: movement.id,
        idempotencyKey: movement.idempotencyKey,
        kind: movement.kind,
        direction: movement.direction,
        amountMinor: movement.amountMinor,
        category: movement.category,
        note: movement.note,
        merchant: movement.merchant,
        bookingDate: movement.bookingDate,
        deletedAt: movement.deletedAt,
      }),
    )
    .sort((left, right) => {
      if (left.bookingDate !== right.bookingDate) {
        return left.bookingDate < right.bookingDate ? -1 : 1;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  const obligations = target.obligations
    .map((obligation) =>
      Object.freeze({
        id: obligation.id,
        description: obligation.description,
        amountMinor: obligation.amountMinor,
        dueDate: obligation.dueDate,
        state: obligation.state,
        paymentExpenseId: obligation.paymentExpenseId,
      }),
    )
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const coffeeVisits = target.coffeeVisits
    .map((visit) =>
      Object.freeze({
        visitKey: visit.visitKey,
        localDate: visit.localDate,
        expenseIds: Object.freeze([...visit.expenseIds].sort()),
      }),
    )
    .sort((left, right) =>
      left.visitKey < right.visitKey ? -1 : left.visitKey > right.visitKey ? 1 : 0,
    );
  return Object.freeze({
    movements: Object.freeze(movements),
    obligations: Object.freeze(obligations),
    coffeeVisits: Object.freeze(coffeeVisits),
  });
}

export type BuildMoneyImportManifestInput = Readonly<{
  snapshot: MoneyImportSourceSnapshot;
  target: MoneyImportTarget;
  cutover: MoneyImportCutover;
  openingStrategy?: MoneyImportOpeningStrategy;
}>;

export function buildMoneyImportManifest(
  input: BuildMoneyImportManifestInput,
): MoneyImportManifest {
  const { snapshot, target, cutover } = input;
  const openingStrategy =
    input.openingStrategy ?? "verified_cutover_opening";
  if (!isMoneyImportOpeningStrategy(openingStrategy)) {
    throw new Error("Unsupported opening strategy.");
  }
  if (!isIsoDate(cutover.date)) {
    throw new Error("Cutover date must be a valid YYYY-MM-DD date.");
  }
  if (MONTH_RE.test(snapshot.month) === false) {
    throw new Error("Snapshot month is invalid.");
  }
  if (!snapshot.month.startsWith(cutover.date.slice(0, 7))) {
    throw new MoneyImportSourceError(
      "cutover.date",
      "cutover_outside_snapshot_month",
      "Cutover date must belong to the snapshot month.",
    );
  }

  const monthStart = monthStartOf(snapshot.month);
  const monthEnd = lastDayOfMonth(snapshot.month);
  const rowsById = new Map(snapshot.rows.map((row) => [row.sourceRowId, row]));
  const discrepancies: MoneyImportDiscrepancy[] = [];
  const pushDiscrepancy = (entry: MoneyImportDiscrepancy) => {
    if (!discrepancies.some((existing) => existing.id === entry.id)) {
      discrepancies.push(entry);
    }
  };

  const classified: ClassifiedImportRow[] = snapshot.rows.map((row) => {
    const classification = classificationFor(row.raw);
    const role = sheetRoleFor(row.sheet);
    if (!role) {
      return {
        row,
        classification: "unresolved",
        sheetBlock: {
          code: "unsupported_sheet",
          message: `Sheet "${row.sheet}" is not a supported Money import sheet.`,
        },
      };
    }
    if (!sheetAllowsClassification(role, classification)) {
      return {
        row,
        classification: "unresolved",
        sheetBlock: {
          code: "sheet_classification_mismatch",
          message: `Source row classification does not belong on sheet "${row.sheet}".`,
        },
      };
    }
    return { row, classification, sheetBlock: null };
  });
  const openingRows = classified.filter(
    (entry) => !entry.sheetBlock && entry.classification === "opening",
  );
  if (openingRows.length === 0) {
    pushDiscrepancy({
      id: "missing_opening",
      severity: "blocking",
      code: "missing_opening",
      message:
        "The workbook has no opening row. Import needs a known opening balance.",
      sourceRowIds: [],
    });
  } else if (openingRows.length > 1) {
    pushDiscrepancy({
      id: "multiple_opening_rows",
      severity: "blocking",
      code: "multiple_opening_rows",
      message:
        "The workbook has more than one opening row; keep exactly one opening balance.",
      sourceRowIds: openingRows.map((entry) => entry.row.sourceRowId),
    });
  }

  if (openingStrategy === "verified_cutover_opening") {
    if (!cutover.verified) {
      pushDiscrepancy({
        id: "cutover_not_verified",
        severity: "blocking",
        code: "cutover_not_verified",
        message: "Verified cutover opening requires verified cutover evidence.",
        sourceRowIds: [],
      });
    }
    if (!cutover.evidenceRef.trim()) {
      pushDiscrepancy({
        id: "cutover_evidence_missing",
        severity: "blocking",
        code: "cutover_evidence_missing",
        message: "Verified cutover opening requires an evidence reference.",
        sourceRowIds: [],
      });
    }
    if (cutover.uncoveredDates.length > 0) {
      pushDiscrepancy({
        id: "cutover_uncovered_dates",
        severity: "blocking",
        code: "cutover_uncovered_dates",
        message: "Cutover evidence has uncovered dates; resolve them before adopting.",
        sourceRowIds: [],
      });
    }
    const preCutoverTargets = target.movements.filter(
      (movement) =>
        movement.deletedAt === null && movement.bookingDate < cutover.date,
    );
    if (preCutoverTargets.length > 0) {
      pushDiscrepancy({
        id: "existing_pre_cutover_movement",
        severity: "blocking",
        code: "existing_pre_cutover_movement",
        message:
          "The target already has movements dated before the verified cutover. Resolve them before adopting.",
        sourceRowIds: [],
      });
    }
  }

  const preliminaryOpening = openingRows
    .map((entry) => {
      const amount = rawAmount(entry.row.raw, RAW_AMOUNT_KEYS);
      const date = rawText(entry.row.raw, RAW_DATE_KEYS);
      return {
        row: entry.row,
        date,
        amountMinor:
          amount.amountMinor === null ? null : Math.abs(amount.amountMinor),
      };
    })
    .sort((left, right) => {
      if (left.date === right.date) {
        return left.row.sourceRowId < right.row.sourceRowId ? -1 : 1;
      }
      if (left.date === null) return 1;
      if (right.date === null) return -1;
      return left.date < right.date ? -1 : 1;
    });
  let openingAmountMinor: number | null =
    preliminaryOpening.length > 0 ? preliminaryOpening[0].amountMinor : null;
  let periodStartDate = monthStart;

  if (openingStrategy === "verified_cutover_opening") {
    periodStartDate = cutover.date;
    // The verified cutover balance is the opening authority. The opening row is
    // retained as evidence and a difference is disclosed, not posted twice.
    openingAmountMinor = cutover.reportedBalanceMinor;
    if (
      preliminaryOpening.length === 1 &&
      preliminaryOpening[0].date !== cutover.date
    ) {
      pushDiscrepancy({
        id: "cutover_opening_date_mismatch",
        severity: "blocking",
        code: "cutover_opening_date_mismatch",
        message:
          "The verified opening row must book on the cutover date.",
        sourceRowIds: [preliminaryOpening[0].row.sourceRowId],
      });
    }
    if (
      preliminaryOpening.length === 1 &&
      preliminaryOpening[0].amountMinor !== null &&
      preliminaryOpening[0].amountMinor !== cutover.reportedBalanceMinor
    ) {
      pushDiscrepancy({
        id: "cutover_opening_difference",
        severity: "acknowledged",
        code: "cutover_opening_difference",
        message:
          "The verified cutover balance differs from the workbook opening row.",
        sourceRowIds: [preliminaryOpening[0].row.sourceRowId],
      });
    }
  } else if (preliminaryOpening.length > 0) {
    periodStartDate = preliminaryOpening[0].date ?? monthStart;
    if (preliminaryOpening[0].amountMinor === null) {
      openingAmountMinor = null;
    }
  }

  if (openingStrategy === "full_history" && openingRows.length === 0) {
    periodStartDate = monthStart;
  }

  const candidates: MoneyImportCandidate[] = [];
  const ledgerCandidates = new Map<string, MoneyImportCandidate>();
  let reportedClosingMinor: number | null = null;
  let reportedClosingSourceRowId: string | null = null;

  for (const entry of classified) {
    const { row, classification } = entry;
    if (entry.sheetBlock) {
      const built = buildSheetBlockedCandidate(row, entry.sheetBlock);
      candidates.push(built.candidate);
      for (const entryDiscrepancy of built.discrepancies) {
        pushDiscrepancy(entryDiscrepancy);
      }
      continue;
    }
    if (
      classification === "coffee_link" ||
      classification === "bill_link" ||
      classification === "derived" ||
      classification === "settings_metadata" ||
      classification === "unresolved"
    ) {
      continue;
    }
    const built = buildLedgerCandidate({
      row,
      classification,
      snapshot,
      openingStrategy,
      cutover,
      periodStartDate,
      monthEnd,
      targetMovements: target.movements,
    });
    candidates.push(built.candidate);
    ledgerCandidates.set(row.sourceRowId, built.candidate);
    for (const entryDiscrepancy of built.discrepancies) {
      pushDiscrepancy(entryDiscrepancy);
    }
  }

  // Two source rows must never claim the same existing target movement. Such a
  // claim is a blocking conflict; neither source row may link.
  const claims = new Map<string, string[]>();
  for (const entry of candidates) {
    if (
      cashKindFor(entry.classification) !== null &&
      (entry.action === "link" || entry.action === "skip") &&
      entry.targetMovementId
    ) {
      const queue = claims.get(entry.targetMovementId) ?? [];
      queue.push(entry.sourceRowId);
      claims.set(entry.targetMovementId, queue);
    }
  }
  for (const [targetMovementId, sourceRowIds] of claims) {
    if (sourceRowIds.length < 2) continue;
    for (const sourceRowId of sourceRowIds) {
      const index = candidates.findIndex(
        (entry) => entry.sourceRowId === sourceRowId,
      );
      if (index === -1) continue;
      const current = candidates[index];
      const conflicted = Object.freeze({
        ...current,
        action: "conflict" as const,
        targetMovementId: null,
        targetMovementIdempotencyKey: null,
        link: null,
        reason: "duplicate_target_claim",
      });
      candidates[index] = conflicted;
      ledgerCandidates.set(sourceRowId, conflicted);
      pushDiscrepancy({
        id: `duplicate_target_claim:${sourceRowId}`,
        severity: "blocking",
        code: "duplicate_target_claim",
        message:
          "More than one source row claims the same existing target movement. Resolve the duplicate before adopting.",
        sourceRowIds,
      });
    }
    void targetMovementId;
  }

  for (const entry of classified) {
    const { row, classification } = entry;
    if (entry.sheetBlock) continue;
    if (classification === "coffee_link") {
      const built = buildCoffeeCandidate({
        row,
        snapshot,
        rowsById,
        ledgerCandidates,
        target,
        monthEnd,
      });
      candidates.push(built.candidate);
      for (const entryDiscrepancy of built.discrepancies) {
        pushDiscrepancy(entryDiscrepancy);
      }
    } else if (classification === "bill_link") {
      const built = buildBillCandidate({
        row,
        rowsById,
        ledgerCandidates,
        target,
      });
      candidates.push(built.candidate);
      for (const entryDiscrepancy of built.discrepancies) {
        pushDiscrepancy(entryDiscrepancy);
      }
    } else if (
      classification === "derived" ||
      classification === "settings_metadata" ||
      classification === "unresolved"
    ) {
      const built = buildMetadataCandidate(row);
      candidates.push(built.candidate);
      for (const entryDiscrepancy of built.discrepancies) {
        pushDiscrepancy(entryDiscrepancy);
      }
      if (built.reportedClosing !== null) {
        if (reportedClosingMinor !== null && reportedClosingMinor !== built.reportedClosing) {
          pushDiscrepancy({
            id: "ambiguous_reported_closing",
            severity: "blocking",
            code: "ambiguous_reported_closing",
            message:
              "The workbook has more than one different reported closing balance.",
            sourceRowIds: reportedClosingSourceRowId
              ? [reportedClosingSourceRowId, row.sourceRowId]
              : [row.sourceRowId],
          });
        } else {
          reportedClosingMinor = built.reportedClosing;
          reportedClosingSourceRowId = row.sourceRowId;
        }
      }
    }
  }

  const cashEquation = computeCashEquation(
    candidates,
    openingAmountMinor,
    reportedClosingMinor,
  );
  if (
    cashEquation.differenceMinor !== null &&
    cashEquation.differenceMinor !== 0
  ) {
    pushDiscrepancy({
      id: "reported_balance_difference",
      severity: "acknowledged",
      code: "reported_balance_difference",
      message:
        "The reported workbook closing differs from the modeled signed closing. It is disclosed, not posted as income or expense.",
      sourceRowIds: reportedClosingSourceRowId ? [reportedClosingSourceRowId] : [],
    });
  }
  if (!cashEquation.openingKnown) {
    pushDiscrepancy({
      id: "unknown_opening",
      severity: "blocking",
      code: "unknown_opening",
      message: "Opening cash is unknown; import cannot invent a zero opening.",
      sourceRowIds: openingRows.map((entry) => entry.row.sourceRowId),
    });
  }

  const sortedCandidates = [...candidates].sort((left, right) => {
    if (left.sheet !== right.sheet) return left.sheet < right.sheet ? -1 : 1;
    return left.sourceRowId < right.sourceRowId ? -1 : left.sourceRowId > right.sourceRowId ? 1 : 0;
  });

  const rowCounts: Record<MoneyImportClassification | "total", number> = {
    opening: 0,
    income: 0,
    expense: 0,
    savings_transfer: 0,
    reconciliation_adjustment: 0,
    coffee_link: 0,
    bill_link: 0,
    settings_metadata: 0,
    derived: 0,
    unresolved: 0,
    total: sortedCandidates.length,
  };
  const kindTotals: Partial<Record<MoneyKind, number>> = {};
  const categoryTotals: Partial<Record<ExpenseCategory, number>> = {};
  const dayTotals: Record<
    string,
    { inMinor: number; outMinor: number; netMinor: number }
  > = {};
  let unknowns = 0;
  let coffeeRows = 0;
  let coffeeLinked = 0;
  let billRows = 0;
  let paidBills = 0;
  let unpaidBills = 0;
  let unresolvedBills = 0;
  let targetMovementLinks = 0;
  let obligationLinks = 0;

  for (const entry of sortedCandidates) {
    rowCounts[entry.classification] += 1;
    if (entry.classification === "unresolved") unknowns += 1;
    if (entry.classification === "coffee_link") {
      coffeeRows += 1;
      if (entry.action === "link" || entry.action === "skip") coffeeLinked += 1;
    }
    if (entry.classification === "bill_link") {
      billRows += 1;
      if (entry.bill?.paid) {
        paidBills += 1;
        if (entry.targetObligationId) obligationLinks += 1;
        if (entry.action === "conflict") unresolvedBills += 1;
      } else {
        unpaidBills += 1;
      }
    }
    if (
      entry.action === "link" &&
      entry.classification !== "coffee_link" &&
      entry.classification !== "bill_link"
    ) {
      targetMovementLinks += 1;
    }
    if (entry.countsTowardCashEquation && entry.kind !== null) {
      kindTotals[entry.kind] =
        (kindTotals[entry.kind] ?? 0) + entry.signedEffectMinor;
      if (entry.classification === "expense" && entry.category !== null) {
        categoryTotals[entry.category] =
          (categoryTotals[entry.category] ?? 0) + Math.abs(entry.signedEffectMinor);
      }
      if (entry.bookingDate !== null) {
        const day = dayTotals[entry.bookingDate] ?? {
          inMinor: 0,
          outMinor: 0,
          netMinor: 0,
        };
        if (entry.signedEffectMinor >= 0) {
          day.inMinor += entry.signedEffectMinor;
        } else {
          day.outMinor += Math.abs(entry.signedEffectMinor);
        }
        day.netMinor += entry.signedEffectMinor;
        dayTotals[entry.bookingDate] = day;
      }
    }
  }

  const sortedDiscrepancies = [...discrepancies].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const blockers = [
    ...new Set(
      sortedDiscrepancies
        .filter((entry) => entry.severity === "blocking")
        .map((entry) => entry.code),
    ),
  ].sort();

  return Object.freeze({
    version: MONEY_IMPORT_VERSION,
    snapshotId: snapshot.snapshotId,
    sourceIdentity: snapshot.sourceIdentity,
    target: Object.freeze({
      ownerId: target.ownerId,
      environment: target.environment,
    }),
    period: Object.freeze({
      startDate: periodStartDate,
      endDate: monthEnd,
      timezone: snapshot.timezone,
      activeDate:
        openingStrategy === "verified_cutover_opening"
          ? cutover.date
          : preliminaryOpening[0]?.date ?? monthStart,
      opening: Object.freeze({
        amountMinor: openingAmountMinor,
        cutoffDate:
          openingStrategy === "verified_cutover_opening"
            ? cutover.date
            : preliminaryOpening[0]?.date ?? null,
        evidence: `source:${snapshot.snapshotId}`,
      }),
    }),
    openingStrategy,
    cutover: Object.freeze({
      date: cutover.date,
      reportedBalanceMinor: cutover.reportedBalanceMinor,
      verified: cutover.verified,
      evidenceRef: cutover.evidenceRef,
      uncoveredDates: Object.freeze([...cutover.uncoveredDates]),
    }),
    targetBaseline: targetBaselineFrom(target),
    candidates: Object.freeze(sortedCandidates),
    summary: Object.freeze({
      rowCounts: Object.freeze(rowCounts),
      kindTotals: Object.freeze(kindTotals),
      categoryTotals: Object.freeze(categoryTotals),
      dayTotals: Object.freeze(dayTotals),
      cashEquation,
      linkCoverage: Object.freeze({
        coffeeRows,
        coffeeLinked,
        coffeeUnlinked: coffeeRows - coffeeLinked,
        billRows,
        paidBills,
        unpaidBills,
        unresolvedBills,
        targetMovementLinks,
        obligationLinks,
      }),
      unknowns,
    }),
    discrepancies: Object.freeze(sortedDiscrepancies),
    blockers: Object.freeze(blockers),
  });
}

/** Compare the stored baseline with a fresh owner-scoped target read. */
export function moneyImportTargetDrift(
  manifest: MoneyImportManifest,
  currentTarget: MoneyImportTarget,
): MoneyImportTargetDrift {
  const reasons: string[] = [];
  if (!manifest.targetBaseline) {
    return {
      ok: false,
      reasons: ["manifest_target_baseline_missing"],
    };
  }
  if (
    !Array.isArray(manifest.targetBaseline.movements) ||
    !Array.isArray(manifest.targetBaseline.obligations) ||
    !Array.isArray(manifest.targetBaseline.coffeeVisits)
  ) {
    return {
      ok: false,
      reasons: ["manifest_target_baseline_invalid"],
    };
  }
  if (currentTarget.ownerId !== manifest.target.ownerId) {
    reasons.push("target_owner_mismatch");
  }
  if (currentTarget.environment !== manifest.target.environment) {
    reasons.push("target_environment_mismatch");
  }

  const baselineMovements = new Map(
    manifest.targetBaseline.movements.map((movement) => [movement.id, movement]),
  );
  const currentMovementsById = new Map<string, MoneyImportTargetMovement>();
  const currentMovementIdCounts = new Map<string, number>();
  for (const movement of currentTarget.movements) {
    currentMovementsById.set(movement.id, movement);
    currentMovementIdCounts.set(
      movement.id,
      (currentMovementIdCounts.get(movement.id) ?? 0) + 1,
    );
  }
  for (const [id, count] of currentMovementIdCounts) {
    if (count > 1) reasons.push(`duplicate_target_movement_id:${id}`);
  }

  const insertPatterns = new Map<
    string,
    Readonly<{
      kind: MoneyKind;
      direction: MoneyDirection;
      amountMinor: number;
      bookingDate: string;
    }>
  >();
  for (const candidate of manifest.candidates) {
    if (
      candidate.action !== "insert" ||
      candidate.kind === null ||
      candidate.direction === null ||
      candidate.amountMinor === null ||
      candidate.bookingDate === null
    ) {
      continue;
    }
    insertPatterns.set(
      moneyImportMovementKey(manifest.snapshotId, candidate.sourceRowId),
      {
        kind: candidate.kind,
        direction: candidate.direction,
        amountMinor: candidate.amountMinor,
        bookingDate: candidate.bookingDate,
      },
    );
  }

  let openingCount = 0;
  for (const movement of currentTarget.movements) {
    const baseline = baselineMovements.get(movement.id);
    if (baseline) {
      if (
        baseline.idempotencyKey !== movement.idempotencyKey ||
        baseline.kind !== movement.kind ||
        baseline.direction !== movement.direction ||
        baseline.amountMinor !== movement.amountMinor ||
        baseline.category !== movement.category ||
        baseline.note !== movement.note ||
        baseline.merchant !== movement.merchant ||
        baseline.bookingDate !== movement.bookingDate ||
        baseline.deletedAt !== movement.deletedAt
      ) {
        reasons.push(`baseline_movement_changed:${movement.id}`);
      }
      continue;
    }

    const inserted = insertPatterns.get(movement.idempotencyKey);
    if (inserted) {
      if (
        inserted.kind !== movement.kind ||
        inserted.direction !== movement.direction ||
        inserted.amountMinor !== movement.amountMinor ||
        inserted.bookingDate !== movement.bookingDate
      ) {
        reasons.push(`import_movement_mismatch:${movement.id}`);
      }
      continue;
    }

    if (
      movement.kind === "opening" &&
      movement.direction === "in" &&
      movement.deletedAt === null &&
      movement.bookingDate === manifest.period.startDate &&
      manifest.period.opening.amountMinor !== null &&
      movement.amountMinor === manifest.period.opening.amountMinor
    ) {
      openingCount += 1;
      continue;
    }

    reasons.push(`unexpected_target_movement:${movement.id}`);
  }
  if (openingCount > 1) reasons.push("duplicate_opening_movement");

  for (const baseline of manifest.targetBaseline.movements) {
    if (!currentMovementsById.has(baseline.id)) {
      reasons.push(`baseline_movement_missing:${baseline.id}`);
    }
  }

  const currentKeyCounts = new Map<string, number>();
  for (const movement of currentTarget.movements) {
    currentKeyCounts.set(
      movement.idempotencyKey,
      (currentKeyCounts.get(movement.idempotencyKey) ?? 0) + 1,
    );
  }
  for (const [key, count] of currentKeyCounts) {
    if (count > 1) reasons.push(`duplicate_target_idempotency_key:${key}`);
  }

  const baselineObligations = new Map(
    manifest.targetBaseline.obligations.map((obligation) => [
      obligation.id,
      obligation,
    ]),
  );
  const currentObligationsById = new Map(
    currentTarget.obligations.map((obligation) => [obligation.id, obligation]),
  );
  for (const obligation of currentTarget.obligations) {
    const baseline = baselineObligations.get(obligation.id);
    if (!baseline) {
      reasons.push(`unexpected_target_obligation:${obligation.id}`);
      continue;
    }
    if (
      baseline.description !== obligation.description ||
      baseline.amountMinor !== obligation.amountMinor ||
      baseline.dueDate !== obligation.dueDate ||
      baseline.state !== obligation.state ||
      baseline.paymentExpenseId !== obligation.paymentExpenseId
    ) {
      reasons.push(`baseline_obligation_changed:${obligation.id}`);
    }
  }
  for (const baseline of manifest.targetBaseline.obligations) {
    if (!currentObligationsById.has(baseline.id)) {
      reasons.push(`baseline_obligation_missing:${baseline.id}`);
    }
  }

  const baselineCoffee = new Map(
    manifest.targetBaseline.coffeeVisits.map((visit) => [visit.visitKey, visit]),
  );
  const approvedCoffeeKeys = new Set(
    manifest.candidates
      .filter(
        (candidate) =>
          candidate.classification === "coffee_link" &&
          candidate.action !== "conflict",
      )
      .map((candidate) =>
        moneyImportCoffeeVisitKey(manifest.snapshotId, candidate.sourceRowId),
      ),
  );
  const currentCoffee = new Map(
    currentTarget.coffeeVisits.map((visit) => [visit.visitKey, visit]),
  );
  for (const visit of currentTarget.coffeeVisits) {
    const baseline = baselineCoffee.get(visit.visitKey);
    if (!baseline) {
      if (!approvedCoffeeKeys.has(visit.visitKey)) {
        reasons.push(`unexpected_target_coffee_visit:${visit.visitKey}`);
      }
      continue;
    }
    const currentExpenseIds = [...visit.expenseIds].sort();
    if (
      baseline.localDate !== visit.localDate ||
      baseline.expenseIds.length !== currentExpenseIds.length ||
      baseline.expenseIds.some(
        (expenseId: string, index: number) =>
          expenseId !== currentExpenseIds[index],
      )
    ) {
      reasons.push(`baseline_coffee_visit_changed:${visit.visitKey}`);
    }
  }
  for (const key of baselineCoffee.keys()) {
    if (!currentCoffee.has(key)) {
      reasons.push(`baseline_coffee_visit_missing:${key}`);
    }
  }

  if (reasons.length === 0) return { ok: true };
  return { ok: false, reasons: Object.freeze([...new Set(reasons)].sort()) };
}

/** Recompute the signed cash equation from the frozen candidate manifest. */
export function moneyImportCashEquation(
  manifest: MoneyImportManifest,
): MoneyImportCashEquation {
  return computeCashEquation(
    manifest.candidates,
    manifest.period.opening.amountMinor,
    manifest.summary.cashEquation.reportedClosingMinor,
  );
}

/** Stable manifest payload used for the approved manifest digest. */
export function canonicalMoneyImportManifestPayload(
  manifest: MoneyImportManifest,
): string {
  const candidates = [...manifest.candidates].sort((left, right) => {
    if (left.sheet !== right.sheet) return left.sheet < right.sheet ? -1 : 1;
    return left.sourceRowId < right.sourceRowId ? -1 : left.sourceRowId > right.sourceRowId ? 1 : 0;
  });
  const discrepancies = [...manifest.discrepancies].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  return stableJson({
    version: manifest.version,
    snapshotId: manifest.snapshotId,
    snapshotDigest: manifest.snapshotDigest,
    sourceIdentity: manifest.sourceIdentity,
    target: manifest.target,
    period: manifest.period,
    openingStrategy: manifest.openingStrategy,
    cutover: manifest.cutover,
    targetBaseline: manifest.targetBaseline,
    candidates,
    summary: manifest.summary,
    discrepancies,
    blockers: manifest.blockers,
  });
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_RE.test(value);
}

/**
 * Exact approval gate. The computed manifest digest is authoritative; the
 * approval must repeat it together with the snapshot digest, owner and
 * environment. Every blocking and acknowledged discrepancy is handled
 * explicitly.
 */
export function validateMoneyImportApproval(
  manifest: MoneyImportManifest,
  manifestDigest: string,
  approval: MoneyImportApproval | null | undefined,
  expected: MoneyImportApprovalExpected,
): MoneyImportApprovalValidation {
  if (!approval || typeof approval !== "object") {
    return {
      ok: false,
      code: "validation",
      reason: "missing_approval",
      message: "An explicit approved manifest is required before any write.",
    };
  }
  if (approval.status !== "approved") {
    return {
      ok: false,
      code: "validation",
      reason: "not_approved",
      message: "The manifest is not approved.",
    };
  }
  if (
    typeof approval.manifestDigest !== "string" ||
    typeof approval.snapshotDigest !== "string" ||
    typeof approval.ownerId !== "string" ||
    typeof approval.environment !== "string" ||
    typeof approval.approvedAt !== "string" ||
    typeof approval.approvedBy !== "string" ||
    !Array.isArray(approval.acknowledgedDiscrepancyIds)
  ) {
    return {
      ok: false,
      code: "validation",
      reason: "invalid_approval",
      message: "The approval record is incomplete.",
    };
  }
  if (
    approval.manifestDigest !== manifestDigest ||
    !isDigest(approval.manifestDigest)
  ) {
    return {
      ok: false,
      code: "conflict",
      reason: "manifest_digest_mismatch",
      message: "The approved manifest digest does not match the recomputed manifest.",
    };
  }
  if (approval.snapshotDigest !== expected.snapshotDigest) {
    return {
      ok: false,
      code: "conflict",
      reason: "snapshot_digest_mismatch",
      message: "The approved snapshot digest does not match the frozen snapshot.",
    };
  }
  if (
    approval.ownerId !== expected.ownerId ||
    manifest.target.ownerId !== expected.ownerId
  ) {
    return {
      ok: false,
      code: "forbidden",
      reason: "owner_mismatch",
      message: "The approval owner does not match the authenticated owner.",
    };
  }
  if (
    approval.environment !== expected.environment ||
    manifest.target.environment !== expected.environment
  ) {
    return {
      ok: false,
      code: "conflict",
      reason: "environment_mismatch",
      message: "The approval environment does not match the expected environment.",
    };
  }

  const blocking = manifest.discrepancies.filter(
    (entry) => entry.severity === "blocking",
  );
  if (blocking.length > 0) {
    return {
      ok: false,
      code: "conflict",
      reason: "blocking_discrepancies",
      message: "The manifest still has blocking discrepancies.",
    };
  }

  const acknowledged = manifest.discrepancies.filter(
    (entry) => entry.severity === "acknowledged",
  );
  const approvedIds = new Set(
    approval.acknowledgedDiscrepancyIds.filter(
      (entry): entry is string => typeof entry === "string",
    ),
  );
  const missing = acknowledged
    .filter((entry) => !approvedIds.has(entry.id))
    .map((entry) => entry.id);
  if (missing.length > 0) {
    return {
      ok: false,
      code: "validation",
      reason: "unacknowledged_discrepancies",
      message: "Every acknowledged discrepancy must be listed in the approval.",
    };
  }

  return {
    ok: true,
    acknowledgedDiscrepancyIds: acknowledged.map((entry) => entry.id),
  };
}
