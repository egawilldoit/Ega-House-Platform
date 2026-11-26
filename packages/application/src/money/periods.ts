import {
  MONEY_DEFAULT_TIMEZONE,
  calculateMoneyDailyReference,
  canonicalMoneyOpeningPayload,
  classifyDateInPeriod,
  isMoneyPeriodId,
  moneyActiveDateMoveFailure,
  parseCreateMoneyPeriodInput,
  parseUpdateMoneySettingsInput,
  resolveMoneyProjectionCutoff,
  validateOpeningAgainstPeriod,
  type MoneyDayClose,
  type MoneyOpening,
  type MoneyOpeningCorrection,
  type MoneyOpeningInput,
  type MoneyOpeningProvenance,
  type MoneyPeriod,
  type MoneyPeriodCreateValues,
  type MoneyPeriodInitialization,
  type MoneyPeriodProvenance,
  type MoneyPeriodUpdateValues,
  type MoneyProjectionCutoffBasis,
} from "@ega/domain/money";
import {
  getLocalDateInTimezone,
  isIsoDate,
  isValidIANATimeZone,
} from "@ega/domain/time-context";

import type { AuthenticatedActor } from "../auth/actor";
import { sha256Hex } from "../shared/hash";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
  type RepositoryFailure,
  type RepositoryResult,
} from "../shared/result";
import { loadMoneyDayCloseViews, type MoneyDayCloseView } from "./day-close-read";
import { getMoneyCashPosition, type MoneyCashPosition } from "./summary";
import type { MoneyDayStartBaseline, MoneyPeriodRepository } from "./ports";

export type MoneyStateQuery = Readonly<{
  periodId?: unknown;
  date?: unknown;
  mode?: unknown;
}>;

export type MoneyStateOptions = Readonly<{
  now?: Date;
  /** Owner-resolved IANA zone, or null when the owner has none stored. */
  timezone?: string | null;
}>;

/** Explicitly replace today's active day-start snapshot with current state. */
export async function rebaseMoneyDayStartBaseline(
  actor: AuthenticatedActor,
  repository: Pick<MoneyPeriodRepository, "rebaseDayStartBaseline">,
  rawPeriodId: unknown,
): Promise<ApplicationResult<MoneyDayStartBaseline>> {
  if (typeof rawPeriodId !== "string" || !isMoneyPeriodId(rawPeriodId.trim())) {
    return applicationFailure("Use a valid Money period ID.", "validation");
  }
  if (!repository.rebaseDayStartBaseline) {
    return applicationFailure("Day-start baseline rebasing is unavailable right now.", "unknown");
  }
  const result = await repository.rebaseDayStartBaseline(actor, rawPeriodId.trim());
  if (!result.ok) return fromRepository(result, "Unable to rebase the day-start baseline right now.");
  return applicationSuccess(result.value);
}

export type MoneyStateDateResolution = Readonly<{
  localToday: string;
  timezone: string;
  activeDate: string | null;
  periodTimezone: string | null;
  datesDiffer: boolean;
  requestedDate: string | null;
  requestedMode: "today" | "active_day" | null;
  resolvedDate: string;
  basis:
    | "explicit_date"
    | "local_today"
    | "active_day"
    | "local_today_no_period";
  periodRelation: "in_period" | "before_period" | "after_period" | "no_period";
  /**
   * Financial projection cutoff used by cash, reserves and daily guidance.
   * Distinct from `resolvedDate` (selected-day evidence) and from the optional
   * `activeDate` tracking cursor.
   */
  projectionCutoffDate: string;
  projectionBasis: MoneyProjectionCutoffBasis;
  projectionClampedToPeriod: boolean;
}>;

export type MoneyStatePeriodSummary = Readonly<{
  id: string;
  startDate: string;
  endDate: string;
  currency: "MAD";
  timezone: string;
  activeDate: string;
  lifecycle: MoneyPeriod["lifecycle"];
  initialization: MoneyPeriodInitialization;
  dayStartSetupCompleted: boolean;
  version: number;
}>;

export type MoneyStateLegacySummary =
  | Readonly<{
      available: true;
      totalExpenseCount: number;
      assignedToPeriodCount: number;
      inPeriodUnassignedCount: number;
      bookingDateAssignment: "derived_from_occurred_at_in_owner_timezone";
      reviewRequired: boolean;
    }>
  | Readonly<{
      available: false;
      reason: string;
    }>;

