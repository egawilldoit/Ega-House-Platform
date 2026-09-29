/**
 * Types and helpers for work analytics URL query param filters.
 *
 * Supported params: range, groupBy, breakdownBy, includeOpen
 */

import {
  getLocalDateInTimezone,
  getLocalDayWindow,
  getLocalMonthWindow,
  getLocalQuarterWindow,
  getRollingLocalWindow,
} from "@ega/domain/time-context";

export type AnalyticsRange =
  | "today"
  | "7d"
  | "30d"
  | "mtm"
  | "prev-month"
  | "qtd";

export type AnalyticsGroupBy = "day" | "week" | "month";

export type AnalyticsBreakdownBy = "project" | "goal" | "task";

export type AnalyticsFilterValues = {
  range: AnalyticsRange;
  groupBy: AnalyticsGroupBy;
  breakdownBy: AnalyticsBreakdownBy;
  includeOpen: boolean;
};

const VALID_RANGES: readonly string[] = [
  "today",
  "7d",
  "30d",
  "mtm",
  "prev-month",
  "qtd",
] as const;

const VALID_GROUP_BYS: readonly string[] = ["day", "week", "month"] as const;

const VALID_BREAKDOWN_BYS: readonly string[] = [
  "project",
  "goal",
  "task",
] as const;

export const DEFAULT_RANGE: AnalyticsRange = "30d";
export const DEFAULT_GROUP_BY: AnalyticsGroupBy = "day";
export const DEFAULT_BREAKDOWN_BY: AnalyticsBreakdownBy = "project";
export const DEFAULT_INCLUDE_OPEN = false;

export function parseRange(value: string | undefined | null): AnalyticsRange {
  if (value && (VALID_RANGES as readonly string[]).includes(value)) {
    return value as AnalyticsRange;
  }
  return DEFAULT_RANGE;
}

export function parseGroupBy(
  value: string | undefined | null,
): AnalyticsGroupBy {
  if (value && (VALID_GROUP_BYS as readonly string[]).includes(value)) {
    return value as AnalyticsGroupBy;
  }
  return DEFAULT_GROUP_BY;
}

export function parseBreakdownBy(
  value: string | undefined | null,
): AnalyticsBreakdownBy {
  if (value && (VALID_BREAKDOWN_BYS as readonly string[]).includes(value)) {
    return value as AnalyticsBreakdownBy;
  }
  return DEFAULT_BREAKDOWN_BY;
}

export function parseIncludeOpen(
  value: string | undefined | null,
): boolean {
  if (value === "true" || value === "1") return true;
  return DEFAULT_INCLUDE_OPEN;
}

/**
 * Parse all analytics filter params from URLSearchParams.
 * Falls back to safe defaults for invalid or missing params.
 */
export function parseAnalyticsFilters(
  searchParams: URLSearchParams,
): AnalyticsFilterValues {
  return {
    range: parseRange(searchParams.get("range")),
    groupBy: parseGroupBy(searchParams.get("groupBy")),
    breakdownBy: parseBreakdownBy(searchParams.get("breakdownBy")),
    includeOpen: parseIncludeOpen(searchParams.get("includeOpen")),
  };
}

/**
 * Compute the window (startIso/endIso) for a given range and a reference now.
 *
 * Windows follow the owner's local calendar in `timezone` (IANA): today starts
 * at local midnight, month-to-date starts on the 1st of the local month, and
 * quarter-to-date on the 1st of the local quarter. Omitting `timezone` keeps
 * the legacy UTC behavior.
 */
export function computeWindowForRange(
  range: AnalyticsRange,
  now: Date,
  timezone?: string,
): { startIso: string; endIso: string } {
  const end = new Date(now);
  const endIso = end.toISOString();
  const localDate = timezone ? getLocalDateInTimezone(now, timezone) : null;

  switch (range) {
    case "today": {
      const start = localDate
        ? getLocalDayWindow(timezone, localDate).startUtcIso
        : (() => {
            const start = new Date(now);
            start.setUTCHours(0, 0, 0, 0);
            return start.toISOString();
          })();
      return { startIso: start, endIso };
    }
    case "7d": {
      const start = localDate
        ? getRollingLocalWindow(timezone, now, 7).startIso
        : (() => {
            const start = new Date(now);
            start.setUTCDate(start.getUTCDate() - 7);
            return start.toISOString();
          })();
      return { startIso: start, endIso };
    }
    case "30d": {
      const start = localDate
        ? getRollingLocalWindow(timezone, now, 30).startIso
        : (() => {
            const start = new Date(now);
            start.setUTCDate(start.getUTCDate() - 30);
            return start.toISOString();
          })();
      return { startIso: start, endIso };
    }
    case "mtm": {
      // Month to date: from 1st of the local month to now
      if (localDate) {
        const monthStart = `${localDate.slice(0, 8)}01`;
        const start = getLocalDayWindow(timezone, monthStart).startUtcIso;
        return { startIso: start, endIso };
      }
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { startIso: start.toISOString(), endIso };
    }
    case "prev-month": {
      // Previous full calendar month in the owner's local calendar
      if (localDate) {
        const [year, month] = localDate.split("-").map(Number);
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prevMonthStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
        const prevWindow = getLocalMonthWindow(timezone, prevMonthStart);
        return { startIso: prevWindow.startUtcIso, endIso: prevWindow.endUtcIso };
      }
      const endOfPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const startOfPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return {
        startIso: startOfPrev.toISOString(),
        endIso: endOfPrev.toISOString(),
      };
    }
    case "qtd": {
      // Quarter to date: from 1st of the local quarter to now
      if (localDate) {
        const quarterWindow = getLocalQuarterWindow(timezone, localDate);
        return { startIso: quarterWindow.startUtcIso, endIso };
      }
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      const start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
      return { startIso: start.toISOString(), endIso };
    }
    default:
      // Fallback to 30d
      {
        const start = localDate
          ? getRollingLocalWindow(timezone, now, 30).startIso
          : (() => {
              const start = new Date(now);
              start.setUTCDate(start.getUTCDate() - 30);
              return start.toISOString();
            })();
        return { startIso: start, endIso };
      }
  }
}

