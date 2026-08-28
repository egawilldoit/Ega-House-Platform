import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { InboxRepository } from "./ports";
import type { TasksRepository } from "../tasks/ports";
import {
  buildInboxAiClassificationInput,
  createSafeNoSuggestionGeneration,
  sanitizeGenerationForTelemetry,
  validateInboxAiSuggestionAgainstAllowList,
  withTimeout,
  type InboxAiClassificationPort,
  type InboxAiClassifyResult,
} from "./ai-classification-port";
import type { InboxAiGenerationRecord, InboxAiSuggestion } from "@ega/contracts/inbox-ai";
import type { AiRateLimiter } from "../ai/structured-suggestion-port";

export type SuggestInboxClassificationResult = Readonly<{
  suggestion: InboxAiSuggestion | null;
  generation: InboxAiGenerationRecord;
}>;

/**
 * Canonical Smart Inbox AI classification use case.
 *
 * - Owner-scoped: inbox item and candidate projects/goals are resolved via
 *   request-scoped repositories carrying the actor's identity.
 * - Bounded input: capture text + candidate sets are truncated to platform limits.
 * - Provider-neutral: concrete provider is a `InboxAiClassificationPort` injected
 *   from the server-only adapter layer; application owns validation.
 * - HITL: never directly creates/updates/archives entities — returns a proposal
 *   that the UI must render with rationale and require explicit approval.
 * - Safe fallback: invalid/partial/timeout/provider failure degrades to
 *   `suggestion: null` with a `no_suggestion`/`timeout`/`failed` generation,
 *   leaving deterministic manual processing fully usable.
 * - Reusable: this port shape (`InboxAiClassificationPort`) is the single
 *   structured-reasoning stack reused by Daily Operator.
 */
