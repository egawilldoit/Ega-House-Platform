import {
  getLocalDayWindow,
  getWeekWindow,
  isIsoDate,
  isValidIANATimeZone,
} from "./time-context";
import {
  EXPENSE_CATEGORY_VALUES,
  type ExpenseCategory,
  type ExpenseNeedVsWant,
} from "./expenses";

/**
 * Canonical Money contract (MONEY-01 → MONEY-14 shared contract).
 *
 * The frozen movement vocabulary below is the single source of truth for the
 * additive `personal_expenses` money ledger. MONEY-05 extends it with the
 * category/reporting taxonomy, period budget allocations and counted coffee
 * visits. Nothing here reclassifies a stored expense or invents a value.
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

/**
 * Shared ledger row shape. MONEY-05 does not write movement rows directly; it
 * reads canonical spending and keeps this contract stable for MONEY-04.
 */
export type MoneyLedgerRow = {
  id: string;
  kind: MoneyKind;
  direction: MoneyDirection;
  amountMinor: number;
  currency: typeof MONEY_CURRENCY;
  category: ExpenseCategory | null;
  note: string | null;
  merchant: string | null;
  needVsWant: ExpenseNeedVsWant | null;
  paymentMethod: string | null;
  purpose: MoneyPurpose | null;
  countsInDaily: boolean;
  bookingDate: string;
  occurredAt: string | null;
  periodId: string | null;
  version: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/* Category taxonomy and handoff mapping                              */
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

export type MoneyBudgetPlan = Readonly<{
  id: string;
  periodStartDate: string;
  periodEndDate: string;
  currency: typeof MONEY_CURRENCY;
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
  periodStartDate: string;
  periodEndDate: string;
  allocations: MoneyBudgetAllocations;
  savingsTargetMinor: number | null;
  emergencyTargetMinor: number | null;
  coffeeWeeklySpendLimitMinor: number | null;
  coffeeWeeklyVisitLimit: number | null;
}>;

export type MoneyBudgetPlanSaveValues = MoneyBudgetPlanValues &
  Readonly<{ expectedVersion: number }>;

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

export type MoneyValidationFailure = Readonly<{
  ok: false;
  field: string;
  message: string;
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

export function isMoneyBudgetAmountMinor(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MONEY_BUDGET_AMOUNT_MAX
  );
}

function parseOptionalAmount(
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

function parseExpectedVersion(
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
    if (!(EXPENSE_CATEGORY_VALUES as readonly string[]).includes(category)) {
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
  const version = parseExpectedVersion(input.version);
  if (!version.ok) return version;
  const allocations = parseAllocations(input.allocations, { allowNullValues: false });
  if (!allocations.ok) return allocations;
  const savings = parseOptionalAmount(input.savingsTargetMinor, "savingsTargetMinor");
  if (!savings.ok) return savings;
  const emergency = parseOptionalAmount(
    input.emergencyTargetMinor,
    "emergencyTargetMinor",
  );
  if (!emergency.ok) return emergency;
  const coffeeSpend = parseOptionalAmount(
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
  const version = parseExpectedVersion(input.version);
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
    value.allocations = allocations.value;
    hasChange = true;
  }
  if (input.savingsTargetMinor !== undefined) {
    const parsed = parseOptionalAmount(
      input.savingsTargetMinor,
      "savingsTargetMinor",
    );
    if (!parsed.ok) return parsed;
    value.savingsTargetMinor = parsed.value;
    hasChange = true;
  }
  if (input.emergencyTargetMinor !== undefined) {
    const parsed = parseOptionalAmount(
      input.emergencyTargetMinor,
      "emergencyTargetMinor",
    );
    if (!parsed.ok) return parsed;
    value.emergencyTargetMinor = parsed.value;
    hasChange = true;
  }
  if (input.coffeeWeeklySpendLimitMinor !== undefined) {
    const parsed = parseOptionalAmount(
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function parseOptionalNote(
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
  const note = parseOptionalNote(input.note);
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
  currency: typeof MONEY_CURRENCY;
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
  const version = parseExpectedVersion(input.version);
  if (!version.ok) return version;
  if (
    typeof input.category !== "string" ||
    !(EXPENSE_CATEGORY_VALUES as readonly string[]).includes(input.category)
  ) {
    return failure("category", "Choose a supported category.");
  }
  let note: string | null | undefined;
  if (input.note !== undefined) {
    const parsed = parseOptionalNote(input.note);
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
      category: input.category as ExpenseCategory,
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
  visitLimitMinor: number | null;
}>;

const COFFEE_WINDOW_KEYS = new Set([
  "localDate",
  "timezone",
  "periodStartDate",
  "periodEndDate",
  "spendLimitMinor",
  "visitLimitMinor",
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
  const spendLimit = parseOptionalAmount(
    input.spendLimitMinor,
    "spendLimitMinor",
  );
  if (!spendLimit.ok) return spendLimit;
  const visitLimit = parseVisitLimit(input.visitLimitMinor, "visitLimitMinor");
  if (!visitLimit.ok) return visitLimit;
  return {
    ok: true,
    value: {
      localDate: input.localDate.trim(),
      timezone: input.timezone.trim(),
      periodStartDate: period.startDate,
      periodEndDate: period.endDate,
      spendLimitMinor: spendLimit.value,
      visitLimitMinor: visitLimit.value,
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
  if (
    typeof limitRaw !== "number" ||
    !Number.isInteger(limitRaw) ||
    limitRaw < 1 ||
    limitRaw > MONEY_COFFEE_LIST_MAX_LIMIT
  ) {
    return failure(
      "limit",
      `limit must be a whole number between 1 and ${MONEY_COFFEE_LIST_MAX_LIMIT}.`,
    );
  }
  const offsetRaw = input.offset === undefined ? 0 : input.offset;
  if (
    typeof offsetRaw !== "number" ||
    !Number.isInteger(offsetRaw) ||
    offsetRaw < 0
  ) {
    return failure("offset", "offset must be a non-negative whole number.");
  }
  return {
    ok: true,
    value: {
      from: period.startDate,
      to: period.endDate,
      limit: limitRaw,
      offset: offsetRaw,
    },
  };
}
