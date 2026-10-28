import {
  getLocalDateInTimezone,
  getLocalDayWindow,
  getWeekWindow,
} from "@ega/domain/time-context";

import { isDateOnlyValue, shiftDateOnlyValue } from "@/lib/task-due-date";
import type {
  TaskCalendarDateField,
  TaskCalendarView,
} from "@/lib/task-list";

/**
 * Canonical calendar range + projection owner for the Tasks calendar.
 *
 * Date-only task fields (`due_date`, `planned_for_date`) stay calendar dates and
 * are never converted through an instant. Scheduled blocks and timer sessions
 * are instants and are placed in the owner's IANA timezone, split at local
 * midnight so a block crossing midnight or a DST boundary lands on both days
 * without double-counting.
 */

export const CALENDAR_MINUTE_MS = 60_000;

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type CalendarRange = Readonly<{
  view: TaskCalendarView;
  anchorDate: string;
  timezone: string;
  startDate: string;
  endDate: string;
  days: string[];
  startUtcIso: string;
  endUtcIso: string;
  monthLabel: string;
  rangeLabel: string;
  weekdayLabels: readonly string[];
}>;

export type CalendarTaskItem = {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectName: string | null;
  date: string;
  dateField: TaskCalendarDateField;
  hasScheduledBlock: boolean;
  calendarSyncEnabled: boolean;
  updatedAt: string;
};

export type CalendarTimedKind = "scheduled" | "session";

export type CalendarTimedItem = {
  kind: CalendarTimedKind;
  id: string;
  taskId: string;
  title: string;
  /** Local calendar day this segment belongs to (YYYY-MM-DD). */
  date: string;
  /** Minutes from local midnight for this day segment. */
  startMinute: number;
  endMinute: number;
  startLabel: string;
  endLabel: string;
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Sessions are evidence and are never editable from the calendar. */
  readOnly: boolean;
  updatedAt: string;
};

export type CalendarDay = {
  date: string;
  dayOfMonth: number;
  isToday: boolean;
  isOutsideMonth: boolean;
  /** Local day length in minutes (1380/1440/1500 across DST). */
  durationMinutes: number;
  tasks: CalendarTaskItem[];
  timed: CalendarTimedItem[];
};

export type TaskCalendarProjection = {
  view: TaskCalendarView;
  dateField: TaskCalendarDateField;
  anchorDate: string;
  timezone: string;
  startDate: string;
  endDate: string;
  startUtcIso: string;
  endUtcIso: string;
  days: CalendarDay[];
  monthLabel: string;
  rangeLabel: string;
  weekdayLabels: readonly string[];
  todayDate: string;
  /** Visible window reached the bounded row cap; the UI says so. */
  truncated: boolean;
};

export type CalendarProjectableTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  planned_for_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  calendar_sync_enabled: boolean;
  updated_at: string;
  projects?: { name?: string | null } | null;
};

