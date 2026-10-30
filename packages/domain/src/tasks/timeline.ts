/**
 * Day-based task timeline semantics.
 *
 * Dates are inclusive date-only values (`YYYY-MM-DD`). A task bar exists only
 * when both `start_date` and `due_date` are real dates and `due_date >=
 * start_date`; a same-day task is a valid one-day bar. Missing dates are never
 * replaced with invented values — such tasks stay in the unscheduled list.
 */

export type TaskDateWindow = Readonly<{
  startDate: string | null;
  dueDate: string | null;
}>;

export function isIsoDateOnly(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Inclusive start/due window; `dueDate` may equal `startDate` (one-day bar). */
export function isTaskDateWindowValid(startDate: unknown, dueDate: unknown) {
  const start = String(startDate ?? "").trim();
  const due = String(dueDate ?? "").trim();
  if (!start && !due) return true;
  if (start && !isIsoDateOnly(start)) return false;
  if (due && !isIsoDateOnly(due)) return false;
  if (start && due && due < start) return false;
  return true;
}

/**
 * The drawable bar window, or `null` when the task cannot honestly be drawn.
 * A due-only or start-only task is unscheduled, not a fabricated bar.
 */
export function getTaskBarWindow(
  startDate: string | null | undefined,
  dueDate: string | null | undefined,
): { startDate: string; dueDate: string } | null {
  if (!isIsoDateOnly(startDate) || !isIsoDateOnly(dueDate)) return null;
  if (dueDate < startDate) return null;
  return { startDate, dueDate };
}