/**
 * Rolling last-30-days window used by the fixed context summary.
 */
export function computeLast30DaysWindow(
  now: Date,
  timezone?: string,
): { startIso: string; endIso: string } {
  if (timezone) {
    return getRollingLocalWindow(timezone, now, 30);
  }
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 30);
  return { startIso: start.toISOString(), endIso: now.toISOString() };
}

/**
 * Compute the bounded evidence-fetch window covering every section the analytics
 * report renders: the selected range, the fixed last-30-days context, and the
 * previous calendar month required for the month comparison.
 *
 * `endIso` is `now` so live/context sections are included. Each calculation
 * still filters the fetched sessions to its own exact canonical window, so this
 * only widens what is *fetched*, never which sessions count for a metric.
 */
export function computeEvidenceWindowForRange(
  range: AnalyticsRange,
  now: Date,
  timezone?: string,
): { startIso: string; endIso: string } {
  const selected = computeWindowForRange(range, now, timezone);
  const last30 = computeLast30DaysWindow(now, timezone);

  const previousMonthStart = timezone
    ? getLocalMonthWindow(timezone, getLocalDateInTimezone(now, timezone)).startUtcIso
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();

  const startIso = [selected.startIso, last30.startIso, previousMonthStart].sort()[0];

  return { startIso, endIso: now.toISOString() };
}

/**
 * Get the start and end date strings (YYYY-MM-DD) covering the window.
 * Used for daily/weekly/monthly series computation. When `timezone` is
 * supplied, dates are the owner's local calendar dates; otherwise UTC dates.
 */
export function computeDateRangeForWindow(
  window: { startIso: string; endIso: string },
  timezone?: string,
): { startDate: string; endDate: string } {
  if (timezone) {
    return {
      startDate: getLocalDateInTimezone(new Date(window.startIso), timezone),
      endDate: getLocalDateInTimezone(new Date(window.endIso), timezone),
    };
  }
  return {
    startDate: window.startIso.slice(0, 10),
    endDate: window.endIso.slice(0, 10),
  };
}

/**
 * Build a URL query string preserving existing params while updating one key.
 */
export function buildFilterHref(
  currentParams: URLSearchParams,
  key: string,
  value: string | null,
): string {
  const next = new URLSearchParams(currentParams.toString());
  if (value === null || value === "") {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Human-readable labels for each range.
 */
export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  mtm: "Month to date",
  "prev-month": "Previous month",
  qtd: "Quarter to date",
};

/**
 * Human label for the window a selected-range comparison actually uses.
 *
 * Rolling ranges compare against the immediately preceding equal-length window;
 * `prev-month` compares against the previous calendar month. Calendar-to-date
 * ranges (mtm/qtd) are duration-matched, so the label states the real day count
 * instead of implying a calendar-equivalent period.
 */
export function buildComparisonLabel(
  range: AnalyticsRange,
  window: { startIso: string; endIso: string },
): string {
  switch (range) {
    case "today":
      return "vs previous day";
    case "7d":
      return "vs previous 7 days";
    case "30d":
      return "vs previous 30 days";
    case "prev-month":
      return "vs previous month";
    default: {
      const startMs = new Date(window.startIso).getTime();
      const endMs = new Date(window.endIso).getTime();
      const days = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
      return `vs previous ${days} days`;
    }
  }
}

/** Window immediately before `window` with the same duration. */
export function computePreviousEquivalentWindow(window: {
  startIso: string;
  endIso: string;
}): { startIso: string; endIso: string } {
  const startMs = new Date(window.startIso).getTime();
  const endMs = new Date(window.endIso).getTime();
  const durationMs = Math.max(0, endMs - startMs);
  return {
    startIso: new Date(startMs - durationMs).toISOString(),
    endIso: window.startIso,
  };
}

export const GROUP_BY_LABELS: Record<AnalyticsGroupBy, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

export const BREAKDOWN_BY_LABELS: Record<AnalyticsBreakdownBy, string> = {
  project: "Project",
  goal: "Goal",
  task: "Task",
};
