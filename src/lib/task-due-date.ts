function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function isTaskComplete(status: string | null | undefined) {
  return status === "done";
}

export function getTodayLocalIsoDate(now = new Date()) {
  return [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
  ].join("-");
}

export function isDateOnlyValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function shiftDateOnlyValue(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function normalizeTaskDueDateInput(rawValue: unknown) {
  const value = String(rawValue ?? "").trim();

  if (!value) {
    return { value: null, error: null };
  }

  if (!isDateOnlyValue(value)) {
    return {
      value: null,
      error: "Due date must be a valid date in YYYY-MM-DD format.",
    };
  }

  return { value, error: null };
}

export function formatTaskDueDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

export function isTaskOverdue(
  dueDate: string | null | undefined,
  status?: string | null,
  today = getTodayLocalIsoDate(),
) {
  return Boolean(dueDate && !isTaskComplete(status) && dueDate < today);
}

export function isTaskDueToday(
  dueDate: string | null | undefined,
  status?: string | null,
  today = getTodayLocalIsoDate(),
) {
  return Boolean(dueDate && !isTaskComplete(status) && dueDate === today);
}

export function isTaskDueSoon(
  dueDate: string | null | undefined,
  status?: string | null,
  today = getTodayLocalIsoDate(),
  daysAhead = 7,
) {
  if (!dueDate || isTaskComplete(status)) {
    return false;
  }

  const rangeEnd = shiftDateOnlyValue(today, daysAhead);
  return dueDate >= today && dueDate <= rangeEnd;
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
