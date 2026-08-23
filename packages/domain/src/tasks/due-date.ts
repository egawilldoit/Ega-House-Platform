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