export type MoneyOpeningState =
  | Readonly<{
      status: "unknown";
      amountMinor: null;
      currency: "MAD";
      reason: string;
    }>
  | Readonly<{
      status: "known";
      amountMinor: number;
      currency: "MAD";
      bookingDate: string;
      version: number;
      openingMovementId: string;
    }>;

export type MoneyState = Readonly<{
  localToday: string;
  timezone: string;
  period: MoneyPeriod | null;
  opening: MoneyOpeningState;
  cash: MoneyCashPosition;
  dayStartBaseline: (MoneyDayStartBaseline & { dailyReference: ReturnType<typeof calculateMoneyDailyReference> | null }) | null;
  dayStartBaselineUnavailable: boolean;
  /** Close evidence for the resolved date, when that day was closed. */
  dayClose: MoneyDayCloseView | null;
  /** Latest retained close for the selected period (the active day may be newer). */
  lastClose: MoneyDayCloseView | null;
  recentCloses: readonly MoneyDayClose[];
  dayClosesUnavailable: boolean;
  /** Unclosed dates before the active day that were skipped (or led the period). */
  unverifiedDates: readonly string[];
  unverifiedDayCount: number;
  /** Last date in the unverified range; null when there is no tracked gap. */
  unverifiedThroughDate: string | null;
  closedDayCount: number;
  dateResolution: MoneyStateDateResolution;
  history: readonly MoneyStatePeriodSummary[];
  historyUnavailable: boolean;
  legacy: MoneyStateLegacySummary;
}>;

export type CreateMoneyPeriodOutcome = Readonly<{
  period: MoneyPeriod;
  replayed: boolean;
}>;

export const MONEY_PERIOD_HISTORY_LIMIT = 12;
const MAX_OPENING_CORRECTIONS = 100;

function failureFor(
  code: RepositoryFailure["code"] | undefined,
  fallback: string,
): ApplicationResult<never> {
  if (code === "notFound") {
    return applicationFailure(fallback, "notFound");
  }
  if (code === "conflict") {
    return applicationFailure(fallback, "conflict");
  }
  if (code === "forbidden") {
    return applicationFailure(
      "You do not have permission to change Money settings.",
      "forbidden",
    );
  }
  return applicationFailure(fallback, "unknown");
}

function fromRepository<T>(
  result: RepositoryResult<T>,
  fallback: string,
): ApplicationResult<T> {
  if (result.ok) return applicationSuccess(result.value);
  return failureFor(result.error.code, fallback);
}

function resolveTimezone(options: MoneyStateOptions): string {
  const requested = options.timezone;
  if (typeof requested === "string" && requested.trim()) {
    const trimmed = requested.trim();
    if (isValidIANATimeZone(trimmed)) return trimmed;
  }
  return MONEY_DEFAULT_TIMEZONE;
}

function initializationFor(source: MoneyOpeningInput["source"]): MoneyPeriodInitialization {
  return source === "verified_source" ? "reconciled" : "initialized";
}

function buildOpeningProvenance(
  opening: MoneyOpeningInput,
  recordedAt: string,
  corrections: readonly MoneyOpeningCorrection[],
): MoneyOpeningProvenance {
  return {
    source: opening.source,
    recordedAt,
    cutoffDate: opening.cutoffDate,
    evidence: opening.evidence,
    note: opening.note,
    corrections,
  };
}

function buildPeriodProvenance(
  opening: MoneyOpeningProvenance | null,
  createdFrom: "web" | "mcp",
  continuedFrom: string | null = null,
): MoneyPeriodProvenance {
  return continuedFrom
    ? { opening, createdFrom, continuedFrom }
    : { opening, createdFrom };
}

function openingFingerprint(opening: MoneyOpeningInput): string {
  return sha256Hex(canonicalMoneyOpeningPayload(opening));
}

function readCorrections(period: MoneyPeriod): MoneyOpeningCorrection[] {
  const raw = period.provenance.opening?.corrections;
  if (!Array.isArray(raw)) return [];
  const corrections: MoneyOpeningCorrection[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof entry.at === "string" &&
      Number.isInteger(entry.amountMinor) &&
      Number.isInteger(entry.previousAmountMinor) &&
      Number.isInteger(entry.ledgerVersion) &&
      typeof entry.source === "string"
    ) {
      corrections.push(entry as MoneyOpeningCorrection);
    }
  }
  return corrections.slice(-MAX_OPENING_CORRECTIONS);
}

