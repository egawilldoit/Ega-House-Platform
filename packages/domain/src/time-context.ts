const FALLBACK_NONE = "none" as const;
const FALLBACK_MISSING = "missing_timezone" as const;
const FALLBACK_INVALID = "invalid_timezone" as const;

export type TimeContextFallback = typeof FALLBACK_NONE | typeof FALLBACK_MISSING | typeof FALLBACK_INVALID;

export type LocalDayWindow = Readonly<{
  date: string;
  timezone: string;
  requestedTimezone: string | null;
  fallback: TimeContextFallback;
  startUtcIso: string;
  endUtcIso: string;
  durationHours: number;
}>;

export type LocalWeekWindow = Readonly<{
  date: string;
  timezone: string;
  requestedTimezone: string | null;
  fallback: TimeContextFallback;
  weekStart: string;
  weekEnd: string;
  weekStartUtcIso: string;
  weekEndExclusiveUtcIso: string;
}>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const dim = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dim[month - 1] ?? 31;
}

function parseIsoDate(dateStr: string): { year: number; month: number; day: number } | null {
  if (!ISO_DATE_RE.test(dateStr)) return null;
  const [yStr, mStr, dStr] = dateStr.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (year < 1 || year > 9999) return null;
  return { year, month, day };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

export function isValidIANATimeZone(timezone: string): boolean {
  if (!timezone || typeof timezone !== "string") return false;
  if (timezone.length > 128) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveEffectiveTimezone(requested: string | null | undefined): {
  effective: string;
  fallback: TimeContextFallback;
  requested: string | null;
} {
  const raw = typeof requested === "string" ? requested.trim() : "";
  if (!raw) {
    return { effective: "UTC", fallback: FALLBACK_MISSING, requested: raw ? raw : null };
  }
  if (isValidIANATimeZone(raw)) {
    return { effective: raw, fallback: FALLBACK_NONE, requested: raw };
  }
  return { effective: "UTC", fallback: FALLBACK_INVALID, requested: raw };
}

function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  let hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  if (hour === 24) hour = 0;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return 0;
  }
  const wallUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return (wallUtcMs - date.getTime()) / 60000;
}

function wallTimeToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const wallUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset = getTimezoneOffsetMinutes(new Date(wallUtcMs), timeZone);
  let utcMs = wallUtcMs - offset * 60000;
  const newOffset = getTimezoneOffsetMinutes(new Date(utcMs), timeZone);
  if (newOffset !== offset) {
    utcMs = wallUtcMs - newOffset * 60000;
    const finalOffset = getTimezoneOffsetMinutes(new Date(utcMs), timeZone);
    if (finalOffset !== newOffset) {
      utcMs = wallUtcMs - finalOffset * 60000;
    }
  }
  return new Date(utcMs);
}

