import { addDaysToIsoDate, isIsoDate } from "../time-context";

type DateOnlyNormalizationResult =
  | { value: string; error: null }
  | { value: null; error: null }
  | { value: null; error: string };

function normalizeDateOnlyInput(
  rawValue: unknown,
  label: "Start date" | "Due date" | "Planned date",
): DateOnlyNormalizationResult {
  const value = String(rawValue ?? "").trim();

  if (!value) return { value: null, error: null };

  if (!isIsoDate(value)) {
    return {
      value: null,
      error: `${label} must be a valid date in YYYY-MM-DD format.`,
    };
  }

  return { value, error: null };
}

export function isTaskDateOnlyValue(value: string) {
  return isIsoDate(value);
}

export function shiftTaskDateOnlyValue(value: string, days: number) {
  return addDaysToIsoDate(value, days);
}

export function normalizeTaskStartDateInput(rawValue: unknown) {
  return normalizeDateOnlyInput(rawValue, "Start date");
}

export function normalizeTaskDueDateInput(rawValue: unknown) {
  return normalizeDateOnlyInput(rawValue, "Due date");
}

export function normalizeTaskPlannedDateInput(rawValue: unknown) {
  return normalizeDateOnlyInput(rawValue, "Planned date");
}