function summarizePeriod(period: MoneyPeriod): MoneyStatePeriodSummary {
  return {
    id: period.id,
    startDate: period.startDate,
    endDate: period.endDate,
    currency: period.currency,
    timezone: period.timezone,
    activeDate: period.activeDate,
    lifecycle: period.lifecycle,
    initialization: period.initialization,
    dayStartSetupCompleted: period.dayStartSetupCompleted,
    version: period.version,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sameCreateRequest(
  period: MoneyPeriod,
  opening: MoneyOpening | null,
  values: MoneyPeriodCreateValues,
): boolean {
  if (
    period.timezone !== values.timezone ||
    period.activeDate !== values.activeDate ||
    stableJson(period.settings) !== stableJson(values.settings)
  ) {
    return false;
  }
  if (values.opening === null) return period.initialization === "uninitialized";
  const provenance = period.provenance.opening;
  if (!provenance || !opening) return false;
  return (
    opening.amountMinor === values.opening.amountMinor &&
    provenance.source === values.opening.source &&
    provenance.cutoffDate === values.opening.cutoffDate &&
    provenance.evidence === values.opening.evidence &&
    provenance.note === values.opening.note
  );
}

/**
 * Read the period context for one owner. `localToday` is always the real
 * owner-local date; `activeDate` is the separate tracking date and may lag it.
 * An explicit date never silently becomes the active date.
 */
export async function getMoneyState(
  actor: AuthenticatedActor,
  repository: MoneyPeriodRepository,
  query: MoneyStateQuery = {},
  options: MoneyStateOptions = {},
): Promise<ApplicationResult<MoneyState>> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.");
  }
  const timezone = resolveTimezone(options);
  const localToday = getLocalDateInTimezone(now, timezone);

  const rawPeriodId = query.periodId;
  if (rawPeriodId !== undefined && rawPeriodId !== null) {
    if (typeof rawPeriodId !== "string" || !isMoneyPeriodId(rawPeriodId.trim())) {
      return applicationFailure("periodId must be a valid UUID.", "validation");
    }
  }
  const rawDate = query.date;
  if (rawDate !== undefined && rawDate !== null) {
    if (typeof rawDate !== "string" || !isIsoDate(rawDate.trim())) {
      return applicationFailure("date must be a valid YYYY-MM-DD date.", "validation");
    }
  }
  if (rawDate !== undefined && query.mode !== undefined) {
    return applicationFailure(
      "Provide either date or mode, not both.",
      "validation",
    );
  }
  const mode =
    query.mode === undefined || query.mode === null
      ? null
      : query.mode === "today" || query.mode === "active_day"
        ? query.mode
        : undefined;
  if (mode === undefined) {
    return applicationFailure(
      "mode must be 'today' or 'active_day'.",
      "validation",
    );
  }

  const historyResult = await repository.list(actor, MONEY_PERIOD_HISTORY_LIMIT);
  if (!historyResult.ok) {
    return fromRepository(historyResult, "Unable to load money periods right now.");
  }

  let selected: MoneyPeriod | null = null;
  if (typeof rawPeriodId === "string") {
    const byId = await repository.findById(actor, rawPeriodId.trim());
    if (!byId.ok) {
      return fromRepository(byId, "Unable to load the money period right now.");
    }
    if (!byId.value) {
      return applicationFailure("Money period was not found.", "notFound");
    }
    selected = byId.value;
  } else {
    const tracking = await repository.findTracking(actor);
    if (!tracking.ok) {
      return fromRepository(tracking, "Unable to load the money period right now.");
    }
    selected = tracking.value ?? historyResult.value[0] ?? null;
  }

  let opening: MoneyOpening | null = null;
  if (selected?.openingMovementId) {
    const openingResult = await repository.getOpening(
      actor,
      selected.openingMovementId,
    );
    if (!openingResult.ok) {
      return fromRepository(openingResult, "Unable to load opening cash right now.");
    }
    if (!openingResult.value) {
      return applicationFailure(
        "The period opening record is missing. Reload and inspect the ledger instead of treating cash as unknown.",
        "unknown",
      );
    }
    opening = openingResult.value;
  }

  const overview = await repository.ledgerOverview(actor, {
    periodId: selected?.id ?? null,
    startDate: selected?.startDate ?? localToday,
    endDate: selected?.endDate ?? localToday,
  });
  const legacy: MoneyStateLegacySummary = overview.ok
    ? {
        available: true,
        totalExpenseCount: overview.value.totalExpenseCount,
        assignedToPeriodCount: overview.value.assignedToPeriodCount,
        inPeriodUnassignedCount: overview.value.inPeriodUnassignedCount,
        bookingDateAssignment: "derived_from_occurred_at_in_owner_timezone",
        reviewRequired: overview.value.inPeriodUnassignedCount > 0,
      }
    : {
        available: false,
        reason: "Legacy expense assignment could not be reviewed right now.",
      };

  let requestedDate: string | null = null;
  let requestedMode: "today" | "active_day" | null = null;
  let resolvedDate: string;
  let basis: MoneyStateDateResolution["basis"];

  if (typeof rawDate === "string") {
    requestedDate = rawDate.trim();
    resolvedDate = requestedDate;
    basis = "explicit_date";
  } else if (mode === "today") {
    requestedMode = "today";
    resolvedDate = localToday;
    basis = "local_today";
  } else if (mode === "active_day") {
    if (!selected) {
      return applicationFailure(
        "There is no active money period. Configure a period before asking for the active day.",
        "validation",
      );
    }
    requestedMode = "active_day";
    resolvedDate = selected.activeDate;
    basis = "active_day";
  } else if (selected) {
    resolvedDate = selected.activeDate;
    basis = "active_day";
  } else {
    resolvedDate = localToday;
    basis = "local_today_no_period";
  }

  const periodRelation = selected
    ? classifyDateInPeriod(resolvedDate, selected)
    : ("no_period" as const);
  const projection = resolveMoneyProjectionCutoff({
    localToday,
    period: selected,
    requestedDate,
    requestedMode,
  });

  let cash: MoneyCashPosition;
  if (!selected) {
    cash = {
      available: false,
      currency: "MAD",
      reason: "No money period is configured yet.",
      cutoffDate: projection.date,
    };
  } else if (
    projection.date < selected.startDate ||
    projection.date > selected.endDate
  ) {
    // The canonical reserve read only defines cutoffs inside its own period.
    // Keep cash on the same effective cutoff and report unavailable instead of
    // summing ledger rows from other periods.
    cash = {
      available: false,
      currency: "MAD",
      reason: "cutoff_outside_period",
      cutoffDate: projection.date,
    };
  } else {
    const cashResult = await getMoneyCashPosition(
      actor,
      repository,
      selected,
      opening,
      projection.date,
    );
    if (!cashResult.ok) {
      return cashResult;
    }
    cash = cashResult.data;
  }

  let dayStartBaseline: MoneyState["dayStartBaseline"] = null;
  let dayStartBaselineUnavailable = false;
  // Reads are observational. A missing baseline remains unavailable until an
  // explicitly authorized write creates one.
  if (selected && repository.getDayStartBaseline) {
    const baselineResult = await repository.getDayStartBaseline(actor, selected.id, resolvedDate);
    if (!baselineResult.ok) return fromRepository(baselineResult, "Unable to load the day-start baseline right now.");
    const baseline = baselineResult.value;
    if (!baseline) {
      dayStartBaselineUnavailable = true;
    } else if (baseline.availability !== "available") {
      dayStartBaselineUnavailable = true;
      dayStartBaseline = { ...baseline, dailyReference: null };
    } else {
      const dailyTotalResult = repository.getDailyIncludedExpenseTotal
        ? await repository.getDailyIncludedExpenseTotal(actor, selected.id, resolvedDate)
        : null;
      if (dailyTotalResult && !dailyTotalResult.ok) return fromRepository(dailyTotalResult, "Unable to load daily expense outflows right now.");
      const dailyTotal = dailyTotalResult?.ok ? dailyTotalResult.value : null;
      if (!dailyTotal || !dailyTotal.complete) dayStartBaselineUnavailable = true;
      dayStartBaseline = {
        ...baseline,
        dailyReference: dailyTotal?.complete ? calculateMoneyDailyReference({
          startCashMinor: baseline.cashMinor,
          startCommitmentsMinor: baseline.commitmentsMinor,
          startSavingsTargetMinor: baseline.savingsTargetMinor,
          savingsFundedBeforeMinor: baseline.savingsFundedMinor,
          startEmergencyTargetMinor: baseline.emergencyTargetMinor,
          emergencyUsedBeforeMinor: baseline.emergencyUsedMinor,
          periodEnd: selected.endDate,
          selectedDate: resolvedDate,
          dailyIncludedExpenseMinor: dailyTotal.amountMinor,
          periodLifecycle: selected.lifecycle,
        }) : null,
      };
    }
  } else if (selected) {
    dayStartBaselineUnavailable = true;
  }

  const history = historyResult.value.map(summarizePeriod);
  if (selected && !history.some((entry) => entry.id === selected!.id)) {
    history.unshift(summarizePeriod(selected));
  }

  let dayClose: MoneyDayCloseView | null = null;
  let lastClose: MoneyDayCloseView | null = null;
  let recentCloses: readonly MoneyDayClose[] = [];
  let dayClosesUnavailable = false;
  let unverifiedDates: readonly string[] = [];
  let unverifiedThroughDate: string | null = null;
  let closedDayCount = 0;
  if (selected) {
    const closes = await loadMoneyDayCloseViews(
      actor,
      repository,
      selected,
      opening,
      resolvedDate,
    );
    if (closes.ok) {
      dayClose = closes.data.dayClose;
      lastClose = closes.data.lastClose;
      recentCloses = closes.data.recentCloses;
      unverifiedDates = closes.data.unverifiedDates;
      unverifiedThroughDate = closes.data.unverifiedThroughDate;
      closedDayCount = closes.data.closedDayCount;
    } else {
      dayClosesUnavailable = true;
    }
  }

  return applicationSuccess({
    localToday,
    timezone,
    period: selected,
    opening:
      opening === null
        ? {
            status: "unknown",
            amountMinor: null,
            currency: "MAD",
            reason:
              "Opening cash is unknown. Initialize the period with a known amount; zero is a valid known opening.",
          }
        : {
            status: "known",
            amountMinor: opening.amountMinor,
            currency: "MAD",
            bookingDate: opening.bookingDate,
            version: opening.version,
            openingMovementId: opening.id,
          },
    cash,
    dayStartBaseline,
    dayStartBaselineUnavailable,
    dayClose,
    lastClose,
    recentCloses,
    dayClosesUnavailable,
    unverifiedDates,
    unverifiedDayCount: unverifiedDates.length,
    unverifiedThroughDate,
    closedDayCount,
    dateResolution: {
      localToday,
      timezone,
      activeDate: selected?.activeDate ?? null,
      periodTimezone: selected?.timezone ?? null,
      datesDiffer: selected ? localToday !== selected.activeDate : false,
      requestedDate,
      requestedMode,
      resolvedDate,
      basis,
      periodRelation,
      projectionCutoffDate: projection.date,
      projectionBasis: projection.basis,
      projectionClampedToPeriod: projection.clampedToPeriod,
    },
    history,
    historyUnavailable: false,
    legacy,
  });
}

