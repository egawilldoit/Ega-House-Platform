import { TASK_PRIORITY_VALUES, isTaskPriority, type TaskPriority } from "@/lib/task-domain";

export const IDEA_NOTE_TYPES = ["idea", "feature", "bug", "improvement", "research"] as const;
export const DEFAULT_IDEA_NOTE_TYPE = "idea";
export const IDEA_NOTE_PRIORITIES = TASK_PRIORITY_VALUES;
export const IDEA_NOTE_STATUSES = ["inbox", "reviewing", "planned", "archived", "converted"] as const;
export const MANUAL_IDEA_NOTE_STATUSES = ["inbox", "reviewing", "planned", "archived"] as const;
export const RESERVED_IDEA_NOTE_STATUSES = ["converted"] as const;
export const MAX_IDEA_NOTE_TAGS = 10;
export const MAX_IDEA_NOTE_TAG_LENGTH = 32;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAG_PATTERN = /^[a-z0-9](?:[a-z0-9 _-]*[a-z0-9])?$/;

export type IdeaNoteType = (typeof IDEA_NOTE_TYPES)[number];
export type IdeaNotePriority = TaskPriority;
export type IdeaNoteStatus = (typeof IDEA_NOTE_STATUSES)[number];
export type ManualIdeaNoteStatus = (typeof MANUAL_IDEA_NOTE_STATUSES)[number];

export function isIdeaNoteType(value: string): value is IdeaNoteType {
  return IDEA_NOTE_TYPES.includes(value as IdeaNoteType);
}

export function validateIdeaNoteType(value: unknown): IdeaNoteType | null {
  const normalized = String(value ?? DEFAULT_IDEA_NOTE_TYPE).trim().toLowerCase();
  return isIdeaNoteType(normalized) ? normalized : null;
}

export function isManualIdeaNoteStatus(value: string): value is ManualIdeaNoteStatus {
  return MANUAL_IDEA_NOTE_STATUSES.includes(value as ManualIdeaNoteStatus);
}

export function validateManualIdeaNoteStatus(value: unknown):
  | { status: ManualIdeaNoteStatus; errorMessage: null }
  | { status: null; errorMessage: string } {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (RESERVED_IDEA_NOTE_STATUSES.includes(normalized as (typeof RESERVED_IDEA_NOTE_STATUSES)[number])) {
    return {
      status: null,
      errorMessage: "Converted is reserved for future conversion workflows.",
    };
  }

  if (!isManualIdeaNoteStatus(normalized)) {
    return {
      status: null,
      errorMessage: `Status must be one of: ${MANUAL_IDEA_NOTE_STATUSES.join(", ")}.`,
    };
  }

  return { status: normalized, errorMessage: null };
}

export function normalizeIdeaNotePriority(value: unknown): IdeaNotePriority | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return isTaskPriority(normalized) ? normalized : null;
}

export function normalizeOptionalProjectId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return UUID_PATTERN.test(normalized) ? normalized : "";
}

export function parseIdeaNoteTags(input: unknown): string[] {
  if (Array.isArray(input)) {
    return normalizeTagParts(input.map((tag) => String(tag)));
  }

  return normalizeTagParts(String(input ?? "").split(","));
}

function normalizeTagParts(parts: string[]) {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, " ");
    if (!tag) continue;

    if (tag.length > MAX_IDEA_NOTE_TAG_LENGTH) {
      throw new Error(`Tags must be ${MAX_IDEA_NOTE_TAG_LENGTH} characters or fewer.`);
    }

    if (!TAG_PATTERN.test(tag)) {
      throw new Error("Tags can only use letters, numbers, spaces, hyphens, and underscores.");
    }

    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  if (tags.length > MAX_IDEA_NOTE_TAGS) {
    throw new Error(`Use ${MAX_IDEA_NOTE_TAGS} tags or fewer.`);
  }

  return tags;
}
