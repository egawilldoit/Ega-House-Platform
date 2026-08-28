import type { InboxPriority, InboxType } from "@ega/domain";
import { INBOX_TYPES } from "@ega/domain";

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

export type InboxAiTokenUsage = Readonly<{
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}>;

export type InboxAiSuggestion = Readonly<{
  suggestedKind: InboxType | null;
  suggestedAction: InboxAiSuggestedAction | null;
  titleRewrite: string | null;
  suggestedProjectId: string | null;
  suggestedGoalId: string | null;
  priorityHint: InboxPriority | null;
  dueDateHint: string | null;
  remindAtHint: string | null;
  confidence: number | null;
  rationale: string | null;
}>;

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; error: { issues: Array<{ message: string; path: string[] }> } };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function fail(message: string, path: string[] = []): ParseFailure {
  return { success: false, error: { issues: [{ message, path }] } };
}

export const inboxAiSuggestionSchema = {
  safeParse(input: unknown): ParseResult<InboxAiSuggestion> {
    const obj = (input ?? {}) as Record<string, unknown>;
    // Strict: reject unknown keys except allowed set. For simplicity, we check if any key not in allowed -> fail
    const allowed = new Set([
      "suggestedKind",
      "suggestedAction",
      "titleRewrite",
      "suggestedProjectId",
      "suggestedGoalId",
      "priorityHint",
      "dueDateHint",
      "remindAtHint",
      "confidence",
      "rationale",
    ]);
    for (const key of Object.keys(obj)) {
      if (!allowed.has(key)) {
        // In original zod .strict(), unknown keys would be rejected. But tests use valid keys only, and one test checks bad action via allow-list, not unknown keys.
        // To keep compatibility, we treat unknown keys as not failing strict but just ignoring? However strict should fail for unknown keys.
        // We will fail for unknown keys to stay strict, but allow extra keys to be ignored? Let's fail.
        return fail(`Unknown key: ${key}`, [key]);
      }
    }

    const suggestedKind = obj.suggestedKind === undefined ? null : (obj.suggestedKind as string | null);
    const suggestedAction = obj.suggestedAction === undefined ? null : (obj.suggestedAction as string | null);
    const titleRewrite = obj.titleRewrite === undefined ? null : (obj.titleRewrite as string | null);
    const suggestedProjectId = obj.suggestedProjectId === undefined ? null : (obj.suggestedProjectId as string | null);
    const suggestedGoalId = obj.suggestedGoalId === undefined ? null : (obj.suggestedGoalId as string | null);
    const priorityHint = obj.priorityHint === undefined ? null : (obj.priorityHint as string | null);
    const dueDateHint = obj.dueDateHint === undefined ? null : (obj.dueDateHint as string | null);
    const remindAtHint = obj.remindAtHint === undefined ? null : (obj.remindAtHint as string | null);
    const confidence = obj.confidence === undefined ? null : (obj.confidence as number | null);
    const rationale = obj.rationale === undefined ? null : (obj.rationale as string | null);

    // Allow-list checks
    if (suggestedKind !== null && !(INBOX_TYPES as readonly string[]).includes(suggestedKind)) {
      return fail(`suggestedKind must be one of ${INBOX_TYPES.join(", ")}`, ["suggestedKind"]);
    }
    if (suggestedAction !== null && !(INBOX_AI_SUGGESTED_ACTIONS as readonly string[]).includes(suggestedAction)) {
      return fail("Invalid suggestedAction", ["suggestedAction"]);
    }
    if (priorityHint !== null && !["low", "medium", "high", "urgent"].includes(priorityHint)) {
      return fail("Invalid priorityHint", ["priorityHint"]);
    }
    // Title rewrite validations
    if (titleRewrite !== null) {
      const trimmed = String(titleRewrite).trim();
      if (!trimmed) return fail("titleRewrite must not be empty", ["titleRewrite"]);
      if (trimmed.length > 120) return fail("titleRewrite too long", ["titleRewrite"]);
    }
    if (confidence !== null) {
      if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
        return fail("confidence must be between 0 and 1", ["confidence"]);
      }
    }
    if (dueDateHint !== null && String(dueDateHint).trim() !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDateHint).trim())) {
        return fail("dueDateHint must be YYYY-MM-DD", ["dueDateHint"]);
      }
    }
    if (remindAtHint !== null && String(remindAtHint).trim() !== "") {
      const d = new Date(String(remindAtHint).trim());
      if (Number.isNaN(d.getTime())) return fail("remindAtHint must be ISO datetime", ["remindAtHint"]);
    }
    if (rationale !== null) {
      const trimmed = String(rationale).trim();
      if (trimmed.length > 500) return fail("rationale too long", ["rationale"]);
    }

    const data = {
      suggestedKind: suggestedKind as InboxType | null,
      suggestedAction: suggestedAction as InboxAiSuggestedAction | null,
      titleRewrite,
      suggestedProjectId,
      suggestedGoalId,
      priorityHint: priorityHint as InboxPriority | null,
      dueDateHint,
      remindAtHint,
      confidence,
      rationale,
    } as InboxAiSuggestion;
    return { success: true, data };
  },
};

