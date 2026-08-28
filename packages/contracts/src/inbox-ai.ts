import { z } from "zod";

import type { InboxPriority, InboxType } from "@ega/domain";
import { INBOX_TYPES } from "@ega/domain";

// ---------------------------------------------------------------------------
// Constants — keep in sync with @ega/domain inbox-ai where possible.
// Contracts owns the wire shape, domain owns the runtime checks, but the
// literal value sets must stay identical. Tests lock this.
// ---------------------------------------------------------------------------

export const INBOX_AI_SUGGESTED_ACTIONS = ["create_task", "keep", "archive"] as const;
export type InboxAiSuggestedAction = (typeof INBOX_AI_SUGGESTED_ACTIONS)[number];

export const INBOX_AI_GENERATION_STATUSES = [
  "succeeded",
  "no_suggestion",
  "failed",
  "timeout",
  "rate_limited",
  "invalid_output",
  "blocked",
] as const;
export type InboxAiGenerationStatus = (typeof INBOX_AI_GENERATION_STATUSES)[number];

export const INBOX_AI_PROMPT_VERSION = "inbox-ai-prompt-v1" as const;
export const INBOX_AI_SCHEMA_VERSION = "inbox-ai-schema-v1" as const;

// Token/cost telemetry — optional but typed.
export type InboxAiTokenUsage = Readonly<{
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}>;

// ---------------------------------------------------------------------------
// Strict structured suggestion schema (model output contract)
// ---------------------------------------------------------------------------

export type InboxAiSuggestion = Readonly<{
  suggestedKind: InboxType | null;
  suggestedAction: InboxAiSuggestedAction | null;
  titleRewrite: string | null;
  suggestedProjectId: string | null;
  suggestedGoalId: string | null;
  priorityHint: InboxPriority | null;
  dueDateHint: string | null; // YYYY-MM-DD
  remindAtHint: string | null; // ISO datetime
  confidence: number | null; // 0..1
  rationale: string | null;
}>;

// Zod schema enforces strict wire validation. Every field is nullable but
// when present must be within the allow-list. Unknown keys are stripped.
// This is the "strict structured data" gate before allow-list + owner checks.
export const inboxAiSuggestionSchema = z
  .object({
    suggestedKind: z
      .enum([...INBOX_TYPES] as [string, ...string[]])
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? null : v)),
    suggestedAction: z
      .enum([...INBOX_AI_SUGGESTED_ACTIONS] as [string, ...string[]])
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? null : v)),
    titleRewrite: z.string().nullable().optional().transform((v) => (v === undefined ? null : v)),
    suggestedProjectId: z.string().nullable().optional().transform((v) => (v === undefined ? null : v)),
    suggestedGoalId: z.string().nullable().optional().transform((v) => (v === undefined ? null : v)),
    priorityHint: z
      .enum(["low", "medium", "high", "urgent"] as [string, ...string[]])
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? null : v)),
    dueDateHint: z.string().nullable().optional().transform((v) => (v === undefined ? null : v)),
    remindAtHint: z.string().nullable().optional().transform((v) => (v === undefined ? null : v)),
    confidence: z.number().nullable().optional().transform((v) => (v === undefined ? null : v)),
    rationale: z.string().nullable().optional().transform((v) => (v === undefined ? null : v)),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Title rewrite when present must be non-empty after trim and bounded.
    if (data.titleRewrite !== null && data.titleRewrite !== undefined) {
      const trimmed = String(data.titleRewrite).trim();
      if (!trimmed) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "titleRewrite must not be empty", path: ["titleRewrite"] });
      } else if (trimmed.length > 120) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "titleRewrite too long", path: ["titleRewrite"] });
      }
    }
    if (data.confidence !== null && data.confidence !== undefined) {
      if (typeof data.confidence !== "number" || Number.isNaN(data.confidence) || data.confidence < 0 || data.confidence > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "confidence must be between 0 and 1", path: ["confidence"] });
      }
    }
    if (data.dueDateHint !== null && data.dueDateHint !== undefined && data.dueDateHint.trim() !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.dueDateHint).trim())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "dueDateHint must be YYYY-MM-DD", path: ["dueDateHint"] });
      }
    }
    if (data.remindAtHint !== null && data.remindAtHint !== undefined && data.remindAtHint.trim() !== "") {
      const d = new Date(String(data.remindAtHint).trim());
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "remindAtHint must be ISO datetime", path: ["remindAtHint"] });
      }
    }
    if (data.rationale !== null && data.rationale !== undefined) {
      const trimmed = String(data.rationale).trim();
      if (trimmed.length > 500) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "rationale too long", path: ["rationale"] });
      }
    }
  });

// ---------------------------------------------------------------------------
// Generation evidence record — durable metadata for every proposal attempt.
// Mirrors the AC: id, provider/model, prompt/schema version, status,
// created timestamp, token usage, cost, result/failure.
// Must never contain provider secrets or duplicated private capture text.
// ---------------------------------------------------------------------------

export type InboxAiGenerationRecord = Readonly<{
  id: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: InboxAiGenerationStatus;
  createdAt: string; // ISO
  tokenUsage: InboxAiTokenUsage | null;
  estimatedCostUsd: number | null;
  // On success, the strict suggestion (already validated) or null for safe fallback.
  // On failure, structured failure classification.
  result: InboxAiSuggestion | null;
  failureReason: string | null;
  // Optional latency telemetry (ms)
  latencyMs: number | null;
}>;

export const inboxAiGenerationRecordSchema = z.object({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  promptVersion: z.string().trim().min(1),
  schemaVersion: z.string().trim().min(1),
  status: z.enum([...INBOX_AI_GENERATION_STATUSES] as [string, ...string[]]),
  createdAt: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), "createdAt must be ISO"),
  tokenUsage: z
    .object({
      promptTokens: z.number().nullable(),
      completionTokens: z.number().nullable(),
      totalTokens: z.number().nullable(),
    })
    .nullable(),
  estimatedCostUsd: z.number().nullable(),
  result: z.any().nullable(),
  failureReason: z.string().nullable(),
  latencyMs: z.number().nullable(),
});

// ---------------------------------------------------------------------------
// Wire DTOs for transport (api-client <-> server). Provider/model are
// transport-level config, never part of client request payload beyond choice?
// Request is minimal: inboxItemId + bounded candidates already owned client.
// Response echoes suggestion + generation evidence.
// ---------------------------------------------------------------------------

export type InboxAiSuggestResponse = Readonly<{
  ok: true;
  suggestion: InboxAiSuggestion | null;
  generation: InboxAiGenerationRecord;
}>;

export type InboxAiConfigDto = Readonly<{
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  timeoutMs: number;
  maxInputChars: number;
}>;

// Helper: ensure config never carries secrets.
export function assertInboxAiConfigHasNoSecrets(config: Record<string, unknown>): void {
  const secretKeys = ["apiKey", "api_key", "secret", "token", "credential", "password"];
  for (const key of Object.keys(config)) {
    if (secretKeys.some((s) => key.toLowerCase().includes(s))) {
      throw new Error(`Inbox AI config must not contain secret key: ${key}`);
    }
    const value = config[key];
    if (typeof value === "string" && /(sk-|api[_-]?key|secret)/i.test(value) && value.length > 20) {
      throw new Error(`Inbox AI config value appears to contain a secret: ${key}`);
    }
  }
}