/**
 * Create one inclusive period. Repeating the exact same request replays the
 * existing period; a different overlapping range is a conflict, never a silent
 * second tracking period.
 */
export async function createMoneyPeriod(
  actor: AuthenticatedActor,
  repository: MoneyPeriodRepository,
  input: unknown,
  options: MoneyStateOptions & Readonly<{ surface?: "web" | "mcp" }> = {},
): Promise<ApplicationResult<CreateMoneyPeriodOutcome>> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.");
  }
  const timezone = resolveTimezone(options);
  const localToday = getLocalDateInTimezone(now, timezone);
  const parsed = parseCreateMoneyPeriodInput(input, { today: localToday, timezone });
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }
  const values = parsed.value;

  const overlapping = await repository.findOverlapping(actor, {
    startDate: values.startDate,
    endDate: values.endDate,
  });
  if (!overlapping.ok) {
    return fromRepository(overlapping, "Unable to check existing periods right now.");
  }

  for (const existing of overlapping.value) {
    if (
      existing.startDate === values.startDate &&
      existing.endDate === values.endDate
    ) {
      const openingResult = existing.openingMovementId
        ? await repository.getOpening(actor, existing.openingMovementId)
        : ({ ok: true, value: null } as const);
      if (!openingResult.ok) {
        return fromRepository(
          openingResult,
          "Unable to check the existing opening right now.",
        );
      }
      if (sameCreateRequest(existing, openingResult.value, values)) {
        return applicationSuccess({ period: existing, replayed: true });
      }
      return applicationFailure(
        `A period for ${values.startDate}–${values.endDate} already exists with different settings. Update that period instead.`,
        "conflict",
      );
    }
  }
  if (overlapping.value.length > 0) {
    const conflict = overlapping.value[0];
    return applicationFailure(
      `The period overlaps ${conflict.startDate}–${conflict.endDate}. Choose non-overlapping dates or update that period.`,
      "conflict",
    );
  }

  const tracking = await repository.findTracking(actor);
  if (!tracking.ok) {
    return fromRepository(tracking, "Unable to check the tracking period right now.");
  }
  if (tracking.value) {
    return applicationFailure(
      `A tracking period already exists for ${tracking.value.startDate}–${tracking.value.endDate}. End or roll it over before creating another.`,
      "conflict",
    );
  }

  const opening = values.opening;
  const provenance = buildPeriodProvenance(
    opening
      ? buildOpeningProvenance(opening, now.toISOString(), [])
      : null,
    options.surface ?? "web",
  );

  const result = await repository.create(actor, {
    values,
    provenance,
    openingCreateFingerprint: opening ? openingFingerprint(opening) : null,
    createdAt: now.toISOString(),
  });
  if (!result.ok) {
    return fromRepository(result, "Unable to create the money period right now.");
  }
  return applicationSuccess({ period: result.value, replayed: false });
}

