/**
 * Server-only concrete adapter stub for Inbox AI classification (EGA-508).
 * Provider-neutral foundation implemented. Concrete suggestion experience blocked on HITL provider/model decision.
 *
 * This stub implements the provider-neutral port but does NOT wire a concrete
 * LLM provider. External AI wiring remains HITL-blocked until provider/model/
 * credential choice is explicitly approved.
 *
 * Invariants:
 * - Secrets never appear in this file, logs, or generation evidence.
 * - `classify` never directly creates/updates/archives canonical entities.
 * - Every call returns durable generation metadata (prompt/schema versions,
 *   token/cost fields, latency) with `status: blocked | no_suggestion`.
 * - Bounded input and allow-list validation are enforced in the application
 *   layer; this stub merely demonstrates server-only composition without
 *   leaking to client bundles.
 */

import { INBOX_AI_PROMPT_VERSION, INBOX_AI_SCHEMA_VERSION } from "@ega/domain/inbox-ai";
import type {
  InboxAiClassificationInput,
  InboxAiClassifyResult,
  InboxAiClassificationPort,
} from "@ega/application/inbox/ai-classification-port";
import { createSafeNoSuggestionGeneration } from "@ega/application/inbox/ai-classification-port";

export type BlockedInboxAiAdapterConfig = Readonly<{
  provider: string;
  model: string;
  promptVersion?: string;
  schemaVersion?: string;
  timeoutMs?: number;
  maxInputChars?: number;
}>;

function assertNoSecrets(config: Record<string, unknown>) {
  const secretKeys = ["apikey", "api_key", "secret", "token", "credential", "password"];
  for (const key of Object.keys(config)) {
    const lower = key.toLowerCase();
    if (secretKeys.some((p) => lower.includes(p))) {
      throw new Error(`Inbox AI adapter config must not contain secret key: ${key}`);
    }
    const value = config[key];
    if (typeof value === "string" && /(sk-|api[_-]?key|secret|credential)/i.test(value) && value.length > 20) {
      throw new Error(`Inbox AI adapter config value for ${key} appears to contain a secret`);
    }
  }
}

export class BlockedInboxAiAdapter implements InboxAiClassificationPort {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly timeoutMs: number;
  readonly maxInputChars: number;

  constructor(config: BlockedInboxAiAdapterConfig) {
    assertNoSecrets(config as Record<string, unknown>);
    const provider = String(config.provider ?? "blocked").trim() || "blocked";
    const model = String(config.model ?? "none").trim() || "none";
    if (!provider) throw new Error("provider is required");
    if (!model) throw new Error("model is required");
    this.provider = provider;
    this.model = model;
    this.promptVersion = String(config.promptVersion ?? INBOX_AI_PROMPT_VERSION).trim() || INBOX_AI_PROMPT_VERSION;
    this.schemaVersion = String(config.schemaVersion ?? INBOX_AI_SCHEMA_VERSION).trim() || INBOX_AI_SCHEMA_VERSION;
    this.timeoutMs = typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : 8000;
    this.maxInputChars = typeof config.maxInputChars === "number" && config.maxInputChars > 0 ? config.maxInputChars : 4000;
  }

  async classify(_input: InboxAiClassificationInput): Promise<InboxAiClassifyResult> {
    void _input;
    // HITL blocked: no external provider call. Return safe no-suggestion with
    // durable evidence so callers can show manual fallback does not depend on AI.
    // The input is treated as untrusted data and is NOT executed; we only
    // record its hash (built by the application layer) without echoing raw text.
    const start = Date.now();
    const generation = createSafeNoSuggestionGeneration({
      provider: this.provider,
      model: this.model,
      promptVersion: this.promptVersion,
      schemaVersion: this.schemaVersion,
      status: "blocked",
      failureReason: "Concrete AI provider wiring is HITL-blocked — manual Inbox processing remains available.",
      latencyMs: Date.now() - start,
    });
    // Note: tokenUsage and estimatedCostUsd remain null (no provider call).
    return generation;
  }
}

/**
 * Factory used by server composition — keeps credential handling server-side.
 * The caller must supply provider/model from validated config (e.g., env without secrets
 * in client). Secrets, if ever configured, must use server-only env (not NEXT_PUBLIC_*)
 * and must never be forwarded to `BlockedInboxAiAdapter` or logs.
 */
export function createBlockedInboxAiAdapter(config: BlockedInboxAiAdapterConfig): BlockedInboxAiAdapter {
  return new BlockedInboxAiAdapter(config);
}
