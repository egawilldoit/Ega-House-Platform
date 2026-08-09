/**
 * Types and helpers for work analytics URL query param filters.
 *
 * Supported params: range, groupBy, breakdownBy, includeOpen
 */

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
 */
export function computeWindowForRange(
  range: AnalyticsRange,
  now: Date,
): { startIso: string; endIso: string } {
  const end = new Date(now);
  const endIso = end.toISOString();

  switch (range) {
    case "today": {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      return { startIso: start.toISOString(), endIso };
    }
    case "7d": {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 7);
      return { startIso: start.toISOString(), endIso };
    }
    case "30d": {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - 30);
      return { startIso: start.toISOString(), endIso };
    }
    case "mtm": {
      // Month to date: from 1st of this month to now
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { startIso: start.toISOString(), endIso };
    }
    case "prev-month": {
      // Previous full calendar month
      const endOfPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const startOfPrev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return {
        startIso: startOfPrev.toISOString(),
        endIso: endOfPrev.toISOString(),
      };
    }
    case "qtd": {
      // Quarter to date: from 1st of current quarter to now
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      const start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
      return { startIso: start.toISOString(), endIso };
    }
    default:
      // Fallback to 30d
      {
        const start = new Date(now);
        start.setUTCDate(start.getUTCDate() - 30);
        return { startIso: start.toISOString(), endIso };
      }
  }
}

/**
 * Get the start and end date strings (YYYY-MM-DD) covering the window.
 * Used for daily/weekly/monthly series computation.
 */
export function computeDateRangeForWindow(
  window: { startIso: string; endIso: string },
): { startDate: string; endDate: string } {
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
