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

export function isoDateAtOffset(daysFromToday: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
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
