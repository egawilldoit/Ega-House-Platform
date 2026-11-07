import {
  isNotificationEntityTargetType,
  isNotificationTargetType,
  isNotificationType,
  type NotificationDeliveryStatus,
  type NotificationTargetType,
  type NotificationType,
} from "@ega/contracts";
import { isValidIANATimeZone } from "@ega/domain";

/**
 * One authoritative policy table for every canonical notification type.
 *
 * - `category` groups the event for settings/read-model purposes.
 * - `critical` events bypass quiet hours because delaying them would defeat
 *   their purpose (a direct mention).
 * - `privacyClass` decides whether caller-provided copy may be persisted.
 *   Finance events are always reduced to generic copy so lock screens cannot
 *   leak amounts, merchants, or account details.
 * - `quietHours` records the explicit behavior: `bypass` or `suppress`.
 */
export type NotificationCategory =
  | "task"
  | "timer"
  | "routine"
  | "money"
  | "review"
  | "job_search";

export type NotificationPrivacyClass = "standard" | "private_finance";
export type NotificationQuietHoursBehavior = "bypass" | "suppress";

export type NotificationTypePolicy = Readonly<{
  category: NotificationCategory;
  critical: boolean;
  privacyClass: NotificationPrivacyClass;
  quietHours: NotificationQuietHoursBehavior;
}>;

const POLICY_TABLE: Readonly<Record<NotificationType, NotificationTypePolicy>> = Object.freeze({
  task_reminder: {
    category: "task",
    critical: false,
    privacyClass: "standard",
    quietHours: "suppress",
  },
  task_comment_mention: {
    category: "task",
    critical: true,
    privacyClass: "standard",
    quietHours: "bypass",
  },
  timer_state_change: {
    category: "timer",
    critical: false,
    privacyClass: "standard",
    quietHours: "suppress",
  },
  routine_reminder: {
    category: "routine",
    critical: false,
    privacyClass: "standard",
    quietHours: "suppress",
  },
  money_threshold: {
    category: "money",
    critical: false,
    privacyClass: "private_finance",
    quietHours: "suppress",
  },
  daily_review: {
    category: "review",
    critical: false,
    privacyClass: "standard",
    quietHours: "suppress",
  },
  weekly_review: {
    category: "review",
    critical: false,
    privacyClass: "standard",
    quietHours: "suppress",
  },
  job_search_reminder: {
    category: "job_search",
    critical: false,
    privacyClass: "standard",
    quietHours: "suppress",
  },
});

export function getNotificationTypePolicy(type: NotificationType): NotificationTypePolicy {
  return POLICY_TABLE[type];
}

export function isNotificationTypeCritical(type: NotificationType): boolean {
  return POLICY_TABLE[type].critical;
}

/**
 * Terminal delivery states are recorded results. They are never re-queued by
 * `listPending` and must not be treated as user read/delivered proof.
 */
export function isTerminalDeliveryStatus(status: NotificationDeliveryStatus): boolean {
  return (
    status === "provider_accepted" ||
    status === "invalid_endpoint" ||
    status === "failed" ||
    status === "suppressed"
  );
}

const CLOCK_TIME_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

export type ClockTime = Readonly<{ hour: number; minute: number }>;

