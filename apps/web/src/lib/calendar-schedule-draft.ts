export const SCHEDULE_DURATION_PRESETS = [30, 60, 90, 120] as const;

export type ScheduleDurationPreset = (typeof SCHEDULE_DURATION_PRESETS)[number];

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

type WallParts = {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
};

function wallPartsInTimeZone(date: Date, timeZone?: string): WallParts {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
    };
  }

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const rawHours = get("hour");
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hours: rawHours === 24 ? 0 : rawHours,
      minutes: get("minute"),
    };
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
    };
  }
}

function formatWallParts(parts: WallParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(
    parts.hours,
  )}:${pad2(parts.minutes)}`;
}

function parseWallDateTimeInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const utcMs = Date.UTC(year, month, day, hours, minutes, 0, 0);
  const check = new Date(utcMs);
  if (
    Number.isNaN(utcMs) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hours ||
    check.getUTCMinutes() !== minutes
  ) {
    return null;
  }
  return utcMs;
}

function formatUtcWallMs(utcMs: number): string {
  const date = new Date(utcMs);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate(),
  )}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

/**
 * Formats an ISO timestamp (or Date) into a `datetime-local` wall-time string
 * (`YYYY-MM-DDTHH:mm`) in the canonical account timezone when provided.
 */
export function toLocalDateTimeInputValue(
  value: string | Date | null,
  timeZone?: string,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatWallParts(wallPartsInTimeZone(date, timeZone));
}

/**
 * Adds `minutes` to a `YYYY-MM-DDTHH:mm` wall-time string using pure calendar
 * wall arithmetic (independent of browser timezone).
 */
export function addMinutesToLocalDateTime(
  localDateTime: string,
  minutes: number,
): string {
  const parsedMs = parseWallDateTimeInput(localDateTime);
  if (parsedMs === null || !Number.isFinite(minutes) || minutes <= 0) return "";
  return formatUtcWallMs(parsedMs + minutes * 60_000);
}

/** Returns the positive minute span between two `datetime-local` wall strings. */
export function durationMinutesBetween(
  startLocal: string,
  endLocal: string,
): number | null {
  const startMs = parseWallDateTimeInput(startLocal);
  const endMs = parseWallDateTimeInput(endLocal);
  if (startMs === null || endMs === null) return null;
  const diff = Math.round((endMs - startMs) / 60_000);
  return diff > 0 ? diff : null;
}

/**
 * Builds a ready-to-submit schedule block in the canonical account timezone
 * (`timeZone`) for Today (`dayOffset = 0`) or Tomorrow (`dayOffset = 1`).
 * Today snaps to the next 30-minute boundary at least 10 minutes ahead;
 * Tomorrow starts at 09:00 in the account timezone.
 */
export function buildQuickScheduleBlock(
  dayOffset: 0 | 1,
  durationMinutes = 60,
  now: Date = new Date(),
  timeZone?: string,
): { start: string; end: string } {
  const safeDuration =
    Number.isFinite(durationMinutes) && durationMinutes >= 15
      ? Math.round(durationMinutes)
      : 60;

  let startWallMs: number;
  if (dayOffset === 0) {
    const candidate = new Date(now.getTime() + 10 * 60_000);
    const parts = wallPartsInTimeZone(candidate, timeZone);
    const baseMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hours,
      parts.minutes,
      0,
      0,
    );
    const remainder = parts.minutes % 30;
    startWallMs =
      remainder === 0 ? baseMs : baseMs + (30 - remainder) * 60_000;
  } else {
    const todayParts = wallPartsInTimeZone(now, timeZone);
    startWallMs = Date.UTC(
      todayParts.year,
      todayParts.month - 1,
      todayParts.day + 1,
      9,
      0,
      0,
      0,
    );
  }

  return {
    start: formatUtcWallMs(startWallMs),
    end: formatUtcWallMs(startWallMs + safeDuration * 60_000),
  };
}

export function formatDurationChipLabel(minutes: number): string {
  if (minutes === 90) return "1.5h";
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function dayKey(parts: Pick<WallParts, "year" | "month" | "day">): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function formatDayPrefixFromParts(
  parts: Pick<WallParts, "year" | "month" | "day">,
  todayParts: Pick<WallParts, "year" | "month" | "day">,
): string {
  const key = dayKey(parts);
  if (key === dayKey(todayParts)) return "Today";
  const tomorrow = new Date(
    Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day + 1),
  );
  const tomorrowKey = `${tomorrow.getUTCFullYear()}-${pad2(
    tomorrow.getUTCMonth() + 1,
  )}-${pad2(tomorrow.getUTCDate())}`;
  if (key === tomorrowKey) return "Tomorrow";
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatCompactWallTime(parts: Pick<WallParts, "hours" | "minutes">): string {
  const period = parts.hours >= 12 ? "PM" : "AM";
  const hour12 = parts.hours % 12 === 0 ? 12 : parts.hours % 12;
  return `${hour12}:${pad2(parts.minutes)} ${period}`;
}

/**
 * Formats a task's schedule block (or planned all-day date) into a compact,
 * scannable label for task rows (e.g. `Today 5:30 PM–7:30 PM`, `Nov 25, all day`)
 * in the canonical account timezone when provided.
 */
export function formatTaskScheduleSummary(
  scheduledStartAt: string | null | undefined,
  scheduledEndAt: string | null | undefined,
  plannedForDate?: string | null,
  now: Date = new Date(),
  timeZone?: string,
): string | null {
  const todayParts = wallPartsInTimeZone(now, timeZone);

  if (scheduledStartAt && scheduledEndAt) {
    const start = new Date(scheduledStartAt);
    const end = new Date(scheduledEndAt);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const startParts = wallPartsInTimeZone(start, timeZone);
      const endParts = wallPartsInTimeZone(end, timeZone);
      const dayLabel = formatDayPrefixFromParts(startParts, todayParts);
      if (dayKey(startParts) === dayKey(endParts)) {
        return `${dayLabel} ${formatCompactWallTime(startParts)}–${formatCompactWallTime(endParts)}`;
      }
      return `${dayLabel} ${formatCompactWallTime(startParts)}–${formatDayPrefixFromParts(endParts, todayParts)} ${formatCompactWallTime(endParts)}`;
    }
  }

  if (plannedForDate && /^\d{4}-\d{2}-\d{2}$/.test(plannedForDate)) {
    const [year, month, day] = plannedForDate.split("-").map(Number);
    return `${formatDayPrefixFromParts({ year, month, day }, todayParts)}, all day`;
  }

  return null;
}
