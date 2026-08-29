import {
  DEFAULT_INBOX_TYPE,
  isInboxType,
  isManualInboxStatus,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  normalizeInboxPriority,
  normalizeOptionalProjectId,
  parseInboxTags,
  validateInboxType,
  validateManualInboxStatus,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { sha256Hex } from "../shared/hash";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type {
  CreateInboxRecordInput,
  InboxIdempotencyEntry,
  InboxQuery,
  InboxRecord,
  InboxRepository,
  UpdateInboxRecordInput,
} from "./ports";

function normalizeTitle(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeBody(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

async function ensureProjectVisible(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) return null;
  const scope = await repository.getScope(actor);
  if (!scope.ok) return "Unable to validate idea scope right now.";
  if (!scope.value.projectIds.includes(projectId)) {
    return "Selected project is unavailable.";
  }
  return null;
}

export function deterministicInboxIdForCapture(actor: AuthenticatedActor, key: string): string {
  const input = `${actor.userId}:${String(key).trim()}:inbox`;
  const hash = sha256Hex(input);
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function computeInboxFingerprint(input: {
  title: string;
  body: string | null;
  projectId: string | null;
  tags: string[];
  type: string;
}): string {
  const payload = {
    title: String(input.title ?? "").trim(),
    body: input.body != null ? String(input.body).trim() || null : null,
    projectId: input.projectId ?? null,
    tags: [...(input.tags ?? [])].sort(),
    kind: String(input.type ?? DEFAULT_INBOX_TYPE).trim(),
  };
  return sha256Hex(JSON.stringify(payload));
}

function fingerprintFromRecord(record: InboxRecord): string {
  return computeInboxFingerprint({
    title: record.title,
    body: record.body,
    projectId: record.projectId,
    tags: record.tags,
    type: record.type,
  });
}

export async function createInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  input: {
    title: unknown;
    body?: unknown;
    type?: unknown;
    projectId?: unknown;
    priority?: unknown;
    tags?: unknown;
    tagsInput?: unknown;
    idempotencyKey?: unknown;
  },
): Promise<ApplicationResult<InboxRecord>> {
  const title = normalizeTitle(input.title);
  if (!title) return applicationFailure("Title is required.");

  const body = normalizeBody(input.body);
  const type = validateInboxType(input.type);
  if (type === null) return applicationFailure("Choose a valid idea type.");

  const rawProjectId = String(input.projectId ?? "").trim();
  const projectId = normalizeOptionalProjectId(rawProjectId);
  if (projectId === "") return applicationFailure("Project is invalid.");

  const priority = normalizeInboxPriority(input.priority);
  if (String(input.priority ?? "").trim() && priority === null) {
    return applicationFailure("Choose a valid priority.");
  }

  let tags: string[];
  try {
    tags = parseInboxTags(input.tags ?? input.tagsInput ?? "");
  } catch (error) {
    return applicationFailure(error instanceof Error ? error.message : "Tags are invalid.");
  }

  const scopeError = await ensureProjectVisible(actor, repository, projectId);
  if (scopeError) return applicationFailure(scopeError);

  const rawKey = input.idempotencyKey != null ? String(input.idempotencyKey).trim() : "";
  let idempotencyKey: string | null = null;
  let fingerprint: string | null = null;
  let deterministicId: string | null = null;
  if (rawKey) {
    if (rawKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) return applicationFailure("Idempotency key is too long.", "validation");
    if (/[\0-\x1f\x7f]/.test(rawKey)) return applicationFailure("Idempotency key is invalid.", "validation");
    idempotencyKey = rawKey;
    const resolvedType = type ?? DEFAULT_INBOX_TYPE;
    fingerprint = computeInboxFingerprint({ title, body, projectId, tags, type: resolvedType });
    deterministicId = deterministicInboxIdForCapture(actor, idempotencyKey);
    // Check existing mapping with fingerprint comparison (first-write-wins with payload check)
    // Includes atomic race hardening: deterministic ID + fingerprint via note content as durable reservation.
    if (repository.getInboxIdempotencyEntry) {
      const entry = await repository.getInboxIdempotencyEntry(actor, idempotencyKey);
      if (!entry.ok) return applicationFailure("Unable to create idea right now.", "unknown");
      if (entry.value) {
        const stored = entry.value as InboxIdempotencyEntry;
        if (stored.fingerprint && stored.fingerprint !== fingerprint) {
          return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
        }
        if (!stored.fingerprint && fingerprint) {
          // Legacy row without fingerprint: treat as replay for backwards compat (no conflict)
        }
        const existing = await repository.getInboxItemByIdempotencyKey(actor, idempotencyKey);
        if (!existing.ok) return applicationFailure("Unable to create idea right now.", "unknown");
        if (existing.value) {
          // When mapping exists, also verify fingerprint via note content as defense-in-depth
          const existingFp = fingerprintFromRecord(existing.value);
          if (existingFp !== fingerprint) {
            return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
          }
          return applicationSuccess(existing.value);
        }
        // Mapping exists but note missing (orphan edge): fallback to fetch by deterministic id
        const byId = await repository.getInboxItem(actor, stored.inboxItemId);
        if (byId.ok && byId.value) {
          const existingFp = fingerprintFromRecord(byId.value);
          if (existingFp !== fingerprint) {
            return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
          }
          return applicationSuccess(byId.value);
        }
      } else {
        // No mapping yet — check deterministic note reservation (handles race where A created note before mapping)
        if (deterministicId) {
          const byDeterministic = await repository.getInboxItem(actor, deterministicId);
          if (byDeterministic.ok && byDeterministic.value) {
            const existingFp = fingerprintFromRecord(byDeterministic.value);
            if (existingFp !== fingerprint) {
              return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
            }
            return applicationSuccess(byDeterministic.value);
          }
          if (!byDeterministic.ok) return applicationFailure("Unable to create idea right now.", "unknown");
        }
      }
    } else {
      const existing = await repository.getInboxItemByIdempotencyKey(actor, idempotencyKey);
      if (!existing.ok) return applicationFailure("Unable to create idea right now.", "unknown");
      if (existing.value) {
        // Without fingerprint support, legacy replay; will be enhanced after repo upgrade
        const existingFp = fingerprintFromRecord(existing.value);
        if (existingFp !== fingerprint) {
          return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
        }
        return applicationSuccess(existing.value);
      }
      if (deterministicId) {
        const byDeterministic = await repository.getInboxItem(actor, deterministicId);
        if (byDeterministic.ok && byDeterministic.value) {
          const existingFp = fingerprintFromRecord(byDeterministic.value);
          if (existingFp !== fingerprint) {
            return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
          }
          return applicationSuccess(byDeterministic.value);
        }
        if (!byDeterministic.ok) return applicationFailure("Unable to create idea right now.", "unknown");
      }
    }
  }

  const resolvedType = type ?? DEFAULT_INBOX_TYPE;
  if (!fingerprint && idempotencyKey) {
    fingerprint = computeInboxFingerprint({ title, body, projectId, tags, type: resolvedType });
  }
  if (!deterministicId && idempotencyKey) {
    deterministicId = deterministicInboxIdForCapture(actor, idempotencyKey);
  }

  const record: CreateInboxRecordInput = {
    title,
    body,
    type: resolvedType,
    projectId,
    priority,
    tags,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(deterministicId ? { id: deterministicId } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  };

  const result = await repository.createInboxItem(actor, record);
  if (result.ok) return applicationSuccess(result.value);
  // Handle race: duplicate PK or mapping inserted concurrently
  // Uses atomic deterministic PK reservation + fingerprint via note content as durable check.
  if (idempotencyKey) {
    const errorCode = (result as unknown as { error?: { code?: string } }).error?.code ?? "";
    const isConflict = errorCode === "conflict";
    // Always try to resolve to canonical existing on conflict or any error with key
    const entry = repository.getInboxIdempotencyEntry
      ? await repository.getInboxIdempotencyEntry(actor, idempotencyKey)
      : null;
    if (entry && entry.ok && entry.value) {
      const stored = entry.value as InboxIdempotencyEntry;
      if (stored.fingerprint && stored.fingerprint !== fingerprint) {
        return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
      }
    } else if (entry && !entry.ok) {
      return applicationFailure("Unable to create idea right now.", "unknown");
    }
    // Prefer mapping-based replay but also verify fingerprint via note content
    const retry = await repository.getInboxItemByIdempotencyKey(actor, idempotencyKey);
    if (retry.ok && retry.value) {
      const existingFp = fingerprintFromRecord(retry.value);
      if (existingFp !== fingerprint) {
        return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
      }
      if (entry && entry.ok && entry.value && entry.value.fingerprint && entry.value.fingerprint !== fingerprint) {
        return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
      }
      return applicationSuccess(retry.value);
    }
    if (retry && !retry.ok) return applicationFailure("Unable to create idea right now.", "unknown");
    // If we have deterministic id, try direct fetch by id (handles PK race where mapping not yet visible)
    // This is the critical atomic fallback: PK uniqueness on deterministicId is the durable reservation.
    if (deterministicId) {
      const byId = await repository.getInboxItem(actor, deterministicId);
      if (byId.ok && byId.value) {
        const existingFp = fingerprintFromRecord(byId.value);
        if (existingFp !== fingerprint) {
          return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
        }
        if (entry && entry.ok && entry.value && entry.value.fingerprint && entry.value.fingerprint !== fingerprint) {
          return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
        }
        return applicationSuccess(byId.value);
      }
      if (byId && !byId.ok) return applicationFailure("Unable to create idea right now.", "unknown");
    }
    if (isConflict) {
      return applicationFailure("Idempotency key conflict: payload differs from original request.", "conflict");
    }
  }
  const mappedCode = (result as unknown as { error?: { code?: string } }).error?.code === "conflict" ? "conflict" : "unknown";
  return applicationFailure("Unable to create idea right now.", mappedCode as never);
}

export async function updateInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  input: {
    id: unknown;
    title: unknown;
    body?: unknown;
    type?: unknown;
    projectId?: unknown;
    priority?: unknown;
    tags?: unknown;
    tagsInput?: unknown;
    status: unknown;
  },
): Promise<ApplicationResult<InboxRecord>> {
  const id = String(input.id ?? "").trim();
  if (!id) return applicationFailure("Idea is required.");

  const title = normalizeTitle(input.title);
  if (!title) return applicationFailure("Title is required.");

  const body = normalizeBody(input.body);
  const type = validateInboxType(input.type);
  if (type === null) return applicationFailure("Choose a valid idea type.");

  const rawProjectId = String(input.projectId ?? "").trim();
  const projectId = normalizeOptionalProjectId(rawProjectId);
  if (projectId === "") return applicationFailure("Project is invalid.");

  const priority = normalizeInboxPriority(input.priority);
  if (String(input.priority ?? "").trim() && priority === null) {
    return applicationFailure("Choose a valid priority.");
  }

  let tags: string[];
  try {
    tags = parseInboxTags(input.tags ?? input.tagsInput ?? "");
  } catch (error) {
    return applicationFailure(error instanceof Error ? error.message : "Tags are invalid.");
  }

  const statusResult = validateManualInboxStatus(input.status);
  if (statusResult.status === null) {
    return applicationFailure(statusResult.errorMessage);
  }

  const scopeError = await ensureProjectVisible(actor, repository, projectId);
  if (scopeError) return applicationFailure(scopeError);

  const record: UpdateInboxRecordInput = {
    id,
    title,
    body,
    type: type ?? DEFAULT_INBOX_TYPE,
    projectId,
    priority,
    tags,
    status: statusResult.status,
  };

  const result = await repository.updateInboxItem(actor, record);
  if (!result.ok) return applicationFailure("Unable to update idea right now.");
  if (!result.value) return applicationFailure("Idea is unavailable.");
  return applicationSuccess(result.value);
}

export async function archiveInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  input: { id: unknown },
): Promise<ApplicationResult<InboxRecord>> {
  const id = String(input.id ?? "").trim();
  if (!id) return applicationFailure("Idea is required.");
  const result = await repository.setInboxItemStatus(actor, { id, status: "archived" });
  if (!result.ok) return applicationFailure("Unable to archive idea right now.");
  if (!result.value) return applicationFailure("Idea is unavailable.");
  return applicationSuccess(result.value);
}

export async function restoreInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  input: { id: unknown },
): Promise<ApplicationResult<InboxRecord>> {
  const id = String(input.id ?? "").trim();
  if (!id) return applicationFailure("Idea is required.");
  const result = await repository.setInboxItemStatus(actor, { id, status: "inbox" });
  if (!result.ok) return applicationFailure("Unable to restore idea right now.");
  if (!result.value) return applicationFailure("Idea is unavailable.");
  return applicationSuccess(result.value);
}