function addDaysToIsoDate(dateStr: string, days: number): string {
  const parsed = parseIsoDate(dateStr);
  if (!parsed) return dateStr;
  const baseMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const nextMs = baseMs + days * 86400000;
  const next = new Date(nextMs);
  return toIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function getLocalWeekday(timeZone: string, year: number, month: number, day: number): number {
  const noonUtc = wallTimeToUtc(timeZone, year, month, day, 12, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" });
  const weekdayStr = formatter.format(noonUtc);
  const map: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  const value = map[weekdayStr];
  if (value === undefined) {
    const fallback = noonUtc.getUTCDay();
    return fallback;
  }
  return value;
}

export function getLocalDayWindow(
  requestedTimezone: string | null | undefined,
  dateStr: string,
): LocalDayWindow {
  const parsed = parseIsoDate(dateStr);
  if (!parsed) {
    throw new Error(`Invalid date: expected YYYY-MM-DD, got "${String(dateStr)}"`);
  }
  const resolved = resolveEffectiveTimezone(requestedTimezone);
  const startUtc = wallTimeToUtc(resolved.effective, parsed.year, parsed.month, parsed.day, 0, 0, 0, 0);
  const nextDayIso = addDaysToIsoDate(dateStr, 1);
  const nextParsed = parseIsoDate(nextDayIso);
  if (!nextParsed) throw new Error(`Invalid next date derived from "${dateStr}"`);
  const endUtc = wallTimeToUtc(
    resolved.effective,
    nextParsed.year,
    nextParsed.month,
    nextParsed.day,
    0,
    0,
    0,
    0,
  );
  const durationHours = (endUtc.getTime() - startUtc.getTime()) / 3600000;
  return {
    date: dateStr,
    timezone: resolved.effective,
    requestedTimezone: resolved.requested,
    fallback: resolved.fallback,
    startUtcIso: startUtc.toISOString(),
    endUtcIso: endUtc.toISOString(),
    durationHours,
  };
}

export function getWeekWindow(
  requestedTimezone: string | null | undefined,
  dateStr: string,
): LocalWeekWindow {
  const parsed = parseIsoDate(dateStr);
  if (!parsed) {
    throw new Error(`Invalid date: expected YYYY-MM-DD, got "${String(dateStr)}"`);
  }
  const resolved = resolveEffectiveTimezone(requestedTimezone);
  const weekday = getLocalWeekday(resolved.effective, parsed.year, parsed.month, parsed.day);
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  const weekStart = addDaysToIsoDate(dateStr, diffToMonday);
  const weekEnd = addDaysToIsoDate(weekStart, 6);
  const weekStartParsed = parseIsoDate(weekStart);
  const weekEndNextParsed = parseIsoDate(addDaysToIsoDate(weekEnd, 1));
  if (!weekStartParsed || !weekEndNextParsed) throw new Error("Invalid week boundary derived");
  const weekStartUtc = wallTimeToUtc(
    resolved.effective,
    weekStartParsed.year,
    weekStartParsed.month,
    weekStartParsed.day,
    0,
    0,
    0,
    0,
  );
  const weekEndExclusiveUtc = wallTimeToUtc(
    resolved.effective,
    weekEndNextParsed.year,
    weekEndNextParsed.month,
    weekEndNextParsed.day,
    0,
    0,
    0,
    0,
  );
  return {
    date: dateStr,
    timezone: resolved.effective,
    requestedTimezone: resolved.requested,
    fallback: resolved.fallback,
    weekStart,
    weekEnd,
    weekStartUtcIso: weekStartUtc.toISOString(),
    weekEndExclusiveUtcIso: weekEndExclusiveUtc.toISOString(),
  };
}

export function getLocalDateInTimezone(date: Date, timeZone: string): string {
  const resolved = resolveEffectiveTimezone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolved.effective,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Unable to format date in timezone");
  return `${year}-${month}-${day}`;
}

export function getCurrentLocalDayWindow(
  requestedTimezone: string | null | undefined,
  now: Date = new Date(),
): LocalDayWindow {
  const resolved = resolveEffectiveTimezone(requestedTimezone);
  const localDate = getLocalDateInTimezone(now, resolved.effective);
  const window = getLocalDayWindow(resolved.effective, localDate);
  if (resolved.fallback !== FALLBACK_NONE) {
    return {
      ...window,
      timezone: resolved.effective,
      requestedTimezone: resolved.requested,
      fallback: resolved.fallback,
    };
  }
  return window;
}

export function getCurrentWeekWindow(
  requestedTimezone: string | null | undefined,
  now: Date = new Date(),
): LocalWeekWindow {
  const resolved = resolveEffectiveTimezone(requestedTimezone);
  const localDate = getLocalDateInTimezone(now, resolved.effective);
  const window = getWeekWindow(resolved.effective, localDate);
  if (resolved.fallback !== FALLBACK_NONE) {
    return {
      ...window,
      timezone: resolved.effective,
      requestedTimezone: resolved.requested,
      fallback: resolved.fallback,
    };
  }
  return window;
}