/**
 * Update the active date, settings and/or the single opening movement. A stale
 * version conflicts; ended/rolled-over periods refuse routine settings changes
 * and direct the caller to the explicit historical correction path. A
 * non-finalized `superseded` period accepts only the initialization of a
 * missing opening, so a continued range can still be reviewed and finalized.
 */
export async function updateMoneySettings(
  actor: AuthenticatedActor,
  repository: MoneyPeriodRepository,
  periodId: unknown,
  input: unknown,
  options: MoneyStateOptions = {},
): Promise<ApplicationResult<MoneyPeriod>> {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.");
  }

  const parsed = parseUpdateMoneySettingsInput(input);
  if (!parsed.ok) {
    return applicationFailure(parsed.message, "validation");
  }
  const values: MoneyPeriodUpdateValues = parsed.value;

  let period: MoneyPeriod | null;
  if (periodId === undefined || periodId === null) {
    const tracking = await repository.findTracking(actor);
    if (!tracking.ok) {
      return fromRepository(tracking, "Unable to load the tracking period right now.");
    }
    period = tracking.value;
  } else {
    if (typeof periodId !== "string" || !isMoneyPeriodId(periodId.trim())) {
      return applicationFailure("periodId must be a valid UUID.", "validation");
    }
    const byId = await repository.findById(actor, periodId.trim());
    if (!byId.ok) {
      return fromRepository(byId, "Unable to load the money period right now.");
    }
    period = byId.value;
  }

  if (!period) {
    return applicationFailure(
      "No money period is configured. Create a period before updating settings.",
      "notFound",
    );
  }
  if (period.version !== values.expectedVersion) {
    return applicationFailure(
      "The period changed. Refresh and try again.",
      "conflict",
    );
  }
  // A superseded period is not finalized. When it was created by automatic
  // continuation its opening may still be unknown, and finalization cannot
  // review cash without it. Accept exactly one path on that non-finalized
  // range: initialize the missing opening. Active dates, settings and later
  // corrections stay closed until the explicit rollover review.
  const supersededOpeningInitialization =
    period.lifecycle === "superseded" &&
    period.openingMovementId === null &&
    values.opening !== undefined &&
    values.activeDate === undefined &&
    values.settings === undefined;
  if (period.lifecycle !== "tracking" && !supersededOpeningInitialization) {
    return applicationFailure(
      period.lifecycle === "superseded" && period.openingMovementId === null
        ? "This superseded period is not finalized. Only its missing opening can be initialized; active dates, settings and later corrections require the explicit finalization review."
        : `This period is ${period.lifecycle.replaceAll("_", " ")}. Only a tracking period accepts routine settings changes; use the explicit historical correction path.`,
      "validation",
    );
  }
  if (values.activeDate !== undefined) {
    if (values.activeDate !== period.activeDate) {
      // Day close is optional (MONEY-001 ID-07). The active date may skip
      // unclosed days or rewind to an earlier unclosed day; only retained close
      // evidence is authoritative, so a woken date cannot move to or behind a
      // closed date. No close row is created by this move.
      let latestClosedDate: string | null = null;
      if (repository.listDayCloses) {
        const closes = await repository.listDayCloses(actor, period.id, 1);
        if (!closes.ok) {
          return fromRepository(
            closes,
            "Unable to inspect the retained day closes right now.",
          );
        }
        latestClosedDate = closes.value[0]?.closeDate ?? null;
      }
      const moveFailure = moneyActiveDateMoveFailure(
        period,
        values.activeDate,
        latestClosedDate,
      );
      if (moveFailure === "behind_retained_close") {
        return applicationFailure(
          `The active date cannot move to or behind the retained close ${latestClosedDate}. Day close is optional, but attested history is never reopened. Choose a later unclosed date or correct the closed day through the versioned movement path.`,
          "validation",
        );
      }
      if (moveFailure === "out_of_period") {
        return applicationFailure(
          `The active date must be between ${period.startDate} and ${period.endDate}. Changing it never changes the period boundaries or closes a day.`,
          "validation",
        );
      }
      if (moveFailure === "invalid_date") {
        return applicationFailure("Use a valid calendar date.", "validation");
      }
      if (moveFailure === "period_not_tracking") {
        return applicationFailure(
          `This period is ${period.lifecycle.replaceAll("_", " ")}. Only a tracking period accepts routine settings changes.`,
          "validation",
        );
      }
    }
  }

  let opening: MoneyOpening | null = null;
  if (period.openingMovementId) {
    const current = await repository.getOpening(actor, period.openingMovementId);
    if (!current.ok) {
      return fromRepository(current, "Unable to load the current opening right now.");
    }
    opening = current.value;
  }

  let openingUpdate = undefined as
    | {
        values: MoneyOpeningInput;
        provenance: MoneyPeriodProvenance;
        initialization: MoneyPeriodInitialization;
        createFingerprint: string;
      }
    | undefined;

  if (values.opening) {
    if (period.initialization !== "uninitialized" && opening === null) {
      return applicationFailure(
        "The period opening record is inconsistent. Reload and inspect the ledger before changing it.",
      );
    }
    const cutoffFailure = validateOpeningAgainstPeriod(
      values.opening,
      period.startDate,
    );
    if (cutoffFailure) {
      return applicationFailure(cutoffFailure.message, "validation");
    }

    const nextInitialization = initializationFor(values.opening.source);
    if (
      period.initialization === "reconciled" &&
      nextInitialization !== "reconciled"
    ) {
      return applicationFailure(
        "A reconciled opening cannot lose its verified evidence. Provide a verified source with evidence and cutoff, or keep the current opening.",
        "validation",
      );
    }

    const corrections =
      period.initialization === "uninitialized"
        ? []
        : [
            ...readCorrections(period),
            ...(opening
              ? [
                  {
                    at: now.toISOString(),
                    amountMinor: values.opening.amountMinor,
                    previousAmountMinor: opening.amountMinor,
                    ledgerVersion: opening.version + 1,
                    source: values.opening.source,
                    note: values.opening.note,
                  } satisfies MoneyOpeningCorrection,
                ]
              : []),
          ].slice(-MAX_OPENING_CORRECTIONS);

    openingUpdate = {
      values: values.opening,
      provenance: buildPeriodProvenance(
        buildOpeningProvenance(values.opening, now.toISOString(), corrections),
        period.provenance.createdFrom,
        period.provenance.continuedFrom ?? null,
      ),
      initialization: nextInitialization,
      createFingerprint: openingFingerprint(values.opening),
    };
  }

  const result = await repository.update(actor, period.id, {
    expectedVersion: values.expectedVersion,
    activeDate: values.activeDate,
    settings: values.settings,
    opening: openingUpdate,
    updatedAt: now.toISOString(),
  });
  if (!result.ok) {
    return fromRepository(result, "Unable to save Money settings right now.");
  }
  return applicationSuccess(result.value);
}