export async function suggestInboxItemClassification(
  actor: AuthenticatedActor,
  inboxRepository: InboxRepository,
  tasksRepository: TasksRepository,
  port: InboxAiClassificationPort | null,
  input: { inboxItemId: unknown },
  options?: {
    now?: Date;
    nowIso?: string;
    timeoutMs?: number;
    rateLimiter?: AiRateLimiter;
  },
): Promise<ApplicationResult<SuggestInboxClassificationResult>> {
  const inboxItemId = String(input.inboxItemId ?? "").trim();
  if (!inboxItemId) return applicationFailure("Idea is required.");

  // If no port is configured (HITL blocked or provider not approved), degrade gracefully.
  // Manual fallback remains fully usable.
  if (!port) {
    const generation = createSafeNoSuggestionGeneration({
      provider: "none",
      model: "none",
      status: "blocked",
      failureReason: "AI classification unavailable — manual processing remains available.",
      nowIso: options?.nowIso ?? options?.now?.toISOString(),
    });
    return applicationSuccess({ suggestion: null, generation: sanitizeGenerationForTelemetry(generation) });
  }

  const timeoutMs = options?.timeoutMs ?? (port as unknown as { timeoutMs?: number }).timeoutMs ?? 8000;
  const now = options?.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = options?.nowIso ?? now.toISOString();

  // Rate guard (per-user)
  if (options?.rateLimiter) {
    const check = options.rateLimiter.check(actor.userId, nowMs);
    if (!check.allowed) {
      const generation = createSafeNoSuggestionGeneration({
        provider: port.provider,
        model: port.model,
        promptVersion: port.promptVersion,
        schemaVersion: port.schemaVersion,
        status: "rate_limited",
        failureReason: "Rate limit exceeded — try again later. Manual processing remains available.",
        nowIso,
      });
      return applicationSuccess({ suggestion: null, generation: sanitizeGenerationForTelemetry(generation) });
    }
    options.rateLimiter.record(actor.userId, nowMs);
  }

  // 1. Load inbox item owner-scoped
  const inboxResult = await inboxRepository.getInboxItem(actor, inboxItemId);
  if (!inboxResult.ok) return applicationFailure("Unable to load idea right now.");
  const inboxItem = inboxResult.value;
  if (!inboxItem) return applicationFailure("Idea is unavailable.");

  // 2. Load owner-scoped candidate sets (used for both bounded context and allow-list)
  const [projectsResult, tasksScopeResult] = await Promise.all([
    inboxRepository.listProjectOptions(actor),
    tasksRepository.getScope(actor),
  ]);
  if (!projectsResult.ok || !tasksScopeResult.ok) {
    // Degrade to safe fallback rather than failing the whole Inbox UI
    const generation = createSafeNoSuggestionGeneration({
      provider: port.provider,
      model: port.model,
      promptVersion: port.promptVersion,
      schemaVersion: port.schemaVersion,
      status: "failed",
      failureReason: "Unable to load classification context — manual processing remains available.",
      nowIso,
    });
    return applicationSuccess({ suggestion: null, generation: sanitizeGenerationForTelemetry(generation) });
  }

  const candidateProjects = projectsResult.value;
  // Build goal candidates from tasks scope
  const candidateGoals = tasksScopeResult.value.goals.map((g) => ({
    id: g.id,
    title: `goal-${g.id}`, // title not in scope record; map id as title hint if needed
    projectId: g.projectId,
  }));

  // For richer goal titles, also fetch via tasksRepository.listGoalOptions if available
  // (best-effort, no failure if missing)
  try {
    const goalOptions = await (tasksRepository as unknown as { listGoalOptions?: (actor: unknown) => Promise<{ ok: boolean; value?: unknown }> }).listGoalOptions?.(actor as unknown as Parameters<typeof tasksRepository.getScope>[0]);
    if (goalOptions?.ok && Array.isArray(goalOptions.value)) {
      // Replace with real titles where available
      const map = new Map<string, string>();
      for (const g of goalOptions.value) map.set(g.id, g.title);
      for (const c of candidateGoals) {
        const title = map.get(c.id);
        if (title) (c as unknown as { title: string }).title = title;
      }
    }
  } catch {
    // ignore enrichment failure
  }

  // 3. Build bounded input (capture is data, not instructions)
  let classificationInput;
  try {
    classificationInput = buildInboxAiClassificationInput({
      inboxItemId,
      title: inboxItem.title,
      body: inboxItem.body,
      candidateProjects,
      candidateGoals,
      maxInputChars: (port as unknown as { maxInputChars?: number }).maxInputChars,
    });
  } catch (error) {
    const generation = createSafeNoSuggestionGeneration({
      provider: port.provider,
      model: port.model,
      promptVersion: port.promptVersion,
      schemaVersion: port.schemaVersion,
      status: "failed",
      failureReason: error instanceof Error ? error.message : "Unable to build classification input.",
      nowIso,
    });
    return applicationSuccess({ suggestion: null, generation: sanitizeGenerationForTelemetry(generation) });
  }

  // 4. Call provider port with timeout guard
  const startMs = Date.now();
  let rawResult: InboxAiClassifyResult;
  try {
    rawResult = await withTimeout(port.classify(classificationInput), timeoutMs, "AI classification timeout");
  } catch (error) {
    const isTimeout = error instanceof Error && /timeout/i.test(error.message);
    const generation = createSafeNoSuggestionGeneration({
      provider: port.provider,
      model: port.model,
      promptVersion: port.promptVersion,
      schemaVersion: port.schemaVersion,
      status: isTimeout ? "timeout" : "failed",
      failureReason: error instanceof Error ? error.message : "Classification failed.",
      latencyMs: Date.now() - startMs,
      nowIso,
    });
    return applicationSuccess({ suggestion: null, generation: sanitizeGenerationForTelemetry(generation) });
  }
  const latencyMs = Date.now() - startMs;

  // 5. Normalize generation: enforce canonical prompt/schema versions and telemetry hygiene
  // Port is expected to return a generation, but we sanitize and ensure no duplicate private text
  const generationFromPort = rawResult as InboxAiGenerationRecord | null;
  let sanitizedGeneration: InboxAiGenerationRecord;
  if (generationFromPort && typeof generationFromPort === "object" && "status" in generationFromPort) {
    sanitizedGeneration = sanitizeGenerationForTelemetry({
      ...generationFromPort,
      provider: port.provider,
      model: port.model,
      promptVersion: port.promptVersion,
      schemaVersion: port.schemaVersion,
      latencyMs: generationFromPort.latencyMs ?? latencyMs,
      createdAt: generationFromPort.createdAt ?? nowIso,
    } as InboxAiGenerationRecord);
  } else {
    // Port returned malformed generation — treat as invalid_output
    const fallback = createSafeNoSuggestionGeneration({
      provider: port.provider,
      model: port.model,
      promptVersion: port.promptVersion,
      schemaVersion: port.schemaVersion,
      status: "invalid_output",
      failureReason: "Provider returned malformed generation.",
      latencyMs,
      nowIso,
    });
    return applicationSuccess({ suggestion: null, generation: sanitizeGenerationForTelemetry(fallback) });
  }

  // 6. Validate suggestion against strict schema + allow-list + owner candidates.
  // If validation fails, degrade to safe no-suggestion with sanitized generation.
  const rawSuggestion = (rawResult as unknown as { result?: unknown } | null)?.result ?? sanitizedGeneration.result ?? null;

  if (rawSuggestion === null || rawSuggestion === undefined) {
    // Port explicitly returned no suggestion — surface as is with success status
    const noSuggestionGen: InboxAiGenerationRecord = {
      ...sanitizedGeneration,
      status: sanitizedGeneration.status === "succeeded" ? "no_suggestion" : sanitizedGeneration.status,
      result: null,
      latencyMs: sanitizedGeneration.latencyMs ?? latencyMs,
    };
    return applicationSuccess({ suggestion: null, generation: noSuggestionGen });
  }

  const validation = validateInboxAiSuggestionAgainstAllowList(rawSuggestion, {
    projects: candidateProjects,
    goals: candidateGoals,
  });

  if (!validation.ok) {
    const failureGen: InboxAiGenerationRecord = {
      ...sanitizedGeneration,
      status: "invalid_output",
      result: null,
      failureReason: validation.reason,
      latencyMs: sanitizedGeneration.latencyMs ?? latencyMs,
    };
    return applicationSuccess({ suggestion: null, generation: sanitizeGenerationForTelemetry(failureGen) });
  }

  // Success: validated suggestion + telemetry (never creates entities)
  const successGen: InboxAiGenerationRecord = {
    ...sanitizedGeneration,
    status: "succeeded",
    result: validation.value,
    failureReason: null,
    latencyMs: sanitizedGeneration.latencyMs ?? latencyMs,
  };

  return applicationSuccess({ suggestion: validation.value, generation: sanitizeGenerationForTelemetry(successGen) });
}
