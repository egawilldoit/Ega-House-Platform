export const DEFAULT_CALENDAR_REMINDER_MINUTES = 10;
export const MAX_CALENDAR_REMINDER_MINUTES = 10080;

/**
 * Calendar reminder lead time is a whole number of minutes clamped to the
 * provider-supported window. Missing or unparseable input falls back to the
 * default instead of disabling reminders.
 */
export function normalizeCalendarReminderMinutes(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_CALENDAR_REMINDER_MINUTES;
  }

  return Math.min(Math.max(parsed, 0), MAX_CALENDAR_REMINDER_MINUTES);
}
