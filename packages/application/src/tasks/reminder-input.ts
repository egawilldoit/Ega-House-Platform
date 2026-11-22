import { zonedWallTimeToUtcIso } from "@ega/domain";

export const TASK_REMINDER_CHANNEL_VALUES = ["email"] as const;
export const TASK_REMINDER_STATUS_VALUES = [
  "pending",
  "processing",
  "sent",
  "failed",
  "cancelled",
] as const;

export type TaskReminderChannel = (typeof TASK_REMINDER_CHANNEL_VALUES)[number];
export type TaskReminderStatus = (typeof TASK_REMINDER_STATUS_VALUES)[number];

export function isTaskReminderChannel(value: string): value is TaskReminderChannel {
  return TASK_REMINDER_CHANNEL_VALUES.includes(value as TaskReminderChannel);
}

export function isTaskReminderStatus(value: string): value is TaskReminderStatus {
  return TASK_REMINDER_STATUS_VALUES.includes(value as TaskReminderStatus);
}

/**
 * Parse a reminder time that can arrive either as a `datetime-local` wall time
 * in the owner's timezone or as an absolute instant.
 */
export function parseTaskReminderDateTime(rawValue: string, timezone: unknown) {
  const localMatch = rawValue.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!localMatch) {
    const parsed = new Date(rawValue);
    return Number.isNaN(parsed.getTime())
      ? { errorMessage: "Reminder time is required.", value: null }
      : { errorMessage: null, value: parsed };
  }

  const normalizedTimezone = String(timezone ?? "").trim();
  if (!normalizedTimezone) {
    return { errorMessage: "Reminder timezone is required.", value: null };
  }

  try {
    const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue = "00"] =
      localMatch;
    const isoValue = zonedWallTimeToUtcIso({
      timezone: normalizedTimezone,
      date: `${yearValue}-${monthValue}-${dayValue}`,
      time: `${hourValue}:${minuteValue}:${secondValue}`,
    });
    return { errorMessage: null, value: new Date(isoValue) };
  } catch {
    return { errorMessage: "Reminder time is invalid for the account timezone.", value: null };
  }
}

export function normalizeTaskReminderCreateInput(input: {
  taskId: string;
  remindAt: unknown;
  channel?: unknown;
  status?: unknown;
  timezone?: unknown;
  now?: Date;
}) {
  const taskId = input.taskId.trim();
  const channel = String(input.channel ?? "email").trim() || "email";
  const status = String(input.status ?? "pending").trim() || "pending";
  const rawRemindAt = String(input.remindAt ?? "").trim();
  const reminderTimeResult = parseTaskReminderDateTime(rawRemindAt, input.timezone);
  const remindAtDate = reminderTimeResult.value;
  const now = input.now ?? new Date();

  if (!taskId) {
    return { errorMessage: "Task is required." };
  }

  if (!rawRemindAt || reminderTimeResult.errorMessage || !remindAtDate) {
    return {
      errorMessage: reminderTimeResult.errorMessage ?? "Reminder time is required.",
    };
  }

  if (!isTaskReminderChannel(channel)) {
    return { errorMessage: "Reminder channel is not supported." };
  }

  if (!isTaskReminderStatus(status) || status !== "pending") {
    return { errorMessage: "Reminder status is not supported." };
  }

  if (remindAtDate.getTime() <= now.getTime()) {
    return { errorMessage: "Reminder time must be in the future." };
  }

  return {
    errorMessage: null,
    data: {
      taskId,
      remindAtIso: remindAtDate.toISOString(),
      channel,
      status,
    },
  };
}

export function normalizeTaskReminderCancelInput(input: {
  taskId: string;
  reminderId: string;
  status?: unknown;
}) {
  const taskId = input.taskId.trim();
  const reminderId = input.reminderId.trim();
  const status = String(input.status ?? "cancelled").trim() || "cancelled";

  if (!taskId || !reminderId) {
    return { errorMessage: "Reminder cancel request is invalid." };
  }

  if (!isTaskReminderStatus(status) || status !== "cancelled") {
    return { errorMessage: "Reminder status is not supported." };
  }

  return {
    errorMessage: null,
    data: {
      taskId,
      reminderId,
      status,
    },
  };
}
