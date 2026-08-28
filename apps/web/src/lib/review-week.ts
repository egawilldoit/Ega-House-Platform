import {
  getLocalDateInTimezone as getDomainLocalDate,
  getWeekWindow as getDomainWeekWindow,
  getLocalDayWindow as getDomainDayWindow,
} from "@ega/domain";
import { resolveHistoricalTimeContext } from "@ega/application";

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getTodayIsoDate() {
  // Canonical UTC fallback; server-TZ independent via explicit UTC.
  // For user-local Today, use getTodayIsoDateForTimezone.
  return toIsoDate(new Date());
}

export function getTodayIsoDateForTimezone(timezone: string | null | undefined, now = new Date()) {
  try {
    return getDomainLocalDate(now, timezone ?? "UTC");
  } catch {
    return toIsoDate(now);
  }
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === value;
}

export function getWeekBounds(weekOf: string) {
  // Canonical via @ega/domain (UTC) — preserves existing UTC semantics but uses single owner.
  // For timezone-aware bounds, use getWeekBoundsForTimezone.
  try {
    const w = getDomainWeekWindow("UTC", weekOf);
    return { weekStart: w.weekStart, weekEnd: w.weekEnd };
  } catch {
    return null;
  }
}

export function getWeekBoundsForTimezone(weekOf: string, timezone: string | null | undefined) {
  const result = resolveHistoricalTimeContext({ timezone: timezone ?? "UTC", date: weekOf });
  if (!result.ok) return null;
  return {
    weekStart: result.data.weekWindow.weekStart,
    weekEnd: result.data.weekWindow.weekEnd,
  };
}

export function getWeekWindow(weekStart: string, weekEnd: string) {
  // UTC canonical via domain; caller should prefer getWeekWindowForTimezone for user-local.
  try {
    const startWindow = getDomainDayWindow("UTC", weekStart);
    const endWindow = getDomainDayWindow("UTC", weekEnd);
    // endExclusive is next day after weekEnd at 00:00 UTC
    const endExclusiveIso = endWindow.endUtcIso;
    return {
      startIso: startWindow.startUtcIso,
      endExclusiveIso,
    };
  } catch {
    const startIso = `${weekStart}T00:00:00.000Z`;
    const endExclusiveDate = new Date(`${weekEnd}T00:00:00.000Z`);
    endExclusiveDate.setUTCDate(endExclusiveDate.getUTCDate() + 1);
    return {
      startIso,
      endExclusiveIso: `${toIsoDate(endExclusiveDate)}T00:00:00.000Z`,
    };
  }
}

export function getWeekWindowForTimezone(
  weekStart: string,
  weekEnd: string,
  timezone: string | null | undefined,
) {
  const tz = timezone ?? "UTC";
  try {
    const startWindow = getDomainDayWindow(tz, weekStart);
    // endExclusive is start of day after weekEnd in that timezone
    const weekEndDate = getDomainWeekWindow(tz, weekEnd);
    return {
      startIso: startWindow.startUtcIso,
      endExclusiveIso: weekEndDate.weekEndExclusiveUtcIso,
    };
  } catch {
    return getWeekWindow(weekStart, weekEnd);
  }
}

export function getWeekWindowViaTimeContext(timezone: string | null | undefined, date: string) {
  const result = resolveHistoricalTimeContext({ timezone: timezone ?? "UTC", date });
  if (!result.ok) return null;
  return {
    weekStart: result.data.weekWindow.weekStart,
    weekEnd: result.data.weekWindow.weekEnd,
    startIso: result.data.weekWindow.weekStartUtcIso,
    endExclusiveIso: result.data.weekWindow.weekEndExclusiveUtcIso,
  };
}

export function shiftIsoDateByDays(isoDate: string, days: number) {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoDate(parsed);
}

export function formatIsoDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(isoDateTime: string) {
  return new Date(isoDateTime).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
