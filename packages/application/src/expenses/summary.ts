import {
  addDaysToIsoDate,
  getLocalDayWindow,
  getWeekWindow,
  isIsoDate,
  isValidIANATimeZone,
} from "@ega/domain/time-context";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationResult,
} from "../shared/result";
import type { ExpenseRepository, ExpenseSummary } from "./ports";

export type ExpensePeriodSummary = Readonly<{
  /** Sum of recorded non-deleted expenses in the period, in MAD centimes. */
  totalMinor: number;
  recordCount: number;
  truncated: boolean;
  totalsByCategory: ExpenseSummary["totalsByCategory"];
}>;

export type ExpenseSummaryResult = Readonly<{
  localDate: string;
  timezone: string;
  day: ExpensePeriodSummary;
  weekToDate: ExpensePeriodSummary;
  monthToDate: ExpensePeriodSummary;
  /** Same-month coffee total (centimes) and its record count. */
  coffee: ExpensePeriodSummary;
}>;

function sumTotals(totalsByCategory: ExpenseSummary["totalsByCategory"]): number {
  return Object.values(totalsByCategory).reduce((sum, value) => sum + (value ?? 0), 0);
}

function toPeriod(summary: ExpenseSummary): ExpensePeriodSummary {
  return {
    totalMinor: sumTotals(summary.totalsByCategory),
    recordCount: summary.recordCount,
    truncated: summary.truncated,
    totalsByCategory: summary.totalsByCategory,
  };
}

/**
 * Actual spending summaries (PO-09, issue #350). Periods are owner-local
 * half-open ranges over the canonical ledger; totals are integer centime
 * sums of non-deleted rows only. A period with no records reports 0 with
 * recordCount 0 — callers must say "recorded" and never claim the owner
 * spent nothing.
 */
export async function getExpenseSummary(
  actor: AuthenticatedActor,
  repository: ExpenseRepository,
  input: Readonly<{ localDate: string; timezone: string }>,
): Promise<ApplicationResult<ExpenseSummaryResult>> {
  if (!isIsoDate(input.localDate)) {
    return applicationFailure("Use a valid calendar date.", "validation");
  }
  if (!isValidIANATimeZone(input.timezone)) {
    return applicationFailure("Use a valid time zone.", "validation");
  }

  let dayWindow: ReturnType<typeof getLocalDayWindow>;
  let weekStart: string;
  try {
    dayWindow = getLocalDayWindow(input.timezone, input.localDate);
    weekStart = getWeekWindow(input.timezone, input.localDate).weekStart;
  } catch {
    return applicationFailure("Unable to resolve the summary window.", "validation");
  }
  const monthStart = `${input.localDate.slice(0, 7)}-01`;
  const weekWindowStart = getLocalDayWindow(input.timezone, weekStart).startUtcIso;
  const monthWindowStart = getLocalDayWindow(input.timezone, monthStart).startUtcIso;
  const endUtcExclusiveIso = dayWindow.endUtcIso;

  // Booking-date windows include date-only rows and are timezone-stable.
  const endBookingDateExclusive = addDaysToIsoDate(input.localDate, 1);
  const [dayResult, weekResult, monthResult] = await Promise.all([
    repository.summarize(actor, {
      startUtcIso: dayWindow.startUtcIso,
      endUtcExclusiveIso,
      startBookingDate: input.localDate,
      endBookingDateExclusive,
    }),
    repository.summarize(actor, {
      startUtcIso: weekWindowStart,
      endUtcExclusiveIso,
      startBookingDate: weekStart,
      endBookingDateExclusive,
    }),
    repository.summarize(actor, {
      startUtcIso: monthWindowStart,
      endUtcExclusiveIso,
      startBookingDate: monthStart,
      endBookingDateExclusive,
    }),
  ]);
  if (!dayResult.ok || !weekResult.ok || !monthResult.ok) {
    return applicationFailure("Unable to load spending summaries right now.", "unknown");
  }

  const coffeeMonthTotal = monthResult.value.totalsByCategory.coffee ?? 0;

  return applicationSuccess({
    localDate: input.localDate,
    timezone: input.timezone,
    day: toPeriod(dayResult.value),
    weekToDate: toPeriod(weekResult.value),
    monthToDate: toPeriod(monthResult.value),
    coffee: {
      totalMinor: coffeeMonthTotal,
      recordCount: monthResult.value.countsByCategory.coffee ?? 0,
      truncated: monthResult.value.truncated,
      totalsByCategory:
        coffeeMonthTotal > 0 ? { coffee: coffeeMonthTotal } : {},
    },
  });
}