/** Parses strict 24-hour `HH:MM`. Returns null for anything else. */
export function parseClockTime(value: string | null | undefined): ClockTime | null {
  if (typeof value !== "string") return null;
  const match = CLOCK_TIME_RE.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function isValidClockTime(value: string | null | undefined): boolean {
  return parseClockTime(value) !== null;
}

function minutesSinceMidnight(time: ClockTime): number {
  return time.hour * 60 + time.minute;
}

function localMinutesOfDay(now: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const rawHour = parts.find((part) => part.type === "hour")?.value;
    const rawMinute = parts.find((part) => part.type === "minute")?.value;
    if (rawHour === undefined || rawMinute === undefined) return null;
    let hour = Number(rawHour);
    const minute = Number(rawMinute);
    if (hour === 24) hour = 0;
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

/**
 * True when `now` falls inside the owner's local quiet-hours window.
 *
 * Safe default: an invalid/missing timezone or malformed `HH:MM` returns
 * `false` (do not suppress). The server's own local time is never used as a
 * guess. Same-day and overnight windows (start > end) are supported, and the
 * wall-clock is derived through `Intl` so DST transitions are handled.
 */
export function isWithinQuietHours(input: {
  now: Date;
  timezone: string | null | undefined;
  start: string | null | undefined;
  end: string | null | undefined;
}): boolean {
  const timezone = typeof input.timezone === "string" ? input.timezone.trim() : "";
  if (!timezone || !isValidIANATimeZone(timezone)) return false;
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) return false;

  const start = parseClockTime(input.start);
  const end = parseClockTime(input.end);
  if (!start || !end) return false;

  const startMinutes = minutesSinceMidnight(start);
  const endMinutes = minutesSinceMidnight(end);
  if (startMinutes === endMinutes) return false;

  const nowMinutes = localMinutesOfDay(input.now, timezone);
  if (nowMinutes === null) return false;

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Overnight window, e.g. 22:00–07:00.
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

export const MAX_NOTIFICATION_TITLE_LENGTH = 200;
export const MAX_NOTIFICATION_BODY_LENGTH = 500;

const GENERIC_FINANCE_TITLE = "Finance update";
const GENERIC_FINANCE_BODY = "Open EGA House to review your finance update.";

function trimAndCap(value: string, max: number): string {
  return value.trim().slice(0, max);
}

/**
 * Applies the copy policy before persistence.
 *
 * Finance (`private_finance`) events intentionally discard caller copy and use
 * a fixed generic title/body. Standard events are trimmed and length-capped.
 */
export function sanitizeNotificationCopy(
  type: NotificationType,
  title: string | null | undefined,
  body: string | null | undefined,
): { title: string; body: string | null } {
  const policy = getNotificationTypePolicy(type);
  if (policy.privacyClass === "private_finance") {
    return { title: GENERIC_FINANCE_TITLE, body: GENERIC_FINANCE_BODY };
  }
  const safeTitle = trimAndCap(typeof title === "string" ? title : "", MAX_NOTIFICATION_TITLE_LENGTH);
  const safeBody =
    typeof body === "string" && body.trim()
      ? trimAndCap(body, MAX_NOTIFICATION_BODY_LENGTH)
      : null;
  return { title: safeTitle, body: safeBody };
}

export type NormalizedNotificationTarget = Readonly<{
  type: NotificationTargetType;
  id: string | null;
}>;

/**
 * Entity targets persist into `notifications.target_id uuid`. Non-UUID ids
 * must degrade to "no target" rather than reaching Postgres and failing with
 * 22P02. `review`/`today` are singleton targets and keep `id: null`.
 */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/**
 * Normalizes a semantic target. Unknown types, blank/non-UUID entity ids, and
 * raw router/path-like ids are rejected (null) so a token from an untrusted
 * producer can never become a navigation target or a failing uuid insert.
 * Singleton types keep a null id instead of inventing a fake one.
 */
export function normalizeNotificationTarget(
  type: string | null | undefined,
  id: string | null | undefined,
): NormalizedNotificationTarget | null {
  if (typeof type !== "string") return null;
  const trimmedType = type.trim();
  if (!isNotificationTargetType(trimmedType)) return null;

  if (isNotificationEntityTargetType(trimmedType)) {
    if (typeof id !== "string" || !isUuid(id)) return null;
    return { type: trimmedType, id: id.trim() };
  }

  // Singleton targets: ignore any supplied id.
  return { type: trimmedType, id: null };
}

const EVENT_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const EVENT_KEY_RE = /^[A-Za-z0-9._:-]{3,300}$/;

export function isValidNotificationEventKey(value: string | null | undefined): boolean {
  return typeof value === "string" && EVENT_KEY_RE.test(value.trim());
}

/**
 * Normalizes a provided event key against the canonical `${type}:${eventId}`
 * identity. Outer whitespace is trimmed, but the key must already use the
 * event type's canonical prefix and a valid event id. A key for a different
 * type is rejected so one event id cannot be replayed under another taxonomy
 * value.
 */
export function normalizeNotificationEventKey(
  type: string,
  key: string | null | undefined,
): string | null {
  if (!isNotificationType(type)) return null;
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  // Legacy reminder events used this persisted key before typed event names.
  if (type === "task_reminder" && /^task-reminder:[A-Za-z0-9._:-]{1,200}$/.test(trimmed)) return trimmed;
  const prefix = `${type}:`;
  if (!trimmed.startsWith(prefix)) return null;
  return buildNotificationEventKey(type, trimmed.slice(prefix.length));
}

/**
 * Builds the stable per-owner event identity `${type}:${eventId}`. This is the
 * canonical notification identity; delivery attempts keep their own identity.
 * Returns null for an unknown type or malformed/oversized event id.
 */
export function buildNotificationEventKey(
  type: string,
  eventId: string | null | undefined,
): string | null {
  if (!isNotificationType(type)) return null;
  if (typeof eventId !== "string") return null;
  const trimmed = eventId.trim();
  if (!EVENT_ID_RE.test(trimmed)) return null;
  const key = `${type}:${trimmed}`;
  return isValidNotificationEventKey(key) ? key : null;
}
