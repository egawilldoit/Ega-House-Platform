import {
  getLocalTodayIsoDate,
  isTaskDateOnlyValue,
  isTaskDueSoon,
  isTaskDueToday,
  isTaskOverdue,
  shiftTaskDateOnlyValue,
} from "@ega/domain";

/**
 * Web-facing aliases for the canonical calendar-date helpers. The rules live in
 * `@ega/domain` so Web, Hono and MCP share one date authority.
 */
export const getTodayLocalIsoDate = getLocalTodayIsoDate;
export const isDateOnlyValue = isTaskDateOnlyValue;
export const shiftDateOnlyValue = shiftTaskDateOnlyValue;

export {
  isTaskDueSoon,
  isTaskDueToday,
  isTaskOverdue,
  normalizeTaskDueDateInput,
  normalizeTaskPlannedDateInput,
  normalizeTaskStartDateInput,
} from "@ega/domain";

export function formatTaskDueDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function getTaskDueDateState(
  dueDate: string | null | undefined,
  status?: string | null,
  today = getTodayLocalIsoDate(),
) {
  if (!dueDate) {
    return "none" as const;
  }

  if (isTaskOverdue(dueDate, status, today)) {
    return "overdue" as const;
  }

  if (isTaskDueToday(dueDate, status, today)) {
    return "today" as const;
  }

  if (isTaskDueSoon(dueDate, status, today)) {
    return "soon" as const;
  }

  return "scheduled" as const;
}