export type InboxAiGenerationRecord = Readonly<{
  id: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: InboxAiGenerationStatus;
  createdAt: string;
  tokenUsage: InboxAiTokenUsage | null;
  estimatedCostUsd: number | null;
  result: InboxAiSuggestion | null;
  failureReason: string | null;
  latencyMs: number | null;
}>;

export const inboxAiGenerationRecordSchema = {
  safeParse(input: unknown): ParseResult<InboxAiGenerationRecord> {
    const obj = (input ?? {}) as Record<string, unknown>;
    const id = String(obj.id ?? "").trim();
    if (!id) return fail("id is required", ["id"]);
    const provider = String(obj.provider ?? "").trim();
    if (!provider) return fail("provider is required", ["provider"]);
    const model = String(obj.model ?? "").trim();
    if (!model) return fail("model is required", ["model"]);
    const promptVersion = String(obj.promptVersion ?? "").trim();
    if (!promptVersion) return fail("promptVersion is required", ["promptVersion"]);
    const schemaVersion = String(obj.schemaVersion ?? "").trim();
    if (!schemaVersion) return fail("schemaVersion is required", ["schemaVersion"]);
    const status = String(obj.status ?? "").trim();
    if (!(INBOX_AI_GENERATION_STATUSES as readonly string[]).includes(status)) {
      return fail("Invalid status", ["status"]);
    }
    const createdAt = String(obj.createdAt ?? "").trim();
    if (!createdAt || Number.isNaN(new Date(createdAt).getTime())) {
      return fail("createdAt must be ISO", ["createdAt"]);
    }
    const tokenUsage = (obj.tokenUsage ?? null) as InboxAiTokenUsage | null;
    if (tokenUsage !== null) {
      if (typeof tokenUsage !== "object" || tokenUsage === null) return fail("Invalid tokenUsage", ["tokenUsage"]);
    }
    const estimatedCostUsd = obj.estimatedCostUsd ?? null;
    if (estimatedCostUsd !== null && typeof estimatedCostUsd !== "number") {
      return fail("Invalid estimatedCostUsd", ["estimatedCostUsd"]);
    }
    const result = (obj.result ?? null) as InboxAiSuggestion | null;
    const failureReason = (obj.failureReason ?? null) as string | null;
    const latencyMs = (obj.latencyMs ?? null) as number | null;
    if (latencyMs !== null && typeof latencyMs !== "number") {
      return fail("Invalid latencyMs", ["latencyMs"]);
    }

    const data: InboxAiGenerationRecord = {
      id,
      provider,
      model,
      promptVersion,
      schemaVersion,
      status: status as InboxAiGenerationStatus,
      createdAt,
      tokenUsage,
      estimatedCostUsd,
      result,
      failureReason,
      latencyMs,
    };
    return { success: true, data };
  },
};

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
