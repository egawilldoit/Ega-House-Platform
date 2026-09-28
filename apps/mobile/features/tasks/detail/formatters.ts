import type {
  MobileTaskListItem,
  MobileTaskRecurrenceRule,
  MobileTaskReminder,
} from '@/types/tasks';

export type EditableTaskFields = {
  status: MobileTaskListItem['status'];
  priority: MobileTaskListItem['priority'];
  dueDate: string | null;
  estimateMinutesText: string;
  recurrenceRule: MobileTaskRecurrenceRule | null;
  description: string;
  blockedReason: string;
};

export type ReminderPickerMode = 'date' | 'time';

export function formatDueDate(value: string | null) {
  if (!value) {
    return 'No due date';
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatReminderTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRecurrenceRule(rule: MobileTaskRecurrenceRule | null) {
  if (!rule) {
    return 'Does not repeat';
  }

  if (rule === 'daily') {
    return 'Daily';
  }

  if (rule === 'weekdays') {
    return 'Weekdays';
  }

  if (rule === 'monthly:day-of-month') {
    return 'Monthly';
  }

  const weekday = rule.replace('weekly:', '');
  return `Weekly ${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;
}

export function createDefaultReminderDate() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 60);
  date.setSeconds(0, 0);
  return date;
}

export function formatReminderDraft(value: Date | null) {
  if (!value) {
    return 'No reminder time selected';
  }

  return value.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function sortReminders(reminders: MobileTaskReminder[]) {
  return [...reminders].sort((a, b) => {
    const aTime = new Date(a.remindAt).getTime();
    const bTime = new Date(b.remindAt).getTime();
    return bTime - aTime;
  });
}

/**
 * Canonical date-only value `daysFromToday` days from the owner's EGA House
 * local today. Unlike a device-local midnight converted to UTC, this derives
 * the calendar date from the account timezone so Today / Tomorrow / +7-day
 * shortcuts agree with web and the Hono transport.
 */
export function isoDateAtOffsetInTimezone(timezone: string, daysFromToday: number): string {
  const now = new Date();
  const localToday = isoDateInTimezone(now, timezone);
  const [year, month, day] = localToday.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + daysFromToday * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

function isoDateInTimezone(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return date.toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

export function createEditableDraft(task: MobileTaskListItem): EditableTaskFields {
  return {
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    estimateMinutesText: task.estimateMinutes === null ? '' : String(task.estimateMinutes),
    recurrenceRule: task.recurrence?.rule ?? null,
    description: task.description ?? '',
    blockedReason: task.blockedReason ?? '',
  };
}

export function isDraftDirty(task: MobileTaskListItem, draft: EditableTaskFields) {
  const original = createEditableDraft(task);

  return (
    original.status !== draft.status ||
    original.priority !== draft.priority ||
    original.dueDate !== draft.dueDate ||
    original.estimateMinutesText !== draft.estimateMinutesText ||
    original.recurrenceRule !== draft.recurrenceRule ||
    original.description !== draft.description ||
    original.blockedReason !== draft.blockedReason
  );
}
