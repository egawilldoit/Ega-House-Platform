import type { InboxPriority, InboxType } from "@ega/domain";
import {
  DEFAULT_INBOX_AI_RATE_LIMIT_PER_MINUTE,
  DEFAULT_INBOX_AI_TIMEOUT_MS,
  hashInboxAiInput,
  INBOX_AI_PROMPT_VERSION,
  INBOX_AI_SCHEMA_VERSION,
  isValidDueDateHint,
  isValidInboxAiAction,
  isValidInboxAiKind,
  isValidInboxAiPriority,
  isValidRemindAtHint,
  MAX_INBOX_AI_CANDIDATE_GOALS,
  MAX_INBOX_AI_CANDIDATE_PROJECTS,
  MAX_INBOX_AI_INPUT_CHARS,
  normalizeInboxAiInputText,
} from "@ega/domain/inbox-ai";
import {
  inboxAiSuggestionSchema,
  type InboxAiGenerationRecord,
  type InboxAiSuggestion,
} from "@ega/contracts/inbox-ai";
import { INBOX_AI_PROMPT_VERSION as CONTRACT_PROMPT_VERSION, INBOX_AI_SCHEMA_VERSION as CONTRACT_SCHEMA_VERSION } from "@ega/contracts/inbox-ai";

import type { AuthenticatedActor } from "../auth/actor";
import type {
  StructuredSuggestionGeneration,
  StructuredSuggestionPort,
  AiRateLimiter,
} from "../ai/structured-suggestion-port";

// ---------------------------------------------------------------------------
// Inbox-specific alias of the generic provider-neutral port.
// This is the canonical port both Smart Inbox and Daily Operator reuse.
// ---------------------------------------------------------------------------

export type InboxAiClassificationInput = Readonly<{
  inboxItemId: string;
  title: string;
  body: string | null;
  // Bounded, owner-authorized candidate sets — only these ids may be suggested.
  candidateProjects: ReadonlyArray<Readonly<{ id: string; name: string }>>;
  candidateGoals: ReadonlyArray<Readonly<{ id: string; title: string; projectId: string }>>;
  // Content hash for telemetry without storing raw private text.
  inputHash: string;
}>;

export type InboxAiClassifyResult = StructuredSuggestionGeneration<InboxAiSuggestion>;

export interface InboxAiClassificationPort extends StructuredSuggestionPort<InboxAiClassificationInput, InboxAiSuggestion> {
  // provider/model/promptVersion/schemaVersion are readonly config — no secrets.
}

// ---------------------------------------------------------------------------
// Config validation — ensures provider/model contain no secrets.
// ---------------------------------------------------------------------------

export type InboxAiProviderConfig = Readonly<{
  provider: string;
  model: string;
  promptVersion?: string;
  schemaVersion?: string;
  timeoutMs?: number;
  maxInputChars?: number;
}>;

const SECRET_KEY_PATTERNS = ["apikey", "api_key", "secret", "token", "credential", "password"];

export function assertInboxAiProviderConfigSafe(config: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    const lower = key.toLowerCase();
    if (SECRET_KEY_PATTERNS.some((p) => lower.includes(p))) {
      throw new Error(`Inbox AI config must not contain secret key: ${key}`);
    }
    const value = config[key];
    if (typeof value === "string" && /(sk-|api[_-]?key|secret|credential)/i.test(value) && value.length > 20) {
      throw new Error(`Inbox AI config value for ${key} appears to contain a secret`);
    }
  }
}

export function normalizeInboxAiProviderConfig(config: InboxAiProviderConfig): Required<InboxAiProviderConfig> {
  assertInboxAiProviderConfigSafe(config as Record<string, unknown>);
  const provider = String(config.provider ?? "").trim();
  const model = String(config.model ?? "").trim();
  if (!provider) throw new Error("Inbox AI provider is required");
  if (!model) throw new Error("Inbox AI model is required");
  return {
    provider,
    model,
    promptVersion: String(config.promptVersion ?? INBOX_AI_PROMPT_VERSION).trim() || INBOX_AI_PROMPT_VERSION,
    schemaVersion: String(config.schemaVersion ?? INBOX_AI_SCHEMA_VERSION).trim() || INBOX_AI_SCHEMA_VERSION,
    timeoutMs: typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_INBOX_AI_TIMEOUT_MS,
    maxInputChars: typeof config.maxInputChars === "number" && config.maxInputChars > 0 ? config.maxInputChars : MAX_INBOX_AI_INPUT_CHARS,
  };
}

