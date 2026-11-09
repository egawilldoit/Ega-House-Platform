import { countWeeklyRunSessions, ROUTINE_WEEKLY_RUN_TARGET } from "@ega/domain/checkins";
import { getLocalDayWindow, getWeekWindow, isIsoDate, isValidIANATimeZone } from "@ega/domain/time-context";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
import type { DailyCheckinRepository } from "../checkins/ports";
import type { ExpenseRepository, ExpenseSummary } from "../expenses/ports";

/**
 * Two-week evidence review (PO-12, issue #353). A pure read model over the
 * canonical owners (sessions, preferences, check-ins, expenses). Every metric
 * carries its coverage; unknown days stay unknown and no history is ever
 * synthesized. At most three rule-based suggestions are produced.
 */

export type EvidenceReviewWindowInput = Readonly<{
  /** Inclusive owner-local start date. */
  startLocalDate: string;
  /** Inclusive owner-local end date. */
  endLocalDate: string;
}>;

export type EvidenceWorkPeriod = Readonly<{
  trackedSeconds: number;
  jobSearchSeconds: number;
  workTargetMinutes: number;
  jobSearchTargetMinutes: number;
  jobSearchConfigured: boolean;
}>;

export type EvidenceReviewProviders = Readonly<{
  /**
   * Work/search actuals + targets for the whole range, derived from
   * canonical sessions by the host composition. Null = unavailable.
   */
  workProgress?: (
    actor: AuthenticatedActor,
    startLocalDate: string,
    endLocalDate: string,
    timezone: string,
  ) => Promise<EvidenceWorkPeriod | null>;
}>;

export type EvidenceReviewResult = Readonly<{
  range: Readonly<{
    startLocalDate: string;
    endLocalDate: string;
    timezone: string;
    totalDays: number;
  }>;
  work: EvidenceWorkPeriod & { coverage: "canonical-sessions" } | null;
  runs: Readonly<{
    sessions: number;
    minutes: number;
    sessionsTarget: number;
    recordedDays: number;
  }>;
  leisure: Readonly<{
    totalMinutes: number;
    recordedDays: number;
    unknownDays: number;
  }>;
  overtime: Readonly<{
    evenings: number;
    reasonedEvenings: number;
    unreasonedEvenings: number;
  }>;
  money: Readonly<{
    totalMinor: number;
    coffeeMinor: number;
    recordCount: number;
    truncated: boolean;
    totalsByCategory: ExpenseSummary["totalsByCategory"];
  }> | null;
  coverage: Readonly<{
    checkinDays: number;
    sleepRecordedDays: number;
  }>;
  suggestions: string[];
}>;

export const EVIDENCE_REVIEW_MAX_DAYS = 35;
export const EVIDENCE_REVIEW_MAX_SUGGESTIONS = 3;