export type CalendarProjectableSession = {
  id: string;
  taskId: string;
  title: string;
  startIso: string;
  endIso: string | null;
};

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toDateOnly(year: number, monthIndex: number, day: number) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function parseDateParts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function daysBetweenInclusive(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function buildDateSequence(startDate: string, endDate: string) {
  const total = daysBetweenInclusive(startDate, endDate);
  return Array.from({ length: total }, (_, index) => shiftDateOnlyValue(startDate, index));
}

export function shiftCalendarAnchor(
  view: TaskCalendarView,
  anchorDate: string,
  direction: -1 | 1,
): string {
  const safeAnchor = isDateOnlyValue(anchorDate)
    ? anchorDate
    : new Date().toISOString().slice(0, 10);

  if (view === "week") {
    return shiftDateOnlyValue(safeAnchor, direction * 7);
  }

  const { year, month, day } = parseDateParts(safeAnchor);
  const targetFirst = new Date(Date.UTC(year, month - 1 + direction, 1));
  const targetYear = targetFirst.getUTCFullYear();
  const targetMonthIndex = targetFirst.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  return toDateOnly(targetYear, targetMonthIndex, Math.min(day, lastDay));
}

export function formatMonthLabel(anchorDate: string) {
  const { year, month } = parseDateParts(anchorDate);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatShortDate(date: string) {
  const { year, month, day } = parseDateParts(date);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatWeekRangeLabel(startDate: string, endDate: string) {
  const { year } = parseDateParts(endDate);
  return `${formatShortDate(startDate)} – ${formatShortDate(endDate)}, ${year}`;
}

/**
 * Build the visible calendar range. The month grid always covers whole weeks
 * (Monday start, the shipped week-start default), so every date in the month
 * appears and no leading/trailing week is silently dropped.
 */
export function buildCalendarRange(input: {
  view: TaskCalendarView;
  anchorDate: string;
  timezone: string;
}): CalendarRange {
  const timezone = input.timezone?.trim() || "UTC";
  const anchorDate = isDateOnlyValue(input.anchorDate)
    ? input.anchorDate
    : new Date().toISOString().slice(0, 10);

  let startDate: string;
  let endDate: string;

  if (input.view === "week") {
    const week = getWeekWindow(timezone, anchorDate);
    startDate = week.weekStart;
    endDate = week.weekEnd;
  } else {
    const { year, month } = parseDateParts(anchorDate);
    // `toDateOnly` takes a zero-based month index; `month` from the date string
    // is one-based.
    const monthStart = toDateOnly(year, month - 1, 1);
    const nextMonthStart =
      month === 12 ? toDateOnly(year + 1, 0, 1) : toDateOnly(year, month, 1);
    const monthEnd = shiftDateOnlyValue(nextMonthStart, -1);
    const firstWeek = getWeekWindow(timezone, monthStart);
    const lastWeek = getWeekWindow(timezone, monthEnd);
    startDate = firstWeek.weekStart;
    endDate = lastWeek.weekEnd;
  }

  const days = buildDateSequence(startDate, endDate);
  const startUtcIso = getLocalDayWindow(timezone, startDate).startUtcIso;
  const endUtcIso = getLocalDayWindow(
    timezone,
    shiftDateOnlyValue(endDate, 1),
  ).startUtcIso;

  return {
    view: input.view,
    anchorDate,
    timezone,
    startDate,
    endDate,
    days,
    startUtcIso,
    endUtcIso,
    monthLabel: formatMonthLabel(anchorDate),
    rangeLabel:
      input.view === "week"
        ? formatWeekRangeLabel(startDate, endDate)
        : formatMonthLabel(anchorDate),
    weekdayLabels: WEEKDAY_LABELS,
  };
}

function formatClockMinute(totalMinutes: number) {
  const clamped = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

/** Local wall-clock date/time of an instant in the owner's timezone. */
export function getLocalWallTimeParts(
  iso: string,
  timezone: string,
): { date: string; time: string } | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  const date = getLocalDateInTimezone(new Date(parsed), timezone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(parsed));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return { date, time: `${hour === "24" ? "00" : hour}:${minute}` };
}

type TimedSegment = {
  date: string;
  startMinute: number;
  endMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

function splitInstantAcrossDays(input: {
  startIso: string;
  endIso: string;
  days: string[];
  timezone: string;
}): TimedSegment[] {
  const startMs = Date.parse(input.startIso);
  const endMs = Date.parse(input.endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [];
  }

  const segments: TimedSegment[] = [];
  for (const date of input.days) {
    const window = getLocalDayWindow(input.timezone, date);
    const dayStartMs = Date.parse(window.startUtcIso);
    const dayEndMs = Date.parse(window.endUtcIso);
    const overlapStart = Math.max(startMs, dayStartMs);
    const overlapEnd = Math.min(endMs, dayEndMs);
    if (overlapEnd <= overlapStart) continue;
    segments.push({
      date,
      startMinute: (overlapStart - dayStartMs) / CALENDAR_MINUTE_MS,
      endMinute: (overlapEnd - dayStartMs) / CALENDAR_MINUTE_MS,
      continuesBefore: startMs < dayStartMs,
      continuesAfter: endMs > dayEndMs,
    });
  }
  return segments;
}

function getTaskCalendarDate(
  task: CalendarProjectableTask,
  dateField: TaskCalendarDateField,
) {
  return dateField === "planned" ? task.planned_for_date : task.due_date;
}

export function buildTaskCalendarProjection(input: {
  range: CalendarRange;
  view: TaskCalendarView;
  dateField: TaskCalendarDateField;
  todayDate: string;
  nowIso?: string;
  tasks: CalendarProjectableTask[];
  scheduledTasks: CalendarProjectableTask[];
  sessions: CalendarProjectableSession[];
  truncated?: boolean;
}): TaskCalendarProjection {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const daysByDate = new Map<string, CalendarDay>(
    input.range.days.map((date) => {
      const dayOfMonth = parseDateParts(date).day;
      return [
        date,
        {
          date,
          dayOfMonth,
          isToday: date === input.todayDate,
          isOutsideMonth:
            input.view === "month" && date.slice(0, 7) !== input.range.anchorDate.slice(0, 7),
          durationMinutes: getCalendarDayDurationMinutes(date, input.range.timezone),
          tasks: [],
          timed: [],
        },
      ];
    }),
  );

  for (const task of input.tasks) {
    const date = getTaskCalendarDate(task, input.dateField);
    if (!date) continue;
    const day = daysByDate.get(date);
    if (!day) continue;
    day.tasks.push({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      projectName: task.projects?.name ?? null,
      date,
      dateField: input.dateField,
      hasScheduledBlock: Boolean(task.scheduled_start_at && task.scheduled_end_at),
      calendarSyncEnabled: task.calendar_sync_enabled,
      updatedAt: task.updated_at,
    });
  }

  for (const task of input.scheduledTasks) {
    if (!task.scheduled_start_at || !task.scheduled_end_at) continue;
    const segments = splitInstantAcrossDays({
      startIso: task.scheduled_start_at,
      endIso: task.scheduled_end_at,
      days: input.range.days,
      timezone: input.range.timezone,
    });
    for (const segment of segments) {
      const day = daysByDate.get(segment.date);
      if (!day) continue;
      day.timed.push({
        kind: "scheduled",
        id: `scheduled-${task.id}-${segment.date}`,
        taskId: task.id,
        title: task.title,
        date: segment.date,
        startMinute: segment.startMinute,
        endMinute: segment.endMinute,
        startLabel: formatClockMinute(segment.startMinute),
        endLabel: formatClockMinute(segment.endMinute),
        continuesBefore: segment.continuesBefore,
        continuesAfter: segment.continuesAfter,
        readOnly: false,
        updatedAt: task.updated_at,
      });
    }
  }

  for (const session of input.sessions) {
    const endIso = session.endIso ?? nowIso;
    const segments = splitInstantAcrossDays({
      startIso: session.startIso,
      endIso,
      days: input.range.days,
      timezone: input.range.timezone,
    });
    for (const segment of segments) {
      const day = daysByDate.get(segment.date);
      if (!day) continue;
      day.timed.push({
        kind: "session",
        id: `session-${session.id}-${segment.date}`,
        taskId: session.taskId,
        title: session.title,
        date: segment.date,
        startMinute: segment.startMinute,
        endMinute: segment.endMinute,
        startLabel: formatClockMinute(segment.startMinute),
        endLabel: formatClockMinute(segment.endMinute),
        continuesBefore: segment.continuesBefore,
        continuesAfter: segment.continuesAfter,
        readOnly: true,
        updatedAt: "",
      });
    }
  }

  const days = Array.from(daysByDate.values()).map((day) => ({
    ...day,
    timed: [...day.timed].sort((left, right) => {
      if (left.startMinute !== right.startMinute) {
        return left.startMinute - right.startMinute;
      }
      return left.title.localeCompare(right.title);
    }),
  }));

  return {
    view: input.view,
    dateField: input.dateField,
    anchorDate: input.range.anchorDate,
    timezone: input.range.timezone,
    startDate: input.range.startDate,
    endDate: input.range.endDate,
    startUtcIso: input.range.startUtcIso,
    endUtcIso: input.range.endUtcIso,
    days,
    monthLabel: input.range.monthLabel,
    rangeLabel: input.range.rangeLabel,
    weekdayLabels: input.range.weekdayLabels,
    todayDate: input.todayDate,
    truncated: input.truncated ?? false,
  };
}

/** The longest local day in the range; a DST fall-back day has 25 hours. */
export function getCalendarDayDurationMinutes(
  date: string,
  timezone: string,
): number {
  const window = getLocalDayWindow(timezone, date);
  return (Date.parse(window.endUtcIso) - Date.parse(window.startUtcIso)) / CALENDAR_MINUTE_MS;
}
