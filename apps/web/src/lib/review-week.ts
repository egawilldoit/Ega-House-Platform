/**
 * Review week helpers — canonical delegation.
 * The single source of truth for week bounds is @ega/domain/time-context
 * (canonical timezone-aware). This module preserves the existing web import
 * path but delegates to the domain so no second source exists.
 */

import { getLocalDateInTimezone, getWeekWindow as getDomainWeekWindow } from "@ega/domain";

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * @deprecated Use `getLocalDateInTimezone` with the user's canonical Time Context timezone.
 * This UTC helper is retained for non-review surfaces and legacy callers but must not be
 * used as the canonical user-day authority for Weekly Review. Weekly Review must derive
 * `today` via the stored `user_time_context.iana_timezone` through the canonical domain
 * Time Context helpers so that early-morning Asia/Tokyo (and other offsets) does not
 * collapse to the previous UTC day.
 */
export function getTodayIsoDate() {
  return toIsoDate(new Date());
}

export function getLocalTodayIsoDate(timezone: string, now: Date = new Date()): string {
  return getLocalDateInTimezone(now, timezone);
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === value;
}

export function getWeekBounds(weekOf: string) {
  if (!isIsoDate(weekOf)) return null;
  try {
    const window = getDomainWeekWindow("UTC", weekOf);
    return { weekStart: window.weekStart, weekEnd: window.weekEnd };
  } catch {
    return null;
  }
}

export function getWeekWindow(weekStart: string, weekEnd: string) {
  // Domain expects a single date within the week; use weekStart as anchor.
  // UTC is preserved for backward compatibility where weekStart/weekEnd are already resolved.
  const startIso = `${weekStart}T00:00:00.000Z`;
  const endExclusiveDate = new Date(`${weekEnd}T00:00:00.000Z`);
  endExclusiveDate.setUTCDate(endExclusiveDate.getUTCDate() + 1);
  return {
    startIso,
    endExclusiveIso: `${toIsoDate(endExclusiveDate)}T00:00:00.000Z`,
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
