/**
 * Canonical provider-neutral structured suggestion port — reusable by both
 * Smart Inbox and Daily Operator. Every AI proposal flows through this shape
 * so we have one hardened integration stack, not two.
 *
 * Design invariants (EGA-508):
 * - provider/model are configurable strings; secrets never enter this layer
 * - input is treated as untrusted data (capture text is content, not policy)
 * - output is strict schema-validated + allow-list + owner-side entity checked
 * - generation evidence is durable metadata; raw capture text is NOT duplicated
 * - timeout / rate / cost guards are explicit, fallback is safe no-suggestion
 */

// Generic generation evidence — inbox and operator share these fields.
// Inbox-specific alias lives in inbox/ai-classification-port.ts for ergonomics.
export type StructuredSuggestionGenerationStatus =
  | "succeeded"
  | "no_suggestion"
  | "failed"
  | "timeout"
  | "rate_limited"
  | "invalid_output"
  | "blocked";

export type TokenUsage = Readonly<{
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}>;

export type StructuredSuggestionGeneration<TSuggestion> = Readonly<{
  id: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: StructuredSuggestionGenerationStatus;
  createdAt: string; // ISO
  tokenUsage: TokenUsage | null;
  estimatedCostUsd: number | null;
  result: TSuggestion | null;
  failureReason: string | null;
  latencyMs: number | null;
}>;

export interface StructuredSuggestionPort<TInput, TSuggestion> {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  /**
   * Classify `input` into a strictly-typed suggestion.
   * Implementations must not expose provider secrets and must treat input
   * as untrusted data (prompt-injection-like text is content, not instructions).
   */
  classify(input: TInput): Promise<StructuredSuggestionGeneration<TSuggestion>>;
}

// Rate guard — per-user, per-minute, explicit failure to safe fallback.
export interface AiRateLimiter {
  check(actorUserId: string, nowMs: number): { allowed: boolean; remaining: number };
  record(actorUserId: string, nowMs: number): void;
}

export function createInMemoryAiRateLimiter(limitPerMinute: number): AiRateLimiter {
  const windows = new Map<string, number[]>();
  return {
    check(actorUserId: string, nowMs: number) {
      const cutoff = nowMs - 60_000;
      const arr = (windows.get(actorUserId) ?? []).filter((t) => t > cutoff);
      // don't mutate yet, just check
      return { allowed: arr.length < limitPerMinute, remaining: Math.max(0, limitPerMinute - arr.length) };
    },
    record(actorUserId: string, nowMs: number) {
      const cutoff = nowMs - 60_000;
      const arr = (windows.get(actorUserId) ?? []).filter((t) => t > cutoff);
      arr.push(nowMs);
      windows.set(actorUserId, arr);
    },
  };
}

// Bounded input helper shared across consumers.
export function boundInputText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}
