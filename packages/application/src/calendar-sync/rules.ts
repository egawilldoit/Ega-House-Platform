import {
  DEFAULT_CALENDAR_REMINDER_MINUTES,
  MAX_CALENDAR_REMINDER_MINUTES,
  normalizeCalendarReminderMinutes,
  planCalendarTaskEvent,
  type CalendarTaskCalendarSnapshot,
  type CalendarSyncExclusionReason,
} from "@ega/domain";

import { sha256Hex } from "../shared/hash";

import type {
  CalendarEventPayload,
  CalendarSyncDestination,
  CalendarTaskScanRecord,
} from "./ports";

export const CALENDAR_SYNC_MAX_ATTEMPTS = 8;
export const CALENDAR_SYNC_DEFAULT_SCAN_PAGE_SIZE = 100;
export const CALENDAR_SYNC_DEFAULT_JOB_LIMIT = 8;
export const CALENDAR_SYNC_DEFAULT_BATCH_BUDGET_MS = 20_000;
export const CALENDAR_SYNC_DEFAULT_LEASE_SECONDS = 180;

const PAYLOAD_HASH_VERSION = "ega-house-calendar-payload-v1";
const EVENT_ID_VERSION = "ega-house-calendar-event-v1";

function normalizeOptional(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeCalendarDestination(input: {
  accountSubject: string | null | undefined;
  accountEmail: string | null | undefined;
  calendarId: string | null | undefined;
}): CalendarSyncDestination {
  const accountSubject = normalizeOptional(input.accountSubject);
  const accountEmail = normalizeOptional(input.accountEmail)?.toLowerCase() ?? null;
  const calendarId = normalizeOptional(input.calendarId) ?? "primary";
  const accountKey = accountSubject ?? accountEmail ?? "unknown-account";

  return {
    accountSubject,
    accountEmail,
    calendarId,
    destinationKey: `${accountKey}|${calendarId}`,
  };
}

export function sameCalendarDestination(
  left: Pick<
    CalendarSyncDestination,
    "accountSubject" | "accountEmail" | "calendarId"
  >,
  right: Pick<
    CalendarSyncDestination,
    "accountSubject" | "accountEmail" | "calendarId"
  >,
) {
  return (
    (left.accountSubject ?? null) === (right.accountSubject ?? null) &&
    (left.accountEmail ?? null)?.toLowerCase() ===
      (right.accountEmail ?? null)?.toLowerCase() &&
    left.calendarId === right.calendarId
  );
}

/**
 * A destination is usable only when a Google account identity and a calendar
 * were both recorded. Rows that predate account identity capture normalize to
 * `unknown-account` and must be reconnected before Calendar writes are safe.
 */
export function isVerifiedCalendarDestination(
  destination: Pick<
    CalendarSyncDestination,
    "accountSubject" | "accountEmail" | "calendarId"
  >,
) {
  const accountEmail = destination.accountEmail?.trim().toLowerCase() ?? "";
  const accountSubject = destination.accountSubject?.trim() ?? "";
  const calendarId = destination.calendarId?.trim() ?? "";

  return Boolean(
    (accountEmail || accountSubject) &&
      accountEmail !== "unknown-account" &&
      accountSubject !== "unknown-account" &&
      calendarId,
  );
}

/** Compare stable Google subjects when either destination has one. */
export function sameVerifiedCalendarDestination(
  left: Pick<
    CalendarSyncDestination,
    "accountSubject" | "accountEmail" | "calendarId"
  >,
  right: Pick<
    CalendarSyncDestination,
    "accountSubject" | "accountEmail" | "calendarId"
  >,
) {
  if (
    !isVerifiedCalendarDestination(left) ||
    !isVerifiedCalendarDestination(right) ||
    left.calendarId?.trim() !== right.calendarId?.trim()
  ) {
    return false;
  }

  const leftEmail = left.accountEmail?.trim().toLowerCase() ?? "";
  const rightEmail = right.accountEmail?.trim().toLowerCase() ?? "";
  const leftSubject = left.accountSubject?.trim() ?? "";
  const rightSubject = right.accountSubject?.trim() ?? "";

  if (leftSubject || rightSubject) {
    return Boolean(leftSubject && leftSubject === rightSubject);
  }
  return Boolean(leftEmail && leftEmail === rightEmail);
}

/**
 * Stable Google event id. Google accepts lowercase base32hex (0-9, a-v); a
 * lower-case SHA-256 hex digest is a valid subset. Deriving the id from the
 * destination, task and generation lets an ambiguous insert or a failed
 * mapping save retry the same id instead of creating a duplicate.
 */
export function deterministicCalendarEventId(input: {
  ownerUserId: string;
  taskId: string;
  destinationKey: string;
  generation: number;
}) {
  const digest = sha256Hex(
    [
      EVENT_ID_VERSION,
      input.ownerUserId,
      input.taskId,
      input.destinationKey,
      String(input.generation),
    ].join("|"),
  );
  return `ega${digest.slice(0, 48)}`;
}

export function buildCalendarEventPayload(input: {
  ownerUserId: string;
  task: CalendarTaskScanRecord;
  destination: CalendarSyncDestination;
  generation: number;
  eventId: string;
  linkBaseUrl: string;
  timeZone?: string;
}) {
  const task = input.task;
  const plan = planCalendarTaskEvent(task);
  if (plan.kind === "excluded") {
    return { plan, payload: null, payloadHash: null } as const;
  }

  const reminderMinutes = normalizeCalendarReminderMinutes(
    task.calendarReminderMinutes,
  );
  const safeReminderMinutes =
    reminderMinutes > MAX_CALENDAR_REMINDER_MINUTES
      ? DEFAULT_CALENDAR_REMINDER_MINUTES
      : reminderMinutes;
  const baseUrl = input.linkBaseUrl.replace(/\/+$/, "");
  const link = `${baseUrl}/tasks?task=${encodeURIComponent(input.task.id)}`;
  const privateProperties: Record<string, string> = {
    source: "ega-house",
    task_id: input.task.id,
    owner_user_id: input.ownerUserId,
    destination_key: input.destination.destinationKey,
    generation: String(input.generation),
  };

  const draft = {
    eventId: input.eventId,
    summary: input.task.title,
    description: `Open in EGA House: ${link}`,
    start: "dateTime" in plan.start && input.timeZone
      ? { ...plan.start, timeZone: input.timeZone }
      : plan.start,
    end: "dateTime" in plan.end && input.timeZone
      ? { ...plan.end, timeZone: input.timeZone }
      : plan.end,
    reminderMinutes: safeReminderMinutes,
    privateProperties,
  };

  const payloadHash = sha256Hex(
    JSON.stringify({
      version: PAYLOAD_HASH_VERSION,
      summary: draft.summary,
      description: draft.description,
      start: draft.start,
      end: draft.end,
      reminderMinutes: draft.reminderMinutes,
      destinationKey: input.destination.destinationKey,
    }),
  );

  privateProperties.payload_hash = payloadHash;

  return {
    plan,
    payload: {
      ...draft,
      privateProperties,
    } satisfies CalendarEventPayload,
    payloadHash,
  } as const;
}

export function exclusionLabelKey(
  reason: CalendarSyncExclusionReason,
): CalendarSyncExclusionReason {
  return reason;
}

/**
 * Bounded exponential backoff with stable jitter. Google `Retry-After` wins
 * when supplied. The cap keeps a manual run from waiting indefinitely.
 */
export function nextCalendarRetryAtIso(input: {
  jobId: string;
  attempts: number;
  now: Date;
  retryAfterSeconds?: number;
}) {
  const minDelayMs = 5_000;
  const maxDelayMs = 15 * 60_000;
  const exponential = Math.min(
    maxDelayMs,
    minDelayMs * 2 ** Math.max(0, input.attempts - 1),
  );
  const jitterSeed = Number.parseInt(
    sha256Hex(`${input.jobId}:${input.attempts}`).slice(0, 8),
    16,
  );
  const jitter = jitterSeed % Math.max(1, Math.floor(exponential / 4));
  const baseDelayMs = Math.min(
    maxDelayMs,
    Math.max(
      minDelayMs,
      input.retryAfterSeconds !== undefined
        ? input.retryAfterSeconds * 1000
        : exponential + jitter,
    ),
  );

  return new Date(input.now.getTime() + baseDelayMs).toISOString();
}

export function isTerminalOutcome(
  outcome: "pending" | "created" | "updated" | "removed" | "unchanged" | "excluded" | "failed",
) {
  return outcome !== "pending";
}

export function resolveTaskCalendarSnapshot(
  task: CalendarTaskScanRecord,
): CalendarTaskCalendarSnapshot {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    archivedAt: task.archivedAt,
    completedAt: task.completedAt,
    calendarSyncEnabled: task.calendarSyncEnabled,
    calendarReminderMinutes: task.calendarReminderMinutes,
    scheduledStartAt: task.scheduledStartAt,
    scheduledEndAt: task.scheduledEndAt,
    plannedForDate: task.plannedForDate,
    dueDate: task.dueDate,
  };
}
