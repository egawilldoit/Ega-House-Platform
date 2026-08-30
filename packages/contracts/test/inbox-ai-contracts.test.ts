import assert from "node:assert/strict";
import test from "node:test";

import {
  inboxAiSuggestionSchema,
  inboxAiGenerationRecordSchema,
  assertInboxAiConfigHasNoSecrets,
  INBOX_AI_PROMPT_VERSION,
  INBOX_AI_SCHEMA_VERSION,
  INBOX_AI_SUGGESTED_ACTIONS,
  INBOX_AI_GENERATION_STATUSES,
} from "../src/inbox-ai";
import { INBOX_TYPES } from "@ega/domain";

test("inbox ai contracts preserve prompt/schema version and action allow-list", () => {
  assert.equal(INBOX_AI_PROMPT_VERSION, "inbox-ai-prompt-v1");
  assert.equal(INBOX_AI_SCHEMA_VERSION, "inbox-ai-schema-v1");
  assert.deepEqual([...INBOX_AI_SUGGESTED_ACTIONS], ["create_task", "keep", "archive"]);
  assert.ok(INBOX_AI_GENERATION_STATUSES.includes("succeeded"));
  assert.ok(INBOX_AI_GENERATION_STATUSES.includes("no_suggestion"));
  assert.ok(INBOX_AI_GENERATION_STATUSES.includes("timeout"));
  assert.ok(INBOX_AI_GENERATION_STATUSES.includes("blocked"));
});

test("inboxAiSuggestionSchema strictly validates allow-list fields", () => {
  const valid = {
    suggestedKind: "idea",
    suggestedAction: "create_task",
    titleRewrite: "New title",
    suggestedProjectId: "11111111-1111-4111-8111-111111111111",
    suggestedGoalId: null,
    priorityHint: "high",
    dueDateHint: "2026-09-01",
    remindAtHint: "2026-09-01T09:00:00.000Z",
    confidence: 0.9,
    rationale: "clear",
  };
  assert.equal(inboxAiSuggestionSchema.safeParse(valid).success, true);

  // Extra key with strict() would still pass due to strip? Test that unknown action fails
  const bad = { ...valid, suggestedAction: "hack" };
  assert.equal(inboxAiSuggestionSchema.safeParse(bad).success, false);
});

test("inboxAiGenerationRecordSchema requires prompt/schema versions and status", () => {
  const valid = {
    id: "gen-123",
    provider: "test",
    model: "test-model",
    promptVersion: INBOX_AI_PROMPT_VERSION,
    schemaVersion: INBOX_AI_SCHEMA_VERSION,
    status: "succeeded",
    createdAt: "2026-08-27T12:00:00.000Z",
    tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    estimatedCostUsd: 0.001,
    result: null,
    failureReason: null,
    latencyMs: 123,
  };
  assert.equal(inboxAiGenerationRecordSchema.safeParse(valid).success, true);

  const missing = { ...valid, promptVersion: "" };
  assert.equal(inboxAiGenerationRecordSchema.safeParse(missing).success, false);
});

test("assertInboxAiConfigHasNoSecrets rejects secret keys", () => {
  assert.throws(() => assertInboxAiConfigHasNoSecrets({ apiKey: "sk-abc12345678901234567890" } as any), /secret/);
  // Normal config passes
  assert.doesNotThrow(() => assertInboxAiConfigHasNoSecrets({ provider: "openai", model: "gpt-4o-mini", promptVersion: "v1" }));
});

test("inbox ai suggestion allow-list aligns with domain inbox types", () => {
  for (const kind of INBOX_TYPES) {
    const s = {
      suggestedKind: kind,
      suggestedAction: "keep",
      titleRewrite: null,
      suggestedProjectId: null,
      suggestedGoalId: null,
      priorityHint: null,
      dueDateHint: null,
      remindAtHint: null,
      confidence: null,
      rationale: null,
    };
    assert.equal(inboxAiSuggestionSchema.safeParse(s).success, true, `kind ${kind} should be valid`);
  }
  const invalidKind = {
    suggestedKind: "not-a-kind",
    suggestedAction: "keep",
    titleRewrite: null,
    suggestedProjectId: null,
    suggestedGoalId: null,
    priorityHint: null,
    dueDateHint: null,
    remindAtHint: null,
    confidence: null,
    rationale: null,
  };
  assert.equal(inboxAiSuggestionSchema.safeParse(invalidKind).success, false);
});
