import { INBOX_TYPES, type InboxType } from "../inbox/index";
import { TASK_PRIORITY_VALUES, type TaskPriority } from "../tasks/status";

// ---------------------------------------------------------------------------
// Inbox AI — domain-owned constants, allow-lists, and pure validation.
// Keeps business invariants out of transport/application glue.
// ---------------------------------------------------------------------------

export const INBOX_AI_SUGGESTED_ACTIONS = ["create_task", "keep", "archive"] as const;
export type InboxAiSuggestedAction = (typeof INBOX_AI_SUGGESTED_ACTIONS)[number];

export const INBOX_AI_PROMPT_VERSION = "inbox-ai-prompt-v1" as const;
export const INBOX_AI_SCHEMA_VERSION = "inbox-ai-schema-v1" as const;

// Bounded input / context — prevents oversized capture from reaching provider.
export const MAX_INBOX_AI_INPUT_CHARS = 4000 as const;
export const MAX_INBOX_AI_TITLE_CHARS = 120 as const;
export const MAX_INBOX_AI_RATIONALE_CHARS = 500 as const;
export const MAX_INBOX_AI_CANDIDATE_PROJECTS = 50 as const;
export const MAX_INBOX_AI_CANDIDATE_GOALS = 100 as const;

// Rate / cost guard defaults (per-user, per-minute). Application enforces.
export const DEFAULT_INBOX_AI_TIMEOUT_MS = 8000 as const;
export const DEFAULT_INBOX_AI_RATE_LIMIT_PER_MINUTE = 10 as const;

// Confidence helpers
export function isInboxAiSuggestedAction(value: string): value is InboxAiSuggestedAction {
  return (INBOX_AI_SUGGESTED_ACTIONS as readonly string[]).includes(value);
}

export function isInboxAiConfidence(value: unknown): boolean {
  return typeof value === "number" && !Number.isNaN(value) && value >= 0 && value <= 1;
}

export function normalizeInboxAiTitleRewrite(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_INBOX_AI_TITLE_CHARS) return trimmed.slice(0, MAX_INBOX_AI_TITLE_CHARS).trim();
  return trimmed;
}

export function normalizeInboxAiRationale(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_INBOX_AI_RATIONALE_CHARS) return trimmed.slice(0, MAX_INBOX_AI_RATIONALE_CHARS).trim();
  return trimmed;
}

export function normalizeInboxAiInputText(value: unknown, max: number = MAX_INBOX_AI_INPUT_CHARS): string {
  const raw = String(value ?? "");
  if (raw.length <= max) return raw;
  return raw.slice(0, max);
}

// Allow-list validation for each hint field — shared by application + contracts.
export function isValidInboxAiKind(value: string): value is InboxType {
  return (INBOX_TYPES as readonly string[]).includes(value);
}

export function isValidInboxAiAction(value: string): value is InboxAiSuggestedAction {
  return isInboxAiSuggestedAction(value);
}

export function isValidInboxAiPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITY_VALUES as readonly string[]).includes(value as TaskPriority);
}

export function isValidDueDateHint(value: string): boolean {
  if (!value) return true; // nullable allowed; caller handles null
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isValidRemindAtHint(value: string): boolean {
  if (!value) return true;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

// Owner-side entity validation: candidate allow-list
export function isInboxAiProjectInCandidates(projectId: string | null, candidates: Array<{ id: string }>): boolean {
  if (!projectId) return true; // null is always allowed (no suggestion)
  return candidates.some((c) => c.id === projectId);
}

export function isInboxAiGoalInCandidates(goalId: string | null, candidates: Array<{ id: string }>): boolean {
  if (!goalId) return true;
  return candidates.some((c) => c.id === goalId);
}

// Treat captured text as untrusted data: ensure prompt-injection-like content
// cannot alter allowed actions. This is enforced structurally: we only ever
// place capture into a `content` field that the prompt template treats as data,
// and we validate output against the allow-list. This helper is a lightweight
// check that no instruction-like string leaks into validated output.
export function containsPromptInjectionAttempt(text: string): boolean {
  const lower = text.toLowerCase();
  const markers = [
    "ignore previous",
    "ignore all previous",
    "system:",
    "you are now",
    "disregard",
    "forget your instructions",
    "tool authority",
    "new instructions",
    "[system]",
    "```system",
  ];
  return markers.some((m) => lower.includes(m));
}

// Hash helper for generation evidence without storing raw capture text.
// Use a simple deterministic digest for telemetry reference (not cryptographic secrecy).
// Application should prefer `inboxItemId` reference over content hash when possible.
export function hashInboxAiInput(text: string): string {
  // FNV-1a 32-bit, hex — deterministic, no external deps, cheap for bounded input.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
