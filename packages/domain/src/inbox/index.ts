import { TASK_PRIORITY_VALUES, type TaskPriority } from "../tasks/status";

export const INBOX_STATUSES = ["inbox", "reviewing", "planned", "archived", "converted"] as const;
export const MANUAL_INBOX_STATUSES = ["inbox", "reviewing", "planned", "archived"] as const;
export const RESERVED_INBOX_STATUSES = ["converted"] as const;
export const INBOX_TYPES = ["idea", "feature", "bug", "improvement", "research"] as const;
export const DEFAULT_INBOX_TYPE = "idea" as const;
export const INBOX_PRIORITIES = TASK_PRIORITY_VALUES;
export const MAX_INBOX_TAGS = 10;
export const MAX_INBOX_TAG_LENGTH = 32;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAG_PATTERN = /^[a-z0-9](?:[a-z0-9 _-]*[a-z0-9])?$/;

export type InboxStatus = (typeof INBOX_STATUSES)[number];
export type ManualInboxStatus = (typeof MANUAL_INBOX_STATUSES)[number];
export type InboxType = (typeof INBOX_TYPES)[number];
export type InboxPriority = TaskPriority;

export function isInboxStatus(value: string): value is InboxStatus {
  return INBOX_STATUSES.includes(value as InboxStatus);
}

export function isManualInboxStatus(value: string): value is ManualInboxStatus {
  return MANUAL_INBOX_STATUSES.includes(value as ManualInboxStatus);
}

export function isInboxType(value: string): value is InboxType {
  return INBOX_TYPES.includes(value as InboxType);
}

export function validateInboxType(value: unknown): InboxType | null {
  const normalized = String(value ?? DEFAULT_INBOX_TYPE).trim().toLowerCase();
  return isInboxType(normalized) ? normalized : null;
}

export function validateManualInboxStatus(value: unknown):
  | { status: ManualInboxStatus; errorMessage: null }
  | { status: null; errorMessage: string } {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (RESERVED_INBOX_STATUSES.includes(normalized as (typeof RESERVED_INBOX_STATUSES)[number])) {
    return {
      status: null,
      errorMessage: "Converted ideas are reserved for future conversion workflows.",
    };
  }

  if (!isManualInboxStatus(normalized)) {
    return { status: null, errorMessage: "Choose a valid status." };
  }

  return { status: normalized, errorMessage: null };
}

export function normalizeInboxPriority(value: unknown): InboxPriority | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return (TASK_PRIORITY_VALUES as readonly string[]).includes(normalized) ? (normalized as InboxPriority) : null;
}

export function normalizeOptionalProjectId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return UUID_PATTERN.test(normalized) ? normalized : "";
}

export function parseInboxTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return normalizeTagParts(input.map((tag) => String(tag)));
  }
  return normalizeTagParts(String(input ?? "").split(","));
}

function normalizeTagParts(parts: string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > MAX_INBOX_TAG_LENGTH) {
      throw new Error(`Tags must be ${MAX_INBOX_TAG_LENGTH} characters or fewer.`);
    }
    if (!TAG_PATTERN.test(tag)) {
      throw new Error("Tags can only use letters, numbers, spaces, hyphens, and underscores.");
    }
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  if (tags.length > MAX_INBOX_TAGS) {
    throw new Error(`Use ${MAX_INBOX_TAGS} tags or fewer.`);
  }
  return tags;
}

export function isInboxArchivedStatus(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toLowerCase() === "archived";
}

export function isInboxConvertedStatus(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toLowerCase() === "converted";
}

export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export function normalizeIdempotencyKey(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) return "";
  // Allow UUID-like or any non-empty token without control chars; keep simple.
  if (/[\0-\x1f\x7f]/.test(trimmed)) return "";
  return trimmed;
}