// ---------------------------------------------------------------------------
// Bounded input builder — enforces limits before calling provider.
// Treats capture as untrusted data: never expands input with privileged context
// beyond the minimal owner-authorized candidates.
// ---------------------------------------------------------------------------

export function buildInboxAiClassificationInput(args: {
  inboxItemId: string;
  title: string;
  body: string | null;
  candidateProjects: Array<{ id: string; name: string }>;
  candidateGoals: Array<{ id: string; title: string; projectId: string }>;
  maxInputChars?: number;
}): InboxAiClassificationInput {
  const id = String(args.inboxItemId ?? "").trim();
  if (!id) throw new Error("inboxItemId is required");

  const maxChars = args.maxInputChars ?? MAX_INBOX_AI_INPUT_CHARS;
  // Bound title+body as data, not instructions.
  const rawCombined = `${String(args.title ?? "").trim()}\n\n${String(args.body ?? "").trim()}`.trim();
  const boundedCombined = normalizeInboxAiInputText(rawCombined, maxChars);
  // We keep title and body separately for the port, but both bounded.
  // If combined was truncated, truncate body first.
  let boundedTitle = String(args.title ?? "").trim();
  let boundedBody = args.body ? String(args.body).trim() : null;
  const combinedLength = `${boundedTitle}\n\n${boundedBody ?? ""}`.trim().length;
  if (combinedLength > maxChars) {
    // Truncate body, then title if still over.
    if (boundedBody) {
      const excess = combinedLength - maxChars;
      boundedBody = boundedBody.slice(0, Math.max(0, boundedBody.length - excess)).trim() || null;
    }
    const afterBody = `${boundedTitle}\n\n${boundedBody ?? ""}`.trim().length;
    if (afterBody > maxChars) {
      boundedTitle = boundedTitle.slice(0, Math.max(0, maxChars - (boundedBody ? boundedBody.length + 2 : 0))).trim();
    }
  }

  const projects = args.candidateProjects.slice(0, MAX_INBOX_AI_CANDIDATE_PROJECTS);
  const goals = args.candidateGoals.slice(0, MAX_INBOX_AI_CANDIDATE_GOALS);

  const inputHash = hashInboxAiInput(boundedCombined);

  return {
    inboxItemId: id,
    title: boundedTitle,
    body: boundedBody,
    candidateProjects: projects,
    candidateGoals: goals,
    inputHash,
  };
}

// ---------------------------------------------------------------------------
// Strict validation of model output — allow-list + owner-side entity checks.
// Invalid/partial output degrades to safe no-suggestion.
// ---------------------------------------------------------------------------

