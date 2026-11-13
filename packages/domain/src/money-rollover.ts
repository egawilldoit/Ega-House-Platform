import type {
  MoneyOpeningInput,
  MoneyPeriod,
  MoneyPeriodSettings,
} from "./money";
import {
  MONEY_CURRENCY,
  MONEY_PERIOD_MAX_DAYS,
  parseMoneySettings,
} from "./money";
import {
  addDaysToIsoDate,
  getWeekWindow,
  isIsoDate,
  isValidIANATimeZone,
} from "./time-context";

/**
 * Explicit period rollover (MONEY-10).
 *
 * Rollover is a manual, owner-confirmed operation. It never runs implicitly on
 * a date boundary and it never recreates historical rows:
 *   * the source period must be finished (`lifecycle = 'ended'`, every day
 *     closed, `activeDate = endDate`), which MONEY-09's final-day close
 *     produces;
 *   * exactly one successor period and one opening movement are created, so a
 *     carried balance is never both an opening and duplicated income;
 *   * generated obligation occurrences come from the canonical template rules
 *     and carry a new period identity;
 *   * unpaid source occurrences are an explicit owner choice, never a silent
 *     drop and never a copied paid expense;
 *   * unused daily allowance carryover is off: period opening cash and daily
 *     allowance are different concepts.
 *
 * Historical corrections after rollover are handled by the canonical database
 * trigger in `0107_money_10_period_rollover.sql`: a pre-cutoff source correction
 * posts a provenance-linked `reconciliation_adjustment` into derived successors
 * and stops at an independently verified opening, where it only discloses the
 * variance. Post-cutoff corrections never bridge a balance that never included
 * them.
 */

export const MONEY_ROLLOVER_UNPAID_TREATMENTS = [
  "keep_pending",
  "carry_forward",
  "cancel",
] as const;
export type MoneyRolloverUnpaidTreatment =
  (typeof MONEY_ROLLOVER_UNPAID_TREATMENTS)[number];

export const MONEY_ROLLOVER_OPENING_MODES = [
  "carry_forward",
  "verified_source",
] as const;
export type MoneyRolloverOpeningMode =
  (typeof MONEY_ROLLOVER_OPENING_MODES)[number];

export const MONEY_ROLLOVER_OPERATION_ID_MAX_LENGTH = 128;
export const MONEY_ROLLOVER_REASON_MAX_LENGTH = 200;
export const MONEY_ROLLOVER_ACCEPTED_DIFFERENCE_MAX_LENGTH = 500;

export type MoneyRolloverUnpaidTreatmentChoice = Readonly<{
  treatment: MoneyRolloverUnpaidTreatment;
  /** Required when cancelling or carrying forward; retained as provenance. */
  reason?: string | null;
}>;

export type MoneyRolloverOpeningChoice =
  | Readonly<{
      mode: "carry_forward";
    }>
  | Readonly<{
      mode: "verified_source";
      amountMinor: number;
      /** Verified cash date, at or after the source period's end date. */
      cutoffDate: string;
      evidence: string;
      note?: string | null;
    }>;

export type MoneyRolloverValues = Readonly<{
  sourcePeriodId: string;
  expectedVersion: number;
  /** Inclusive successor dates. Defaults are derived from the source period. */
  startDate: string;
  endDate: string;
  opening: MoneyRolloverOpeningChoice;
  /** Explicit owner choice for source occurrences that are still unpaid. */
  unpaidItems: MoneyRolloverUnpaidTreatmentChoice | null;
  /** Settings copied to the successor period; never a hidden policy change. */
  settingsOverrides: MoneyPeriodSettings | null;
  /** Required when the chosen start leaves unowned days after the source end. */
  allowUncoveredDays: boolean;
  /**
   * Explicit acceptance of a modeled-versus-verified closing difference. The
   * note is retained as provenance; without it a difference blocks rollover.
   */
  acceptClosingDifferenceNote: string | null;
}>;

