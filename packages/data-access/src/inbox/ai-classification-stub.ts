/**
 * Data-access stub for provider-neutral Inbox AI classification (EGA-508).
 *
 * This is a server-only integration layer stub. It implements the same
 * provider-neutral port as the server adapter but lives in data-access so
 * composition can import it without depending on `apps/server`.
 *
 * Invariants identical to `apps/server/src/adapters/inbox-ai-stub.ts`:
 * - No concrete provider wiring (HITL blocked)
 * - No secrets in config, generation, or logs
 * - Bounded input is enforced in application; this stub just returns safe fallback
 */

import { INBOX_AI_PROMPT_VERSION, INBOX_AI_SCHEMA_VERSION } from "@ega/domain/inbox-ai";
import type {
  InboxAiClassificationInput,
  InboxAiClassifyResult,
  InboxAiClassificationPort,
} from "@ega/application/inbox/ai-classification-port";
import { createSafeNoSuggestionGeneration } from "@ega/application/inbox/ai-classification-port";

export type StubConfig = Readonly<{
  provider: string;
  model: string;
  promptVersion?: string;
  schemaVersion?: string;
  timeoutMs?: number;
}>;

function assertNoSecrets(config: Record<string, unknown>) {
  const keys = ["apikey", "api_key", "secret", "token", "credential", "password"];
  for (const k of Object.keys(config)) {
    if (keys.some((p) => k.toLowerCase().includes(p))) throw new Error(`config must not contain secret: ${k}`);
    const v = config[k];
    if (typeof v === "string" && /(sk-|api[_-]?key|secret)/i.test(v) && v.length > 20) {
      throw new Error(`config value for ${k} looks like a secret`);
    }
  }
}

export class InboxAiStubAdapter implements InboxAiClassificationPort {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly timeoutMs: number;
  readonly maxInputChars: number;

  constructor(config: StubConfig) {
    assertNoSecrets(config as Record<string, unknown>);
    this.provider = String(config.provider ?? "stub").trim() || "stub";
    this.model = String(config.model ?? "none").trim() || "none";
    this.promptVersion = String(config.promptVersion ?? INBOX_AI_PROMPT_VERSION).trim() || INBOX_AI_PROMPT_VERSION;
    this.schemaVersion = String(config.schemaVersion ?? INBOX_AI_SCHEMA_VERSION).trim() || INBOX_AI_SCHEMA_VERSION;
    this.timeoutMs = typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : 8000;
    this.maxInputChars = 4000;
  }

  async classify(_input: InboxAiClassificationInput): Promise<InboxAiClassifyResult> {
    const start = Date.now();
    const gen = createSafeNoSuggestionGeneration({
      provider: this.provider,
      model: this.model,
      promptVersion: this.promptVersion,
      schemaVersion: this.schemaVersion,
      status: "blocked",
      failureReason: "Stub adapter — concrete provider HITL-blocked. Manual processing remains available.",
      latencyMs: Date.now() - start,
    });
    return gen;
  }
}