export function validateInboxAiSuggestionAgainstAllowList(
  raw: unknown,
  candidates: { projects: Array<{ id: string }>; goals: Array<{ id: string }> },
): { ok: true; value: InboxAiSuggestion } | { ok: false; reason: string } {
  const parsed = inboxAiSuggestionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `schema validation failed: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  }
  const data = parsed.data as InboxAiSuggestion;

  // Normalize nulls (schema already does)
  const kind = data.suggestedKind;
  if (kind !== null && !isValidInboxAiKind(kind)) {
    return { ok: false, reason: `suggestedKind not in allow-list: ${kind}` };
  }
  if (data.suggestedAction !== null && !isValidInboxAiAction(data.suggestedAction)) {
    return { ok: false, reason: `suggestedAction not in allow-list: ${data.suggestedAction}` };
  }
  if (data.priorityHint !== null && !isValidInboxAiPriority(data.priorityHint)) {
    return { ok: false, reason: `priorityHint not in allow-list: ${data.priorityHint}` };
  }
  if (data.dueDateHint !== null && data.dueDateHint.trim() !== "" && !isValidDueDateHint(String(data.dueDateHint).trim())) {
    return { ok: false, reason: `dueDateHint invalid: ${data.dueDateHint}` };
  }
  if (data.remindAtHint !== null && data.remindAtHint.trim() !== "" && !isValidRemindAtHint(String(data.remindAtHint).trim())) {
    return { ok: false, reason: `remindAtHint invalid: ${data.remindAtHint}` };
  }
  // Confidence already validated by schema (0..1)
  // Owner-side entity allow-list
  if (data.suggestedProjectId !== null && !candidates.projects.some((p) => p.id === data.suggestedProjectId)) {
    return { ok: false, reason: `suggestedProjectId not in candidates: ${data.suggestedProjectId}` };
  }
  if (data.suggestedGoalId !== null && !candidates.goals.some((g) => g.id === data.suggestedGoalId)) {
    return { ok: false, reason: `suggestedGoalId not in candidates: ${data.suggestedGoalId}` };
  }
  // If goal implies project, optionally ensure goal.projectId matches suggestedProjectId?
  // We keep it lenient but validated: if both provided they must be consistent with candidate goals set.
  // (Goal's projectId is validated via goal candidate existence; further cross-check is done in conversion.)

  return { ok: true, value: data };
}

// ---------------------------------------------------------------------------
// Generation evidence helpers — ensure every proposal has durable metadata.
// Prompt/schema versions are canonicalized to the accepted contract values.
// ---------------------------------------------------------------------------

export function createInboxAiGenerationRecord(args: {
  id: string;
  provider: string;
  model: string;
  promptVersion?: string;
  schemaVersion?: string;
  status: InboxAiGenerationRecord["status"];
  createdAt?: string;
  tokenUsage?: InboxAiGenerationRecord["tokenUsage"];
  estimatedCostUsd?: number | null;
  result?: InboxAiSuggestion | null;
  failureReason?: string | null;
  latencyMs?: number | null;
}): InboxAiGenerationRecord {
  return {
    id: String(args.id),
    provider: String(args.provider),
    model: String(args.model),
    promptVersion: String(args.promptVersion ?? CONTRACT_PROMPT_VERSION),
    schemaVersion: String(args.schemaVersion ?? CONTRACT_SCHEMA_VERSION),
    status: args.status,
    createdAt: args.createdAt ?? new Date().toISOString(),
    tokenUsage: args.tokenUsage ?? null,
    estimatedCostUsd: args.estimatedCostUsd ?? null,
    result: args.result ?? null,
    failureReason: args.failureReason ?? null,
    latencyMs: args.latencyMs ?? null,
  };
}

export function createSafeNoSuggestionGeneration(args: {
  provider: string;
  model: string;
  promptVersion?: string;
  schemaVersion?: string;
  status?: InboxAiGenerationRecord["status"];
  failureReason?: string | null;
  latencyMs?: number | null;
  tokenUsage?: InboxAiGenerationRecord["tokenUsage"];
  estimatedCostUsd?: number | null;
  nowIso?: string;
  id?: string;
}): InboxAiGenerationRecord {
  return createInboxAiGenerationRecord({
    id: args.id ?? `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    provider: args.provider,
    model: args.model,
    promptVersion: args.promptVersion,
    schemaVersion: args.schemaVersion,
    status: args.status ?? "no_suggestion",
    createdAt: args.nowIso ?? new Date().toISOString(),
    tokenUsage: args.tokenUsage ?? null,
    estimatedCostUsd: args.estimatedCostUsd ?? null,
    result: null,
    failureReason: args.failureReason ?? null,
    latencyMs: args.latencyMs ?? null,
  });
}

// Ensure generation contains no secrets or duplicated private capture text.
// Telemetry must reference inboxItemId / hash, not raw body.
export function sanitizeGenerationForTelemetry(generation: InboxAiGenerationRecord): InboxAiGenerationRecord {
  // Already safe by construction, but explicitly strip any suspicious keys.
  // Generation result (suggestion) is validated structured data and may contain
  // a titleRewrite derived from capture, but not raw capture duplication.
  // We keep it as is — but ensure no provider secret fields.
  const { id, provider, model, promptVersion, schemaVersion, status, createdAt, tokenUsage, estimatedCostUsd, result, failureReason, latencyMs } =
    generation;
  return { id, provider, model, promptVersion, schemaVersion, status, createdAt, tokenUsage, estimatedCostUsd, result, failureReason, latencyMs };
}

// ---------------------------------------------------------------------------
// Timeout wrapper — explicit resilience: timeout => safe no-suggestion.
// ---------------------------------------------------------------------------

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutErrorMessage = "timeout"): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutErrorMessage)), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result as T;
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    throw error;
  }
}

// Re-export constants for consumers that want a single import
export { INBOX_AI_PROMPT_VERSION, INBOX_AI_SCHEMA_VERSION } from "@ega/domain/inbox-ai";
export { INBOX_AI_PROMPT_VERSION as CONTRACT_INBOX_AI_PROMPT_VERSION } from "@ega/contracts/inbox-ai";
