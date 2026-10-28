import { isTaskCompletedStatus } from "./status";

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function getLocalTodayIsoDate(now = new Date()) {
  return [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
  ].join("-");
}

function shiftIsoDate(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isTaskOverdue(
  dueDate: string | null | undefined,
  status?: string | null,
  today = getLocalTodayIsoDate(),
) {
  return Boolean(dueDate && !isTaskCompletedStatus(status) && dueDate < today);
}

export function isTaskDueToday(
  dueDate: string | null | undefined,
  status?: string | null,
  today = getLocalTodayIsoDate(),
) {
  return Boolean(dueDate && !isTaskCompletedStatus(status) && dueDate === today);
}

export function isTaskDueSoon(
  dueDate: string | null | undefined,
  status?: string | null,
  today = getLocalTodayIsoDate(),
  daysAhead = 7,
) {
  if (!dueDate || isTaskCompletedStatus(status)) {
    return false;
  }

  const rangeEnd = shiftIsoDate(today, daysAhead);
  return dueDate >= today && dueDate <= rangeEnd;
}

/**
 * Date-only due window used by saved-view `dueWithinDays` filters. Unlike
 * `isTaskDueSoon`, completion does not remove a task from an explicit window;
 * the window describes the calendar range the owner asked for.
 */
export function isTaskDueWithinDays(
  dueDate: string | null | undefined,
  today: string,
  days: number,
) {
  if (!dueDate || !Number.isSafeInteger(days) || days <= 0) {
    return false;
  }

  return dueDate >= today && dueDate <= shiftIsoDate(today, days);
}

export const TASK_DUE_BUCKET_VALUES = [
  "overdue",
  "today",
  "next_7_days",
  "later",
  "none",
] as const;

export type TaskDueBucket = (typeof TASK_DUE_BUCKET_VALUES)[number];

export function isTaskDueBucket(value: string): value is TaskDueBucket {
  return TASK_DUE_BUCKET_VALUES.includes(value as TaskDueBucket);
}

/**
 * Canonical due bucket for grouping and filtering.
 *
 * The three actionable buckets keep the existing product semantics: completed
 * work never counts as overdue/due-today/due-soon. Everything else that has a
 * due date lands in `later`, so the five buckets partition every task.
 */
export function getTaskDueBucket(
  dueDate: string | null | undefined,
  status: string | null | undefined,
  today: string,
): TaskDueBucket {
  if (!dueDate) return "none";
  if (isTaskOverdue(dueDate, status, today)) return "overdue";
  if (isTaskDueToday(dueDate, status, today)) return "today";
  if (isTaskDueSoon(dueDate, status, today, 7)) return "next_7_days";
  return "later";
}