export async function getInboxItem(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  idInput: unknown,
): Promise<ApplicationResult<InboxRecord | null>> {
  const id = String(idInput ?? "").trim();
  if (!id) return applicationFailure("Idea is required.");
  const result = await repository.getInboxItem(actor, id);
  if (!result.ok) return applicationFailure("Unable to load idea right now.");
  return applicationSuccess(result.value);
}

export async function listInboxItems(
  actor: AuthenticatedActor,
  repository: InboxRepository,
  query?: InboxQuery,
): Promise<ApplicationResult<InboxRecord[]>> {
  const result = await repository.listInboxItems(actor, query);
  if (!result.ok) return applicationFailure("Unable to load ideas right now.");
  return applicationSuccess(result.value);
}

// Helper for parsing list filters similar to web's normalizeIdeaNoteListFilters
// Used by server and potentially web adapter.

export function normalizeInboxListFilters(filters?: {
  view?: unknown;
  search?: unknown;
  type?: unknown;
  status?: unknown;
  project?: unknown;
  projectId?: unknown;
  priority?: unknown;
  tag?: unknown;
}): {
  view: "active" | "archived" | "all";
  search: string;
  type: string;
  status: string;
  project: string;
  priority: string;
  tag: string;
} {
  const viewRaw = String(filters?.view ?? "active").trim().toLowerCase();
  const view = (["active", "archived", "all"] as readonly string[]).includes(viewRaw) ? (viewRaw as "active" | "archived" | "all") : "active";
  const search = String(filters?.search ?? "").trim();
  const typeRaw = String(filters?.type ?? "all").trim().toLowerCase();
  const type = typeRaw && typeRaw !== "all" && isInboxType(typeRaw) ? typeRaw : "all";
  const statusRaw = String(filters?.status ?? "all").trim().toLowerCase();
  const status = statusRaw && statusRaw !== "all" && isManualInboxStatus(statusRaw) ? statusRaw : "all";
  const projectRaw = String(filters?.project ?? filters?.projectId ?? "all").trim();
  const prj = normalizeOptionalProjectId(projectRaw);
  const project = projectRaw === "none" ? "none" : prj || "all";
  const priRaw = String(filters?.priority ?? "all").trim().toLowerCase();
  let priority: string;
  if (priRaw && priRaw !== "all" && priRaw !== "none") {
    priority = normalizeInboxPriority(priRaw) ?? "all";
  } else if (priRaw === "none") {
    priority = "none";
  } else {
    priority = "all";
  }
  let tag = "";
  try {
    const parsed = parseInboxTags(filters?.tag ?? "");
    tag = parsed[0] ?? "";
  } catch {
    tag = "";
  }
  return { view, search, type, status, project, priority, tag };
}
