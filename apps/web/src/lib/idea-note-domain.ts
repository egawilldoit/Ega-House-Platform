import {
  DEFAULT_INBOX_TYPE,
  INBOX_PRIORITIES,
  INBOX_STATUSES,
  INBOX_TYPES,
  MANUAL_INBOX_STATUSES,
  MAX_INBOX_TAGS,
  MAX_INBOX_TAG_LENGTH,
  RESERVED_INBOX_STATUSES,
  isInboxType,
  isManualInboxStatus,
  normalizeInboxPriority,
  normalizeOptionalProjectId as normalizeDomainProjectId,
  parseInboxTags,
  validateInboxType,
  validateManualInboxStatus,
} from "@ega/domain";

// Compatibility aliases: preserve existing web import surface while delegating to canonical domain.
export const IDEA_NOTE_TYPES = INBOX_TYPES;
export const DEFAULT_IDEA_NOTE_TYPE = DEFAULT_INBOX_TYPE;
export const IDEA_NOTE_PRIORITIES = INBOX_PRIORITIES;
export const IDEA_NOTE_STATUSES = INBOX_STATUSES;
export const MANUAL_IDEA_NOTE_STATUSES = MANUAL_INBOX_STATUSES;
export const RESERVED_IDEA_NOTE_STATUSES = RESERVED_INBOX_STATUSES;
export const MAX_IDEA_NOTE_TAGS = MAX_INBOX_TAGS;
export const MAX_IDEA_NOTE_TAG_LENGTH = MAX_INBOX_TAG_LENGTH;

export type IdeaNoteType = (typeof IDEA_NOTE_TYPES)[number];
export type IdeaNoteStatus = (typeof IDEA_NOTE_STATUSES)[number];
export type ManualIdeaNoteStatus = (typeof MANUAL_IDEA_NOTE_STATUSES)[number];
export type IdeaNotePriority = (typeof IDEA_NOTE_PRIORITIES)[number];

export const isIdeaNoteType = isInboxType;
export const validateIdeaNoteType = validateInboxType;
export const isManualIdeaNoteStatus = isManualInboxStatus;
export const validateManualIdeaNoteStatus = validateManualInboxStatus;
export const normalizeIdeaNotePriority = normalizeInboxPriority;
export const normalizeOptionalProjectId = normalizeDomainProjectId;
export const parseIdeaNoteTags = parseInboxTags;