/** The deterministic out-of-period message shared by every routine entry. */
export function routineEntryGuardFailure(
  period: MoneyPeriod,
  bookingDate: string,
): string | null {
  if (!isIsoDate(bookingDate)) return "Use a valid calendar date.";
  if (period.lifecycle === "superseded") {
    return classifyDateInPeriod(bookingDate, period) === "in_period"
      ? null
      : `The date ${bookingDate} is outside the non-finalized superseded period ${period.startDate}–${period.endDate}. Use the explicit historical correction path.`;
  }
  if (period.lifecycle !== "tracking") {
    return `This period is ${period.lifecycle.replaceAll("_", " ")}. Use the explicit historical correction path for ${bookingDate}.`;
  }
  if (classifyDateInPeriod(bookingDate, period) !== "in_period") {
    return `The date ${bookingDate} is outside the tracking period ${period.startDate}–${period.endDate}. Choose the correct period or update the period before recording it.`;
  }
  return null;
}

/**
 * Where one routine booking belongs. `periodId` is the already-existing period
 * for an in-window or non-finalized superseded date. `requiresContinuation`
 * means the date is after the tracking window; the database must continue the
 * calendar and insert the financial row in ONE transaction.
 */
export type MoneyRoutineEntryTarget = Readonly<{
  periodId: string | null;
  timezone: string;
  requiresContinuation: boolean;
  /** The booking day the target was resolved for; null before resolution. */
  bookingDate: string | null;
}>;

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/**
 * Routine entry policy. A tracking period owns dates inside its window. A date
 * after it is a controlled continuation (the database closes the routine window
 * as `superseded` and creates exactly one later tracking period). A date inside
 * a non-finalized `superseded` period is still routine entry for that period's
 * own dates: `superseded` closes the forward window, it is not finalization
 * approval, so the owner can still record a forgotten expense. Finalized
 * (`ended`/`rolled_over`) ranges remain explicit historical corrections.
 *
 * Reads never mutate the calendar. `bookingDate === null` means the instant was
 * not resolved yet; the existing tracking period is returned unchanged.
 */
