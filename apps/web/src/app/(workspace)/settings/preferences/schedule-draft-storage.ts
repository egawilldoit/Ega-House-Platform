import { DAYS, type Schedule } from "./schedule-model";

/**
 * Session-scoped draft preservation for the personal schedule.
 *
 * Browser Back/Forward in the App Router cannot be truthfully cancelled with
 * `popstate` or `next/router`. Instead of trapping history, a dirty draft is
 * snapshotted into `sessionStorage`; if the route unmounts and is restored
 * later, the form restores it and says so. The key includes the loaded baseline
 * fingerprint, so a draft from a different stored schedule is never applied.
 */

export const SCHEDULE_DRAFT_PREFIX = "ega:settings:preferences:draft";
export const SCHEDULE_DRAFT_VERSION = 1;
/** A session draft older than this is stale even if the tab survived. */
export const SCHEDULE_DRAFT_MAX_AGE_MS = 12 * 60 * 60_000;

export type SessionStorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type StoredDraft = {
  version: number;
  savedAt: number;
  schedule: Schedule;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value))
  );
}

/**
 * Structural check only. Drafts are allowed to be invalid for saving (empty
 * targets use -1, end-before-start and overlaps are editable states); the
 * server validator remains the authority when the draft is submitted.
 */
export function isRestorableSchedule(value: unknown): value is Schedule {
  if (!isRecord(value)) return false;
  if (typeof value.paused !== "boolean" || !isRecord(value.targets)) return false;
  if (!Array.isArray(value.guidance) || value.guidance.length > 20) return false;

  for (const day of DAYS) {
    const target = value.targets[day];
    if (!isRecord(target)) return false;
    for (const field of ["work", "jobSearch"] as const) {
      const minutes = target[field];
      if (typeof minutes !== "number" || !Number.isInteger(minutes)) {
        return false;
      }
    }
  }

  return value.guidance.every((block) => {
    if (!isRecord(block)) return false;
    return (
      typeof block.name === "string" &&
      block.name.trim().length > 0 &&
      block.name.length <= 80 &&
      typeof block.enabled === "boolean" &&
      isTime(block.start) &&
      isTime(block.end) &&
      Array.isArray(block.days) &&
      block.days.every(
        (day) => typeof day === "string" && DAYS.includes(day as (typeof DAYS)[number]),
      ) &&
      new Set(block.days).size === block.days.length
    );
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = stableValue((value as Record<string, unknown>)[key]);
        return sorted;
      }, {});
  }
  return value;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}

export function scheduleFingerprint(schedule: Schedule): string {
  return hash(JSON.stringify(stableValue(schedule)));
}

export function createScheduleDraftKey(
  pathname: string,
  baseline: Schedule,
  accountScope: string | null = null,
): string {
  const accountPart = accountScope ? hash(accountScope) : "anonymous";
  return `${SCHEDULE_DRAFT_PREFIX}:${pathname}:${accountPart}:${scheduleFingerprint(baseline)}`;
}

export function writeScheduleDraft(
  storage: SessionStorageLike | null,
  key: string,
  schedule: Schedule,
  now: number = Date.now(),
): void {
  if (!storage) return;
  const stored: StoredDraft = {
    version: SCHEDULE_DRAFT_VERSION,
    savedAt: now,
    schedule,
  };
  try {
    storage.setItem(key, JSON.stringify(stored));
  } catch {
    // A full or blocked session store must never break editing.
  }
}

export function readScheduleDraft(
  storage: SessionStorageLike | null,
  key: string,
  now: number = Date.now(),
): Schedule | null {
  if (!storage) return null;

  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== SCHEDULE_DRAFT_VERSION ||
      typeof parsed.savedAt !== "number" ||
      !Number.isFinite(parsed.savedAt) ||
      now - parsed.savedAt > SCHEDULE_DRAFT_MAX_AGE_MS ||
      !isRestorableSchedule(parsed.schedule)
    ) {
      clearScheduleDraft(storage, key);
      return null;
    }
    return parsed.schedule;
  } catch {
    clearScheduleDraft(storage, key);
    return null;
  }
}

export function clearScheduleDraft(
  storage: SessionStorageLike | null,
  key: string,
): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignore an unavailable storage implementation.
  }
}

export function getSessionStorage(): SessionStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