export type MoneyRolloverTargets = Readonly<{
  startDate: string;
  endDate: string;
  activeDate: string;
  timezone: string;
  inclusiveDays: number;
  /** Calendar days between the source end and the chosen start, exclusive. */
  uncoveredDays: number;
}>;

export type MoneyRolloverValidationFailure = Readonly<{
  ok: false;
  field: string;
  message: string;
}>;

export type MoneyRolloverValidationSuccess = Readonly<{
  ok: true;
  value: MoneyRolloverValues;
}>;

function failure(
  field: string,
  message: string,
): MoneyRolloverValidationFailure {
  return { ok: false, field, message };
}

export function isMoneyRolloverUnpaidTreatment(
  value: unknown,
): value is MoneyRolloverUnpaidTreatment {
  return (
    typeof value === "string" &&
    (MONEY_ROLLOVER_UNPAID_TREATMENTS as readonly string[]).includes(value)
  );
}

export function isMoneyRolloverOpeningMode(
  value: unknown,
): value is MoneyRolloverOpeningMode {
  return (
    typeof value === "string" &&
    (MONEY_ROLLOVER_OPENING_MODES as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inclusiveDayCount(startDate: string, endDate: string): number {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) return 0;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

function isoParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Default successor dates. A full calendar-month source maps to the same
 * number of full calendar months, so January 1–31 becomes February 1–28/29
 * rather than a 31-day March spill. Every other (partial) source keeps its
 * inclusive length, which is what the documented partial-period behavior
 * requires.
 */
export function defaultMoneyRolloverRange(source: Pick<MoneyPeriod, "startDate" | "endDate">): {
  startDate: string;
  endDate: string;
} {
  const startDate = addDaysToIsoDate(source.endDate, 1);
  const sourceStart = isoParts(source.startDate);
  const sourceEnd = isoParts(source.endDate);
  const fullMonths =
    sourceStart.day === 1 &&
    sourceEnd.day === daysInMonth(sourceEnd.year, sourceEnd.month);
  if (fullMonths) {
    const monthSpan =
      (sourceEnd.year - sourceStart.year) * 12 +
      (sourceEnd.month - sourceStart.month) +
      1;
    const successorStart = isoParts(startDate);
    const endMonthIndex = successorStart.month - 1 + (monthSpan - 1);
    const endYear = successorStart.year + Math.floor(endMonthIndex / 12);
    const endMonth = (endMonthIndex % 12) + 1;
    const endDay = daysInMonth(endYear, endMonth);
    return {
      startDate,
      endDate: `${String(endYear).padStart(4, "0")}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
    };
  }
  const length = inclusiveDayCount(source.startDate, source.endDate);
  return {
    startDate,
    endDate: addDaysToIsoDate(startDate, Math.max(length, 1) - 1),
  };
}

/** A finished period is the only legal rollover source. */
export function moneyRolloverSourceFailure(
  source: Pick<MoneyPeriod, "lifecycle" | "activeDate" | "endDate">,
): MoneyRolloverValidationFailure | null {
  if (source.lifecycle === "rolled_over") {
    return failure(
      "sourcePeriodId",
      "This period was already rolled over. Continue from its successor instead of rolling it over twice.",
    );
  }
  if (source.lifecycle === "tracking") {
    return failure(
      "sourcePeriodId",
      "Close the final day of this period before rolling it over. Rollover is explicit and never replaces a day close.",
    );
  }
  if (source.activeDate !== source.endDate) {
    return failure(
      "sourcePeriodId",
      `This period is ended but its active date is ${source.activeDate}, not its end date ${source.endDate}. Finish closing its tracked days first.`,
    );
  }
  return null;
}

export function validateMoneyRolloverTargets(input: Readonly<{
  source: Pick<MoneyPeriod, "startDate" | "endDate" | "timezone">;
  startDate: string;
  endDate: string;
  allowUncoveredDays: boolean;
  existingRanges?: readonly Readonly<{ startDate: string; endDate: string }>[];
}>): { ok: true; value: MoneyRolloverTargets } | MoneyRolloverValidationFailure {
  const { startDate, endDate } = input;
  if (!isIsoDate(startDate)) {
    return failure("startDate", "Use a valid YYYY-MM-DD successor start date.");
  }
  if (!isIsoDate(endDate)) {
    return failure("endDate", "Use a valid YYYY-MM-DD successor end date.");
  }
  if (endDate < startDate) {
    return failure("endDate", "The successor end date must be on or after its start.");
  }
  const inclusiveDays = inclusiveDayCount(startDate, endDate);
  if (inclusiveDays < 1) {
    return failure("startDate", "The successor period must cover at least one day.");
  }
  if (inclusiveDays > MONEY_PERIOD_MAX_DAYS) {
    return failure(
      "endDate",
      `A Money period can cover at most ${MONEY_PERIOD_MAX_DAYS} days.`,
    );
  }
  const minimumStart = addDaysToIsoDate(input.source.endDate, 1);
  if (startDate < minimumStart) {
    return failure(
      "startDate",
      `The successor must start on or after ${minimumStart}, the day after the source period ends.`,
    );
  }
  const uncoveredDays = inclusiveDayCount(minimumStart, addDaysToIsoDate(startDate, -1));
  if (uncoveredDays > 0 && !input.allowUncoveredDays) {
    return failure(
      "startDate",
      `${uncoveredDays} day${uncoveredDays === 1 ? "" : "s"} between ${input.source.endDate} and ${startDate} would belong to no period. Start on ${minimumStart} or explicitly allow the uncovered days.`,
    );
  }
  for (const range of input.existingRanges ?? []) {
    if (startDate <= range.endDate && endDate >= range.startDate) {
      return failure(
        "startDate",
        `The successor dates overlap the period ${range.startDate}–${range.endDate}.`,
      );
    }
  }
  return {
    ok: true,
    value: {
      startDate,
      endDate,
      activeDate: startDate,
      timezone: input.source.timezone,
      inclusiveDays,
      uncoveredDays: Math.max(0, uncoveredDays),
    },
  };
}

/** Parse the canonical rollover write request. Dates are finalized by the caller. */
export function parseMoneyRolloverInput(input: unknown): MoneyRolloverValidationSuccess | MoneyRolloverValidationFailure {
  if (!isRecord(input)) {
    return failure("input", "A rollover request object is required.");
  }
  const sourcePeriodId = input.sourcePeriodId;
  if (typeof sourcePeriodId !== "string" || !sourcePeriodId.trim()) {
    return failure("sourcePeriodId", "A source period ID is required.");
  }
  const expectedVersion = input.expectedVersion;
  if (
    typeof expectedVersion !== "number" ||
    !Number.isInteger(expectedVersion) ||
    expectedVersion < 1
  ) {
    return failure(
      "expectedVersion",
      "The source period version you read is required and must be a positive integer.",
    );
  }
  if (typeof input.startDate !== "string" || !isIsoDate(input.startDate)) {
    return failure("startDate", "Use a valid YYYY-MM-DD successor start date.");
  }
  if (typeof input.endDate !== "string" || !isIsoDate(input.endDate)) {
    return failure("endDate", "Use a valid YYYY-MM-DD successor end date.");
  }
  if (typeof input.allowUncoveredDays !== "boolean") {
    return failure(
      "allowUncoveredDays",
      "State explicitly whether days between the source and successor may belong to no period.",
    );
  }

  const openingRaw = input.opening;
  if (!isRecord(openingRaw) || !isMoneyRolloverOpeningMode(openingRaw.mode)) {
    return failure(
      "opening.mode",
      "Choose a successor opening: carry_forward or verified_source.",
    );
  }
  let opening: MoneyRolloverOpeningChoice;
  if (openingRaw.mode === "carry_forward") {
    opening = { mode: "carry_forward" };
  } else {
    const amountMinor = openingRaw.amountMinor;
    if (
      typeof amountMinor !== "number" ||
      !Number.isInteger(amountMinor) ||
      amountMinor < 0 ||
      amountMinor > 2_147_483_647
    ) {
      return failure(
        "opening.amountMinor",
        "A verified opening needs a whole non-negative MAD centime amount.",
      );
    }
    if (typeof openingRaw.cutoffDate !== "string" || !isIsoDate(openingRaw.cutoffDate)) {
      return failure(
        "opening.cutoffDate",
        "A verified opening needs the date its balance was verified.",
      );
    }
    if (typeof openingRaw.evidence !== "string" || !openingRaw.evidence.trim()) {
      return failure(
        "opening.evidence",
        "A verified opening needs retained evidence; a bare amount is not verified.",
      );
    }
    if (openingRaw.evidence.trim().length > 500) {
      return failure("opening.evidence", "Opening evidence is limited to 500 characters.");
    }
    if (
      openingRaw.note !== undefined &&
      openingRaw.note !== null &&
      (typeof openingRaw.note !== "string" || openingRaw.note.length > 500)
    ) {
      return failure("opening.note", "Opening note is limited to 500 characters.");
    }
    opening = {
      mode: "verified_source",
      amountMinor,
      cutoffDate: openingRaw.cutoffDate,
      evidence: openingRaw.evidence.trim(),
      note: typeof openingRaw.note === "string" ? openingRaw.note : null,
    };
  }

  let unpaidItems: MoneyRolloverUnpaidTreatmentChoice | null = null;
  if (input.unpaidItems !== undefined && input.unpaidItems !== null) {
    if (!isRecord(input.unpaidItems) || !isMoneyRolloverUnpaidTreatment(input.unpaidItems.treatment)) {
      return failure(
        "unpaidItems.treatment",
        "Choose keep_pending, carry_forward or cancel for unpaid source occurrences.",
      );
    }
    const reasonRaw = input.unpaidItems.reason;
    if (
      reasonRaw !== undefined &&
      reasonRaw !== null &&
      (typeof reasonRaw !== "string" || reasonRaw.length > MONEY_ROLLOVER_REASON_MAX_LENGTH)
    ) {
      return failure(
        "unpaidItems.reason",
        `The unpaid-item reason is limited to ${MONEY_ROLLOVER_REASON_MAX_LENGTH} characters.`,
      );
    }
    const treatment = input.unpaidItems.treatment;
    if (treatment !== "keep_pending" && !(typeof reasonRaw === "string" && reasonRaw.trim())) {
      return failure(
        "unpaidItems.reason",
        "Cancelling or carrying forward unpaid occurrences needs a retained reason.",
      );
    }
    unpaidItems = {
      treatment,
      reason: typeof reasonRaw === "string" ? reasonRaw.trim() : null,
    };
  }

  let settingsOverrides: MoneyPeriodSettings | null = null;
  if (input.settingsOverrides !== undefined && input.settingsOverrides !== null) {
    const parsedSettings = parseMoneySettings(input.settingsOverrides);
    if (!parsedSettings.ok) {
      return failure("settingsOverrides", parsedSettings.message);
    }
    settingsOverrides = parsedSettings.value;
  }

  let acceptClosingDifferenceNote: string | null = null;
  if (
    input.acceptClosingDifferenceNote !== undefined &&
    input.acceptClosingDifferenceNote !== null
  ) {
    if (
      typeof input.acceptClosingDifferenceNote !== "string" ||
      input.acceptClosingDifferenceNote.trim().length < 3 ||
      input.acceptClosingDifferenceNote.length > MONEY_ROLLOVER_ACCEPTED_DIFFERENCE_MAX_LENGTH
    ) {
      return failure(
        "acceptClosingDifferenceNote",
        `Accepting a closing difference needs a retained note of 3–${MONEY_ROLLOVER_ACCEPTED_DIFFERENCE_MAX_LENGTH} characters.`,
      );
    }
    acceptClosingDifferenceNote = input.acceptClosingDifferenceNote.trim();
  }

  return {
    ok: true,
    value: {
      sourcePeriodId: sourcePeriodId.trim(),
      expectedVersion,
      startDate: input.startDate,
      endDate: input.endDate,
      opening,
      unpaidItems,
      settingsOverrides,
      allowUncoveredDays: input.allowUncoveredDays,
      acceptClosingDifferenceNote,
    },
  };
}

/** Copy the source policy explicitly; the successor never inherits silently. */
export function resolveMoneyRolloverSettings(
  source: MoneyPeriodSettings,
  overrides: MoneyPeriodSettings | null,
): MoneyPeriodSettings {
  return { ...source, ...(overrides ?? {}) };
}

/** Provenance-linked successor opening from the modeled closing balance. */
export function buildCarryForwardOpening(input: Readonly<{
  sourcePeriodId: string;
  sourceEndDate: string;
  closingCashMinor: number;
}>): MoneyOpeningInput {
  if (!Number.isInteger(input.closingCashMinor) || input.closingCashMinor < 0) {
    throw new Error("A carry-forward opening needs a known non-negative closing cash amount.");
  }
  return {
    amountMinor: input.closingCashMinor,
    source: "carry_forward",
    cutoffDate: input.sourceEndDate,
    evidence: null,
    note: `Carried forward from period ${input.sourcePeriodId}; modeled recorded cash at ${input.sourceEndDate}.`,
  };
}

/** Independently verified successor opening, retaining its evidence and cutoff. */
export function buildVerifiedRolloverOpening(
  opening: Extract<MoneyRolloverOpeningChoice, { mode: "verified_source" }>,
  source: Pick<MoneyPeriod, "startDate" | "endDate">,
): MoneyOpeningInput {
  return {
    amountMinor: opening.amountMinor,
    source: "verified_source",
    cutoffDate: opening.cutoffDate,
    evidence: opening.evidence,
    note:
      opening.note ??
      `Verified balance for the successor of ${source.startDate}–${source.endDate}.`,
  };
}

export type MoneyRolloverDifference = Readonly<{
  code:
    | "modeled_vs_verified_closing_cash"
    | "unknown_closing_cash"
    | "unpaid_occurrences"
    | "close_snapshot_restatement"
    | "incomplete_close_evidence"
    | "paid_obligation_payment_mismatch"
    | "counted_coffee_visit_mismatch"
    | "savings_target_vs_transfers";
  amountMinor: number | null;
  status: "ok" | "choice_required" | "accepted" | "unavailable";
  message: string;
}>;

export type MoneyRolloverReconciliation = Readonly<{
  currency: "MAD";
  cutoffDate: string;
  modeledClosingCashMinor: number | null;
  verifiedClosingCashMinor: number | null;
  differenceMinor: number | null;
  differenceAccepted: boolean;
  pendingOccurrenceCount: number;
  pendingOccurrenceMinor: number;
  /** Explicit list of unresolved inputs the owner must decide. */
  choices: readonly string[];
  /** Reasons rollover cannot proceed until the source state changes. */
  blockers: readonly string[];
  differences: readonly MoneyRolloverDifference[];
}>;

/**
 * MONEY-09 close evidence read for rollover. A close snapshot is compared with
 * the live restated totals for its date; an unavailable comparison is reported
 * as such instead of being treated as a passed check.
 */
export type MoneyRolloverCloseSnapshotDifference = Readonly<{
  closeId: string;
  closeDate: string;
  changedFields: readonly string[];
}>;

export type MoneyRolloverCloseSnapshotAssessment =
  | Readonly<{
      available: true;
      closeCount: number;
      /** Inclusive days in the source period that each need retained close evidence. */
      requiredCloseCount: number;
      completeCloseEvidence: boolean;
      lastClosedDate: string | null;
      comparableToRestatedTotals: true;
      restatedDifferenceCount: number;
      restatedDifferences: readonly MoneyRolloverCloseSnapshotDifference[];
      /** Paid occurrences checked against their one canonical ledger payment. */
      paidObligationCount: number;
      paidObligationMismatchCount: number;
      /** Counted coffee visits checked against their live ledger lines. */
      countedVisitCount: number;
      countedVisitMismatchCount: number;
      /** Period savings target and the actual posted savings transfers. */
      savingsTargetMinor: number | null;
      savingsTransferredMinor: number;
    }>
  | Readonly<{ available: false; reason: string }>;

/**
 * Compare the modeled closing balance with every supplied reconciliation input.
 * Unknown is never zero: a missing source opening blocks a carry-forward and is
 * reported instead of being modeled as a zero balance.
 */
export function assessMoneyRollover(input: Readonly<{
  cutoffDate: string;
  modeledClosingCashMinor: number | null;
  verifiedClosingCashMinor: number | null;
  differenceAccepted: boolean;
  pendingOccurrences: readonly Pick<
    { id: string; amountMinor: number },
    "id" | "amountMinor"
  >[];
  unpaidChoice: MoneyRolloverUnpaidTreatmentChoice | null;
  openingMode: MoneyRolloverOpeningMode;
  closeSnapshots: MoneyRolloverCloseSnapshotAssessment;
}>): MoneyRolloverReconciliation {
  const choices: string[] = [];
  const blockers: string[] = [];
  const differences: MoneyRolloverDifference[] = [];

  const pendingOccurrenceMinor = input.pendingOccurrences.reduce(
    (total, occurrence) => total + occurrence.amountMinor,
    0,
  );

  if (input.modeledClosingCashMinor === null) {
    if (input.openingMode === "carry_forward") {
      blockers.push(
        "Closing cash is unknown because the source opening is unknown. Supply a verified opening or initialize the source period first.",
      );
    }
    differences.push({
      code: "unknown_closing_cash",
      amountMinor: null,
      status: "unavailable",
      message:
        "Closing cash is unknown. It is not treated as zero; the successor needs a verified opening.",
    });
  }

  let differenceMinor: number | null = null;
  if (
    input.modeledClosingCashMinor !== null &&
    input.verifiedClosingCashMinor !== null
  ) {
    differenceMinor =
      input.verifiedClosingCashMinor - input.modeledClosingCashMinor;
    differences.push({
      code: "modeled_vs_verified_closing_cash",
      amountMinor: differenceMinor,
      status:
        differenceMinor === 0
          ? "ok"
          : input.differenceAccepted
            ? "accepted"
            : "choice_required",
      message:
        differenceMinor === 0
          ? "Modeled closing cash matches the verified balance."
          : `The verified closing balance differs from the modeled cash by ${differenceMinor} centimes. Resolve the difference or explicitly accept it with retained provenance.`,
    });
    if (differenceMinor !== 0 && !input.differenceAccepted) {
      choices.push(
        "Accept the modeled-versus-verified closing cash difference explicitly, or correct the ledger first.",
      );
    }
  }

  if (input.pendingOccurrences.length > 0) {
    const accepted = input.unpaidChoice !== null;
    differences.push({
      code: "unpaid_occurrences",
      amountMinor: pendingOccurrenceMinor,
      status: accepted ? "accepted" : "choice_required",
      message: `${input.pendingOccurrences.length} source occurrence${input.pendingOccurrences.length === 1 ? " is" : "s are"} still unpaid (${pendingOccurrenceMinor} centimes). Keep them in the source period, carry them forward as new pending occurrences, or cancel them explicitly.`,
    });
    if (!accepted) {
      choices.push(
        "Choose keep_pending, carry_forward or cancel for unpaid source occurrences.",
      );
    }
  }

  const closeSnapshot = input.closeSnapshots;
  const completeCloseEvidence = closeSnapshot.available
    ? closeSnapshot.completeCloseEvidence
    : false;

  if (!closeSnapshot.available) {
    differences.push({
      code: "close_snapshot_restatement",
      amountMinor: null,
      status: "unavailable",
      message: `Stored day-close snapshots are unavailable (${closeSnapshot.reason}), so the required close-to-restated comparison cannot run.`,
    });
    blockers.push(
      "The source period needs retained day-close evidence with a comparable restatement before it can be rolled over.",
    );
  } else if (!closeSnapshot.comparableToRestatedTotals) {
    differences.push({
      code: "close_snapshot_restatement",
      amountMinor: null,
      status: "unavailable",
      message:
        "Stored day-close snapshots could not be compared with live restated totals.",
    });
    blockers.push(
      "The close-to-restated comparison is incomplete. Repair the source ledger or close evidence before rolling over.",
    );
  } else {
    if (!completeCloseEvidence) {
      const required = closeSnapshot.requiredCloseCount;
      differences.push({
        code: "incomplete_close_evidence",
        amountMinor: null,
        status: "unavailable",
        message: `Only ${closeSnapshot.closeCount} of ${required ?? "the required"} source days have retained close evidence. Every tracked day must be closed before rollover.`,
      });
      blockers.push(
        "Every tracked source day needs retained close evidence before rollover. Close the missing days first.",
      );
    } else if (closeSnapshot.restatedDifferenceCount > 0) {
      const changed = closeSnapshot.restatedDifferenceCount;
      const accepted = input.differenceAccepted;
      differences.push({
        code: "close_snapshot_restatement",
        amountMinor: null,
        status: accepted ? "accepted" : "choice_required",
        message: `${changed} stored day close${changed === 1 ? "" : "s"} no longer match${changed === 1 ? "es" : ""} the live restated totals. The original close evidence stays retained; accept the restatement explicitly or correct the ledger before rolling over.`,
      });
      if (!accepted) {
        choices.push(
          "Review the restated close snapshots and accept them with a retained note, or correct the affected source movements first.",
        );
      }
    } else {
      differences.push({
        code: "close_snapshot_restatement",
        amountMinor: null,
        status: "ok",
        message: `${closeSnapshot.closeCount} stored day close${closeSnapshot.closeCount === 1 ? "" : "s"} match the live restated totals.`,
      });
    }

    // Paid obligations, counted visits and the savings target are independent
    // reconciliation inputs. A restated close or its acceptance note must never
    // hide a payment or visit mismatch.
    if (closeSnapshot.paidObligationMismatchCount > 0) {
      const mismatched = closeSnapshot.paidObligationMismatchCount;
      differences.push({
        code: "paid_obligation_payment_mismatch",
        amountMinor: null,
        status: input.differenceAccepted ? "accepted" : "choice_required",
        message: `${mismatched} paid obligation${mismatched === 1 ? " does" : "s do"} not match exactly one live canonical payment. Review the MONEY-07 payment links before rolling over.`,
      });
      if (!input.differenceAccepted) {
        choices.push(
          "Resolve or explicitly accept the paid-obligation payment mismatches before rollover.",
        );
      }
    }

    if (closeSnapshot.countedVisitMismatchCount > 0) {
      const mismatched = closeSnapshot.countedVisitMismatchCount;
      differences.push({
        code: "counted_coffee_visit_mismatch",
        amountMinor: null,
        status: input.differenceAccepted ? "accepted" : "choice_required",
        message: `${mismatched} counted coffee visit${mismatched === 1 ? "" : "s"} no longer link to a live ledger expense. Review the visit lines before rolling over.`,
      });
      if (!input.differenceAccepted) {
        choices.push(
          "Resolve or explicitly accept the counted-visit ledger mismatches before rollover.",
        );
      }
    }

    if (closeSnapshot.savingsTargetMinor !== null) {
      const target = closeSnapshot.savingsTargetMinor;
      const transferred = closeSnapshot.savingsTransferredMinor;
      differences.push({
        code: "savings_target_vs_transfers",
        amountMinor: transferred - target,
        status: "ok",
        message:
          transferred === target
            ? `Savings transfers (${transferred} centimes) match the period target (${target} centimes).`
            : `Savings target is ${target} centimes and ${transferred} centimes were actually transferred. This is a target outcome, not a cash discrepancy.`,
      });
    }
  }

  const acceptableDifference =
    (differenceMinor !== null && differenceMinor !== 0) ||
    (closeSnapshot.available &&
      (closeSnapshot.restatedDifferenceCount > 0 ||
        closeSnapshot.paidObligationMismatchCount > 0 ||
        closeSnapshot.countedVisitMismatchCount > 0));

  return {
    currency: MONEY_CURRENCY,
    cutoffDate: input.cutoffDate,
    modeledClosingCashMinor: input.modeledClosingCashMinor,
    verifiedClosingCashMinor: input.verifiedClosingCashMinor,
    differenceMinor,
    differenceAccepted: Boolean(input.differenceAccepted && acceptableDifference),
    pendingOccurrenceCount: input.pendingOccurrences.length,
    pendingOccurrenceMinor,
    choices,
    blockers,
    differences,
  };
}

/* -------------------------------------------------------------------------- */
/* Week windows from dates (never hardcoded workbook ranges)                   */
/* -------------------------------------------------------------------------- */

export type MoneyPeriodWeekWindow = Readonly<{
  weekStart: string;
  weekEnd: string;
  clippedStart: string;
  clippedEnd: string;
  clippedToPeriod: boolean;
}>;

/**
 * Owner-local Monday–Sunday windows covering an inclusive period range. A
 * partial first/last week is clipped to the period and says so. Windows are
 * derived from the period dates, never from fixed spreadsheet cells.
 */
export function generateMoneyPeriodWeekWindows(input: Readonly<{
  startDate: string;
  endDate: string;
  timezone: string;
}>): readonly MoneyPeriodWeekWindow[] {
  if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) {
    throw new Error("Invalid period range.");
  }
  if (input.endDate < input.startDate) {
    throw new Error("The period end must be on or after its start.");
  }
  if (!isValidIANATimeZone(input.timezone)) {
    throw new Error("Invalid timezone.");
  }
  const windows: MoneyPeriodWeekWindow[] = [];
  let cursor = input.startDate;
  while (cursor <= input.endDate) {
    const week = getWeekWindow(input.timezone, cursor);
    const clippedStart = week.weekStart < input.startDate ? input.startDate : week.weekStart;
    const clippedEnd = week.weekEnd > input.endDate ? input.endDate : week.weekEnd;
    windows.push({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      clippedStart,
      clippedEnd,
      clippedToPeriod: clippedStart !== week.weekStart || clippedEnd !== week.weekEnd,
    });
    const next = addDaysToIsoDate(week.weekEnd, 1);
    if (next <= cursor) throw new Error("Week window generation did not advance.");
    cursor = next;
  }
  return windows;
}

/**
 * A carried pending occurrence keeps its position inside the period: its due
 * date shifts by the successor offset and is clamped to the new boundaries.
 * The source row is never edited into the successor; a new row is created and
 * the source occurrence is cancelled with retained reason history.
 */
export function shiftDueDateIntoPeriod(input: Readonly<{
  dueDate: string;
  sourceStartDate: string;
  targetStartDate: string;
  targetEndDate: string;
}>): string {
  if (!isIsoDate(input.dueDate) || !isIsoDate(input.sourceStartDate)) {
    throw new Error("Invalid due-date shift input.");
  }
  const sourceStart = Date.parse(`${input.sourceStartDate}T00:00:00Z`);
  const sourceDue = Date.parse(`${input.dueDate}T00:00:00Z`);
  if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceDue)) {
    throw new Error("Invalid due-date shift input.");
  }
  const offsetDays = Math.round((sourceDue - sourceStart) / 86_400_000);
  const shifted = addDaysToIsoDate(input.targetStartDate, offsetDays);
  if (shifted < input.targetStartDate) return input.targetStartDate;
  if (shifted > input.targetEndDate) return input.targetEndDate;
  return shifted;
}

/** Canonical semantic payload used for rollover retry fingerprints. */
export function canonicalMoneyRolloverPayload(values: MoneyRolloverValues): string {
  return JSON.stringify({
    sourcePeriodId: values.sourcePeriodId,
    expectedVersion: values.expectedVersion,
    startDate: values.startDate,
    endDate: values.endDate,
    opening: values.opening,
    unpaidItems: values.unpaidItems,
    settingsOverrides: values.settingsOverrides,
    allowUncoveredDays: values.allowUncoveredDays,
    acceptClosingDifferenceNote: values.acceptClosingDifferenceNote,
  });
}