export async function resolveRoutineEntry(
  actor: AuthenticatedActor,
  repository: Pick<
    MoneyPeriodRepository,
    "findTracking" | "list" | "findOverlapping"
  >,
  bookingDate: string | null,
  /** Pre-loaded tracking period to avoid a second read. `undefined` loads it. */
  preloadedTracking?: MoneyPeriod | null,
): Promise<ApplicationResult<MoneyRoutineEntryTarget | null>> {
  if (bookingDate !== null && !isIsoDate(bookingDate)) {
    return applicationFailure("Use a valid calendar date.", "validation");
  }
  let current: MoneyPeriod | null;
  if (preloadedTracking !== undefined) {
    current = preloadedTracking;
  } else {
    const tracking = await repository.findTracking(actor);
    if (!tracking.ok) {
      return fromRepository(tracking, "Unable to check the tracking period right now.");
    }
    current = tracking.value;
  }
  if (bookingDate === null) {
    if (!current) {
      const existing = await repository.list(actor, 1);
      if (!existing.ok) {
        return fromRepository(existing, "Unable to check Money periods right now.");
      }
      if (existing.value.length > 0) {
        return applicationFailure(
          "There is no tracking period. Ended, superseded or rolled-over periods accept entries only through the explicit historical correction path.",
          "validation",
        );
      }
      return applicationSuccess(null);
    }
    return applicationSuccess({
      periodId: current.id,
      timezone: current.timezone,
      requiresContinuation: false,
      bookingDate: null,
    });
  }

  if (current && bookingDate >= current.startDate && bookingDate <= current.endDate) {
    return applicationSuccess({
      periodId: current.id,
      timezone: current.timezone,
      requiresContinuation: false,
      bookingDate,
    });
  }

  if (current && bookingDate > current.endDate) {
    if (daysBetween(current.endDate, bookingDate) > 366) {
      return applicationFailure(
        `The date ${bookingDate} is more than 366 days after the tracking period ${current.startDate}–${current.endDate}. Create a Money period explicitly before recording it.`,
        "validation",
      );
    }
    return applicationSuccess({
      periodId: null,
      timezone: current.timezone,
      requiresContinuation: true,
      bookingDate,
    });
  }

  // Before the tracking window (or with no tracking period): only a
  // non-finalized superseded period may accept routine entry for its own range.
  // A genuinely empty account keeps the legacy no-period behavior without a
  // second overlapping read.
  if (!current) {
    const existing = await repository.list(actor, 1);
    if (!existing.ok) {
      return fromRepository(existing, "Unable to check Money periods right now.");
    }
    if (existing.value.length === 0) return applicationSuccess(null);
  }
  const overlapping = await repository.findOverlapping(actor, {
    startDate: bookingDate,
    endDate: bookingDate,
  });
  if (!overlapping.ok) {
    return fromRepository(overlapping, "Unable to check Money periods right now.");
  }
  const superseded = overlapping.value
    .filter((period) => period.lifecycle === "superseded")
    .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];
  if (superseded) {
    return applicationSuccess({
      periodId: superseded.id,
      timezone: superseded.timezone,
      requiresContinuation: false,
      bookingDate,
    });
  }

  if (current) {
    return applicationFailure(
      routineEntryGuardFailure(current, bookingDate) ??
        "Use the explicit historical correction path for this date.",
      "validation",
    );
  }

  return applicationFailure(
    "There is no tracking period. Ended, superseded or rolled-over periods accept entries only through the explicit historical correction path.",
    "validation",
  );
}

// Keep the exact canonical create payload available for MCP full-input
// receipts without exposing a second stored contract.
export { canonicalMoneyPeriodCreatePayload } from "@ega/domain/money";