function isoDayDiffExclusive(startLocalDate: string, endLocalDate: string): number {
  const start = Date.parse(`${startLocalDate}T00:00:00Z`);
  const end = Date.parse(`${endLocalDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export async function getEvidenceReview(
  actor: AuthenticatedActor,
  repos: Readonly<{
    checkins: DailyCheckinRepository;
    expenses: ExpenseRepository;
  }>,
  input: Readonly<
    EvidenceReviewWindowInput & { timezone: string } & EvidenceReviewProviders
  >,
): Promise<ApplicationResult<EvidenceReviewResult>> {
  if (!isIsoDate(input.startLocalDate) || !isIsoDate(input.endLocalDate)) {
    return applicationFailure("Use valid calendar dates.", "validation");
  }
  if (!isValidIANATimeZone(input.timezone)) {
    return applicationFailure("Use a valid time zone.", "validation");
  }
  if (input.endLocalDate < input.startLocalDate) {
    return applicationFailure("End date must be on or after the start date.", "validation");
  }
  const totalDays = isoDayDiffExclusive(input.startLocalDate, input.endLocalDate);
  if (totalDays > EVIDENCE_REVIEW_MAX_DAYS) {
    return applicationFailure(`Reviews are bounded to ${EVIDENCE_REVIEW_MAX_DAYS} days.`, "validation");
  }

  let weekStart: string;
  try {
    weekStart = getWeekWindow(input.timezone, input.startLocalDate).weekStart;
  } catch {
    return applicationFailure("Use a valid time zone.", "validation");
  }

  const checkinsResult = await repos.checkins.listBetween(actor, input.startLocalDate, input.endLocalDate);
  if (!checkinsResult.ok) {
    return applicationFailure("Unable to load check-ins right now.", "unknown");
  }
  const checkins = checkinsResult.value;

  let rangeStartUtc: string;
  let rangeEndUtc: string;
  try {
    rangeStartUtc = getLocalDayWindow(input.timezone, input.startLocalDate).startUtcIso;
    rangeEndUtc = getLocalDayWindow(input.timezone, input.endLocalDate).endUtcIso;
  } catch {
    return applicationFailure("Unable to resolve the review window.", "validation");
  }

  const moneyResult = await repos.expenses.summarize(actor, {
    startUtcIso: rangeStartUtc,
    endUtcExclusiveIso: rangeEndUtc,
  });
  const money = moneyResult.ok
    ? {
        totalMinor: Object.values(moneyResult.value.totalsByCategory).reduce(
          (sum, value) => sum + (value ?? 0), 0,
        ),
        coffeeMinor: moneyResult.value.totalsByCategory.coffee ?? 0,
        recordCount: moneyResult.value.recordCount,
        truncated: moneyResult.value.truncated,
        totalsByCategory: moneyResult.value.totalsByCategory,
      }
    : null;

  const workPeriod = input.workProgress
    ? await input.workProgress(actor, input.startLocalDate, input.endLocalDate, input.timezone)
    : null;

  const runSummary = countWeeklyRunSessions(checkins, weekStart, input.endLocalDate);
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const sessionsTarget = ROUTINE_WEEKLY_RUN_TARGET * weeks;

  let leisureTotal = 0;
  let leisureRecorded = 0;
  let sleepRecorded = 0;
  let overtimeEvenings = 0;
  let reasoned = 0;
  let unreasoned = 0;
  for (const checkin of checkins) {
    const leisure = checkin.routine?.leisureMinutes;
    if (leisure !== null && leisure !== undefined) {
      leisureTotal += leisure;
      leisureRecorded += 1;
    }
    if (checkin.routine?.sleepHours !== null && checkin.routine?.sleepHours !== undefined) {
      sleepRecorded += 1;
    }
    if (checkin.overtimeMinutes !== null && checkin.overtimeMinutes !== undefined && checkin.overtimeMinutes > 0) {
      overtimeEvenings += 1;
      if (checkin.overtimeReason && checkin.overtimeReason.trim() !== "") reasoned += 1;
      else unreasoned += 1;
    }
  }

  const suggestions: string[] = [];
  if (workPeriod && workPeriod.workTargetMinutes > 0) {
    const actual = Math.floor(workPeriod.trackedSeconds / 60);
    if (actual < workPeriod.workTargetMinutes) {
      suggestions.push(`Work is ${fmtMinutes(workPeriod.workTargetMinutes - actual)} short of the daily targets for this window.`);
    }
  }
  if (runSummary.completedSessions < sessionsTarget) {
    suggestions.push(`Runs are ${runSummary.completedSessions}/${sessionsTarget} for comparable weeks.`);
  }
  if (unreasoned > 0) {
    suggestions.push(`${unreasoned} overtime evening${unreasoned === 1 ? "" : "s"} without a recorded reason.`);
  }
  if (suggestions.length === 0) {
    suggestions.push("Evidence is complete enough for this range — no corrections needed.");
  }

  return applicationSuccess({
    range: {
      startLocalDate: input.startLocalDate,
      endLocalDate: input.endLocalDate,
      timezone: input.timezone,
      totalDays,
    },
    work: workPeriod ? { ...workPeriod, coverage: "canonical-sessions" as const } : null,
    runs: {
      sessions: runSummary.completedSessions,
      minutes: runSummary.totalRunMinutes,
      sessionsTarget,
      recordedDays: checkins.length,
    },
    leisure: {
      totalMinutes: leisureTotal,
      recordedDays: leisureRecorded,
      unknownDays: totalDays - leisureRecorded,
    },
    overtime: {
      evenings: overtimeEvenings,
      reasonedEvenings: reasoned,
      unreasonedEvenings: unreasoned,
    },
    money,
    coverage: {
      checkinDays: checkins.length,
      sleepRecordedDays: sleepRecorded,
    },
    suggestions: suggestions.slice(0, EVIDENCE_REVIEW_MAX_SUGGESTIONS),
  });
}

function fmtMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
