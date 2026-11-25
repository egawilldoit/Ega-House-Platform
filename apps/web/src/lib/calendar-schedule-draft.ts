export const SCHEDULE_DURATION_PRESETS = [30, 60, 90, 120] as const;

export type ScheduleDurationPreset = (typeof SCHEDULE_DURATION_PRESETS)[number];

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/**
 * Formats an ISO timestamp (or Date) into a browser `datetime-local` value
 * (`YYYY-MM-DDTHH:mm`) in local wall time.
 */
export function toLocalDateTimeInputValue(value: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

function parseLocalDateTimeInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  const date = new Date(year, month, day, hours, minutes, 0, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  ) {
    return null;
  }
  return date;
}

/** Adds `minutes` to a `YYYY-MM-DDTHH:mm` local input string. */
export function addMinutesToLocalDateTime(
  localDateTime: string,
  minutes: number,
): string {
  const parsed = parseLocalDateTimeInput(localDateTime);
  if (!parsed || !Number.isFinite(minutes) || minutes <= 0) return "";
  const next = new Date(parsed.getTime() + minutes * 60_000);
  return toLocalDateTimeInputValue(next);
}

/** Returns the positive minute span between two `datetime-local` strings. */
export function durationMinutesBetween(
  startLocal: string,
  endLocal: string,
): number | null {
  const start = parseLocalDateTimeInput(startLocal);
  const end = parseLocalDateTimeInput(endLocal);
  if (!start || !end) return null;
  const diff = Math.round((end.getTime() - start.getTime()) / 60_000);
  return diff > 0 ? diff : null;
}

/**
 * Builds a ready-to-submit local schedule block for Today (`dayOffset = 0`)
 * or Tomorrow (`dayOffset = 1`). Today snaps to the next 30-minute boundary at
 * least 10 minutes ahead; Tomorrow starts at 09:00 local time.
 */
export function buildQuickScheduleBlock(
  dayOffset: 0 | 1,
  durationMinutes = 60,
  now: Date = new Date(),
): { start: string; end: string } {
  const safeDuration =
    Number.isFinite(durationMinutes) && durationMinutes >= 15
      ? Math.round(durationMinutes)
      : 60;
  let startDate: Date;

  if (dayOffset === 0) {
    const candidate = new Date(now.getTime() + 10 * 60_000);
    candidate.setSeconds(0, 0);
    const remainder = candidate.getMinutes() % 30;
    if (remainder !== 0) {
      candidate.setMinutes(candidate.getMinutes() + (30 - remainder));
    }
    startDate = candidate;
  } else {
    startDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      9,
      0,
      0,
      0,
    );
  }

  const endDate = new Date(startDate.getTime() + safeDuration * 60_000);
  return {
    start: toLocalDateTimeInputValue(startDate),
    end: toLocalDateTimeInputValue(endDate),
  };
}

export function formatDurationChipLabel(minutes: number): string {
  if (minutes === 90) return "1.5h";
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDayPrefix(date: Date, now: Date): string {
  if (sameLocalDay(date, now)) return "Today";
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameLocalDay(date, tomorrow)) return "Tomorrow";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCompactTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats a task's schedule block (or planned all-day date) into a compact,
 * scannable label for task rows (e.g. `Today 5:30 PM–7:30 PM`, `Nov 25, all day`).
 */
export function formatTaskScheduleSummary(
  scheduledStartAt: string | null | undefined,
  scheduledEndAt: string | null | undefined,
  plannedForDate?: string | null,
  now: Date = new Date(),
): string | null {
  if (scheduledStartAt && scheduledEndAt) {
    const start = new Date(scheduledStartAt);
    const end = new Date(scheduledEndAt);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      const dayLabel = formatDayPrefix(start, now);
      if (sameLocalDay(start, end)) {
        return `${dayLabel} ${formatCompactTime(start)}–${formatCompactTime(end)}`;
      }
      return `${dayLabel} ${formatCompactTime(start)}–${formatDayPrefix(end, now)} ${formatCompactTime(end)}`;
    }
  }

  if (plannedForDate && /^\d{4}-\d{2}-\d{2}$/.test(plannedForDate)) {
    const [year, month, day] = plannedForDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (!Number.isNaN(date.getTime())) {
      return `${formatDayPrefix(date, now)}, all day`;
    }
  }

  return null;
}
