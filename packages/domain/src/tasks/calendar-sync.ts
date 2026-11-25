export const CALENDAR_SYNC_EXCLUSION_REASONS = [
  "completed",
  "archived",
  "opted_out",
  "deadline_only",
  "undated",
  "incomplete_time_block",
] as const;

export type CalendarSyncExclusionReason =
  (typeof CALENDAR_SYNC_EXCLUSION_REASONS)[number];

export const CALENDAR_SYNC_EXCLUSION_LABELS: Readonly<
  Record<CalendarSyncExclusionReason, string>
> = Object.freeze({
  completed: "Completed tasks are removed from the calendar.",
  archived: "Archived tasks are removed from the calendar.",
  opted_out: "Calendar sync is turned off for this task.",
  deadline_only: "A deadline without a planned date or time block is not published.",
  undated: "The task has no planned date or schedule block.",
  incomplete_time_block:
    "The task has only one time-block boundary, so the block is incomplete.",
});

export type CalendarTaskCalendarSnapshot = Readonly<{
  id: string;
  title: string;
  status: string;
  archivedAt: string | null;
  completedAt: string | null;
  calendarSyncEnabled: boolean;
  calendarReminderMinutes: number;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  plannedForDate: string | null;
  dueDate: string | null;
}>;

export type CalendarTaskEventPlan =
  | Readonly<{
      kind: "timed";
      start: Readonly<{ dateTime: string }>;
      end: Readonly<{ dateTime: string }>;
      exclusionReason: null;
    }>
  | Readonly<{
      kind: "all_day";
      start: Readonly<{ date: string }>;
      end: Readonly<{ date: string }>;
      exclusionReason: null;
    }>
  | Readonly<{
      kind: "excluded";
      start: null;
      end: null;
      exclusionReason: CalendarSyncExclusionReason;
    }>;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoCalendarDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Google all-day events use an exclusive end date. Adding one calendar day to
 * the planned local date keeps the event on exactly that date for every
 * viewer, including across a timezone transition.
 */
export function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Canonical publication plan for one task snapshot. A recurring task's current
 * materialized row is published as a standalone event; recurrence generation
 * creates a separate task row, so no folding or series payload is attempted.
 */
export function planCalendarTaskEvent(
  task: CalendarTaskCalendarSnapshot,
): CalendarTaskEventPlan {
  if (task.archivedAt) {
    return {
      kind: "excluded",
      start: null,
      end: null,
      exclusionReason: "archived",
    };
  }

  if (task.completedAt || task.status === "done") {
    return {
      kind: "excluded",
      start: null,
      end: null,
      exclusionReason: "completed",
    };
  }

  if (!task.calendarSyncEnabled) {
    return {
      kind: "excluded",
      start: null,
      end: null,
      exclusionReason: "opted_out",
    };
  }

  const hasStart = Boolean(task.scheduledStartAt);
  const hasEnd = Boolean(task.scheduledEndAt);

  if (hasStart !== hasEnd) {
    return {
      kind: "excluded",
      start: null,
      end: null,
      exclusionReason: "incomplete_time_block",
    };
  }

  if (hasStart && hasEnd) {
    const start = new Date(task.scheduledStartAt as string);
    const end = new Date(task.scheduledEndAt as string);

    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start.getTime() >= end.getTime()
    ) {
      return {
        kind: "excluded",
        start: null,
        end: null,
        exclusionReason: "incomplete_time_block",
      };
    }

    return {
      kind: "timed",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      exclusionReason: null,
    };
  }

  if (isIsoCalendarDate(task.plannedForDate)) {
    return {
      kind: "all_day",
      start: { date: task.plannedForDate },
      end: { date: addCalendarDays(task.plannedForDate, 1) },
      exclusionReason: null,
    };
  }

  if (task.dueDate) {
    return {
      kind: "excluded",
      start: null,
      end: null,
      exclusionReason: "deadline_only",
    };
  }

  return {
    kind: "excluded",
    start: null,
    end: null,
    exclusionReason: "undated",
  };
}
