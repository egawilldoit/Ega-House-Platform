import { createHash } from "node:crypto";

import { getLocalDayWindow } from "@ega/domain";
import { isTaskCanceledStatus, isTaskCompletedStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationErrorCode,
  type ApplicationResult,
  type RepositoryResult,
} from "../shared/result";
import type { OperatorProposalTaskVersion } from "./proposal";
import { getOperatorProposalHashInput, type OperatorProposal } from "./proposal";

// ---------------------------------------------------------------------------
// Types — durable proposal decision evidence (not Task truth)
// ---------------------------------------------------------------------------

export const OPERATOR_PROPOSAL_STATUSES = [
  "generated",
  "revised",
  "approved",
  "applying",
  "applied",
  "partially_applied",
  "stale",
  "dismissed",
] as const;

export type OperatorProposalStatus = (typeof OPERATOR_PROPOSAL_STATUSES)[number];

export type OperatorProposalResult = Readonly<{
  appliedTaskIds: string[];
  skippedTaskIds: Array<{ id: string; reason: string }>;
  failedTaskIds: Array<{ id: string; reason: string }>;
  staleDetected: boolean;
  appliedAt: string;
  status: OperatorProposalStatus;
}>;

export type OperatorProposalRecord = Readonly<{
  id: string;
  revision: number;
  ownerUserId: string;
  localDate: string;
  timeContextId: string;
  baselineHash: string;
  proposedTaskIds: string[];
  taskVersions: OperatorProposalTaskVersion[];
  parentProposalId: string | null;
  idempotencyKey: string;
  status: OperatorProposalStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  appliedAt: string | null;
  dismissedAt: string | null;
  result: OperatorProposalResult | null;
  aiRef: string | null;
}>;

export interface OperatorProposalRepository {
  createProposal(
    actor: AuthenticatedActor,
    data: Readonly<{
      id?: string;
      revision: number;
      localDate: string;
      timeContextId: string;
      baselineHash: string;
      proposedTaskIds: string[];
      taskVersions: OperatorProposalTaskVersion[];
      parentProposalId: string | null;
      idempotencyKey: string;
      status: OperatorProposalStatus;
      aiRef: string | null;
    }>,
  ): Promise<RepositoryResult<OperatorProposalRecord>>;
  findById(
    actor: AuthenticatedActor,
    id: string,
  ): Promise<RepositoryResult<OperatorProposalRecord | null>>;
  findByIdempotencyKey(
    actor: AuthenticatedActor,
    key: string,
  ): Promise<RepositoryResult<OperatorProposalRecord | null>>;
  updateProposal(
    actor: AuthenticatedActor,
    id: string,
    patch: Readonly<{
      status?: OperatorProposalStatus;
      approvedAt?: string | null;
      appliedAt?: string | null;
      dismissedAt?: string | null;
      result?: OperatorProposalResult | null;
      updatedAt?: string;
    }>,
  ): Promise<RepositoryResult<OperatorProposalRecord>>;
  listProposals(
    actor: AuthenticatedActor,
    filter?: Readonly<{ localDate?: string; status?: OperatorProposalStatus; limit?: number }>,
  ): Promise<RepositoryResult<OperatorProposalRecord[]>>;
  deleteOlderThan(
    actor: AuthenticatedActor,
    cutoffIso: string,
  ): Promise<RepositoryResult<number>>;
  /**
   * Atomic claim: transition approved → applying exactly once per proposal.
   * Implementation must be WHERE id = :id AND owner_user_id = :actor.userId AND status = 'approved'
   * returning the claimed row only for the winner. Losers receive null.
   * Only winner may mutate Tasks; losers must not mutate.
   */
  claimApprovedProposalForApply(
    actor: AuthenticatedActor,
    proposalId: string,
  ): Promise<RepositoryResult<OperatorProposalRecord | null>>;
  // For testing: list all for owner
  findByLocalDate?(
    actor: AuthenticatedActor,
    localDate: string,
  ): Promise<RepositoryResult<OperatorProposalRecord[]>>;
}

export interface OperatorTaskLookupPort {
  getTask(
    actor: AuthenticatedActor,
    taskId: string,
  ): Promise<RepositoryResult<{ id: string; status: string; updatedAt: string; priority: string; dueDate: string | null; focusRank: number | null; estimateMinutes: number | null; plannedForDate: string | null; archivedAt: string | null } | null>>;
}

export interface OperatorTodayMutationPort {
  setPlannedDate(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; plannedForDate: string | null }>,
  ): Promise<RepositoryResult<unknown>>;
}

// ---------------------------------------------------------------------------
// Helpers — validation, hash, stale detection
// ---------------------------------------------------------------------------

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).valueOf());
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function validateProposedTaskIds(ids: unknown): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(ids)) return { ok: false, message: "Proposed Task ids must be an array." };
  if (ids.length > 6) return { ok: false, message: "Proposal exceeds maximum of 6 tasks." };
  // Allow sparse 0 for empty days, but if present must be deduplicated and non-empty strings
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string" || !raw.trim()) return { ok: false, message: "Task id is invalid." };
    const id = raw.trim();
    if (id.length > 256) return { ok: false, message: "Task id is too long." };
    if (seen.has(id)) return { ok: false, message: "Duplicate Task id in proposal." };
    seen.add(id);
    out.push(id);
  }
  return { ok: true, value: out };
}

function normalizeAiRef(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1024) : null;
}

function deriveTimezoneFromTimeContextId(timeContextId: string): string {
  const parts = String(timeContextId ?? "").split("::");
  const tz = parts[1]?.trim();
  return tz && tz.length > 0 ? tz : "UTC";
}

function sortTaskIds(ids: string[]): string[] {
  return [...ids].map((id) => String(id).trim()).sort((a, b) => a.localeCompare(b));
}

export function computeCreateProposalRequestFingerprint(input: Readonly<{
  localDate: string;
  timeContextId: string;
  timezone: string;
  proposedTaskIds: string[];
  parentProposalId: string | null;
  aiRef: string | null;
}>): string {
  const normalized = {
    v: 1,
    localDate: String(input.localDate).trim(),
    timeContextId: String(input.timeContextId).trim(),
    timezone: String(input.timezone).trim() || "UTC",
    proposedTaskIds: sortTaskIds(input.proposedTaskIds),
    parentProposalId: input.parentProposalId ? String(input.parentProposalId).trim() : null,
    aiRef: input.aiRef ? String(input.aiRef).trim().slice(0, 1024) : null,
  };
  if (normalized.parentProposalId === "") normalized.parentProposalId = null;
  if (normalized.aiRef === "") normalized.aiRef = null;
  const json = JSON.stringify(normalized);
  return createHash("sha256").update(json).digest("hex");
}

export function computeReviseProposalRequestFingerprint(input: Readonly<{
  parentProposalId: string;
  proposedTaskIds: string[];
  aiRef: string | null;
}>): string {
  const normalized = {
    v: 1,
    parentProposalId: String(input.parentProposalId).trim(),
    proposedTaskIds: sortTaskIds(input.proposedTaskIds),
    aiRef: input.aiRef ? String(input.aiRef).trim().slice(0, 1024) : null,
  };
  if (normalized.aiRef === "") normalized.aiRef = null;
  const json = JSON.stringify(normalized);
  return createHash("sha256").update(json).digest("hex");
}

function computeStoredCreateFingerprint(record: OperatorProposalRecord): string {
  const timezone = deriveTimezoneFromTimeContextId(record.timeContextId);
  return computeCreateProposalRequestFingerprint({
    localDate: record.localDate,
    timeContextId: record.timeContextId,
    timezone,
    proposedTaskIds: record.proposedTaskIds,
    parentProposalId: record.parentProposalId,
    aiRef: record.aiRef,
  });
}

function computeStoredReviseFingerprint(record: OperatorProposalRecord): string {
  return computeReviseProposalRequestFingerprint({
    parentProposalId: record.parentProposalId ?? "",
    proposedTaskIds: record.proposedTaskIds,
    aiRef: record.aiRef,
  });
}

export function computeOperatorBaselineHash(input: {
  version: string;
  date: string;
  timezone: string;
  timeContextId: string;
  candidateIds: string[];
  taskVersions: OperatorProposalTaskVersion[];
}): string {
  // Reuse canonical hash input shape from proposal builder
  let dayWindow: { startUtcIso: string; endUtcIso: string };
  try {
    const w = getLocalDayWindow(input.timezone, input.date);
    dayWindow = { startUtcIso: w.startUtcIso, endUtcIso: w.endUtcIso };
  } catch {
    const iso = new Date().toISOString();
    dayWindow = { startUtcIso: iso, endUtcIso: iso };
  }
  const proposalLike: OperatorProposal = {
    version: input.version,
    date: input.date,
    timezone: input.timezone,
    timeContextId: input.timeContextId,
    generatedAt: new Date().toISOString(),
    candidateIds: input.candidateIds,
    tasks: [] as unknown as OperatorProposal["tasks"],
    totalEstimateMinutes: 0,
    isSparse: false,
    remainingCandidates: 0,
    dayWindow,
    sourceEvidence: {
      version: input.version,
      generatedAt: new Date().toISOString(),
      date: input.date,
      timezone: input.timezone,
      timeContextId: input.timeContextId,
      totalCandidatesConsidered: input.candidateIds.length,
      candidateIds: input.candidateIds,
      taskVersions: input.taskVersions,
      dayWindow,
    },
  };
  const hashInput = getOperatorProposalHashInput(proposalLike);
  const json = JSON.stringify(hashInput);
  return createHash("sha256").update(json).digest("hex");
}

function isTerminalStatus(status: OperatorProposalStatus): boolean {
  return status === "applied" || status === "partially_applied" || status === "stale" || status === "dismissed";
}

function isTaskExcluded(task: { status: string; archivedAt: string | null }): boolean {
  if (isTaskCompletedStatus(task.status)) return true;
  if (isTaskCanceledStatus(task.status)) return true;
  if (String(task.status).trim().toLowerCase() === "blocked") return true;
  if (task.archivedAt) return true;
  return false;
}

function validateExplicitTaskIds(
  proposedTaskIds: string[],
  explicitIds: unknown,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (explicitIds === undefined) return { ok: true, value: [...proposedTaskIds] };
  if (!Array.isArray(explicitIds)) return { ok: false, message: "Apply task ids must be an array." };
  if (explicitIds.length > 6) return { ok: false, message: "Apply exceeds maximum of 6 tasks." };
  const proposedSet = new Set(proposedTaskIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of explicitIds) {
    if (typeof raw !== "string" || !raw.trim()) return { ok: false, message: "Apply task id is invalid." };
    const id = raw.trim();
    if (id.length > 256) return { ok: false, message: "Apply task id is too long." };
    if (seen.has(id)) return { ok: false, message: "Duplicate Task id in apply." };
    if (!proposedSet.has(id)) return { ok: false, message: `Task ${id} is not part of proposal.` };
    seen.add(id);
    out.push(id);
  }
  // Allow empty explicit array as no-op but preserve idempotency semantics
  return { ok: true, value: out };
}

export async function validateProposedTasksShared(
  actor: AuthenticatedActor,
  lookup: OperatorTaskLookupPort,
  proposedTaskIds: string[],
): Promise<
  | { ok: true; versions: OperatorProposalTaskVersion[] }
  | { ok: false; message: string; code: "notFound" | "validation" | "unknown" }
> {
  if (proposedTaskIds.length === 0) {
    // Sparse day: allow empty, but still need to validate nothing
    return { ok: true, versions: [] };
  }
  const versions: OperatorProposalTaskVersion[] = [];
  for (const id of proposedTaskIds) {
    const result = await lookup.getTask(actor, id);
    if (!result.ok) return { ok: false, message: "Unable to validate Task state right now.", code: "unknown" };
    if (!result.value) return { ok: false, message: `Task ${id} not found.`, code: "notFound" };
    const task = result.value;
    if (isTaskExcluded(task)) return { ok: false, message: `Task ${id} is not actionable.`, code: "validation" };
    // Owner isolation: lookup already scoped to actor, but if task belongs to other owner, it would be null (not found) — already handled
    versions.push({
      id: task.id,
      updatedAt: task.updatedAt,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      focusRank: task.focusRank,
      estimateMinutes: task.estimateMinutes,
      plannedForDate: task.plannedForDate,
    });
  }
  return { ok: true, versions };
}

export async function detectStale(
  actor: AuthenticatedActor,
  lookup: OperatorTaskLookupPort,
  proposal: OperatorProposalRecord,
  explicitIds?: string[],
): Promise<{ stale: boolean; reason?: string }> {
  // Compare stored taskVersions vs current tasks — when explicitIds provided,
  // only check subset (partial explicit apply should not be blocked by unrelated stale tasks)
  const filter = explicitIds ? new Set(explicitIds) : null;
  const versionsToCheck = filter
    ? proposal.taskVersions.filter((v) => filter.has(v.id))
    : proposal.taskVersions;
  for (const stored of versionsToCheck) {
    const currentResult = await lookup.getTask(actor, stored.id);
    if (!currentResult.ok) return { stale: true, reason: "Unable to load Task for stale check." };
    if (!currentResult.value) return { stale: true, reason: `Task ${stored.id} missing.` };
    const current = currentResult.value;
    // Completed/archived/canceled/blocked are handled as per-task skip with structured result,
    // not as whole-proposal stale — allows partial apply to succeed for remaining tasks.
    if (isTaskExcluded(current)) continue;
    if (current.updatedAt !== stored.updatedAt) return { stale: true, reason: `Task ${stored.id} updatedAt mismatch.` };
    if (current.status !== stored.status) return { stale: true, reason: `Task ${stored.id} status changed.` };
    if (current.priority !== stored.priority) return { stale: true, reason: `Task ${stored.id} priority changed.` };
    if (current.dueDate !== stored.dueDate) return { stale: true, reason: `Task ${stored.id} dueDate changed.` };
    if (current.focusRank !== stored.focusRank) return { stale: true, reason: `Task ${stored.id} focusRank changed.` };
    if (current.estimateMinutes !== stored.estimateMinutes) return { stale: true, reason: `Task ${stored.id} estimate changed.` };
    if (current.plannedForDate !== stored.plannedForDate) return { stale: true, reason: `Task ${stored.id} plannedForDate changed.` };
  }
  // Also detect if new blocking tasks appeared? For now only check versions.
  // Additional check: if proposal has 0 tasks but there are now actionable tasks? Not stale — sparse is valid.
  return { stale: false };
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

function operatorFailure<T = never>(message: string, code: ApplicationErrorCode = "validation"): ApplicationResult<T> {
  return applicationFailure(message, code);
}

export async function createOperatorProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  taskLookup: OperatorTaskLookupPort,
  input: Readonly<{
    localDate: unknown;
    timeContextId: unknown;
    proposedTaskIds: unknown;
    idempotencyKey: unknown;
    parentProposalId?: unknown;
    aiRef?: unknown;
    timezone?: unknown;
  }>,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const localDate = String(input.localDate ?? "").trim();
  if (!isValidDateString(localDate)) return operatorFailure("Local date is invalid. Expected YYYY-MM-DD.");

  const timeContextId = String(input.timeContextId ?? "").trim();
  if (!timeContextId) return operatorFailure("Time context is required.");
  if (timeContextId.length > 256) return operatorFailure("Time context id is too long.");

  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) return operatorFailure("Idempotency key is required.");

  const proposedIdsValidation = validateProposedTaskIds(input.proposedTaskIds);
  if (!proposedIdsValidation.ok) return operatorFailure(proposedIdsValidation.message);
  const proposedTaskIds = proposedIdsValidation.value;

  const parentProposalId = input.parentProposalId ? String(input.parentProposalId).trim() : null;
  if (parentProposalId && !parentProposalId) return operatorFailure("Parent proposal id is invalid.");

  const aiRefRaw = input.aiRef !== undefined && input.aiRef !== null ? String(input.aiRef).trim() : null;
  const aiRef = aiRefRaw && aiRefRaw.length > 0 ? aiRefRaw.slice(0, 1024) : null;

  const timezone = typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : "UTC";

  const incomingFingerprint = computeCreateProposalRequestFingerprint({
    localDate,
    timeContextId,
    timezone,
    proposedTaskIds,
    parentProposalId,
    aiRef,
  });

  // Idempotency: same key + same semantic request → same result, same key + different semantic request → conflict
  const existingByKey = await proposalRepo.findByIdempotencyKey(actor, idempotencyKey);
  if (!existingByKey.ok) return operatorFailure("Unable to check proposal idempotency right now.", "unknown");
  if (existingByKey.value) {
    const storedFingerprint = computeStoredCreateFingerprint(existingByKey.value);
    if (storedFingerprint === incomingFingerprint) {
      return applicationSuccess(existingByKey.value);
    }
    return operatorFailure("Idempotency key conflict: same key with different request payload.", "conflict");
  }

  // Shared validation — LLM/client cannot bypass
  const validation = await validateProposedTasksShared(actor, taskLookup, proposedTaskIds);
  if (!validation.ok) return operatorFailure(validation.message, validation.code);
  const taskVersions = validation.versions;

  // Compute baseline hash deterministically
  const baselineHash = computeOperatorBaselineHash({
    version: "1",
    date: localDate,
    timezone,
    timeContextId,
    candidateIds: proposedTaskIds,
    taskVersions,
  });

  // Revision handling
  let revision = 1;
  let parentId: string | null = null;
  let status: OperatorProposalStatus = "generated";
  if (parentProposalId) {
    const parentResult = await proposalRepo.findById(actor, parentProposalId);
    if (!parentResult.ok) return operatorFailure("Unable to load parent proposal.", "unknown");
    if (!parentResult.value) return operatorFailure("Parent proposal not found.", "notFound");
    const parent = parentResult.value;
    // Parent must belong to same owner (repo already scopes, but double-check)
    if (parent.ownerUserId !== actor.userId) return operatorFailure("Parent proposal not found.", "notFound");
    revision = parent.revision + 1;
    parentId = parent.id;
    status = "revised";
  }

  const createResult = await proposalRepo.createProposal(actor, {
    revision,
    localDate,
    timeContextId,
    baselineHash,
    proposedTaskIds,
    taskVersions,
    parentProposalId: parentId,
    idempotencyKey,
    status,
    aiRef,
  });
  if (!createResult.ok) {
    // Handle unique conflict as idempotency (race) — one writer wins, other compares fingerprint
    if (createResult.error.code === "conflict") {
      const retry = await proposalRepo.findByIdempotencyKey(actor, idempotencyKey);
      if (retry.ok && retry.value) {
        const storedFingerprint = computeStoredCreateFingerprint(retry.value);
        if (storedFingerprint === incomingFingerprint) {
          return applicationSuccess(retry.value);
        }
        return operatorFailure("Idempotency key conflict: same key with different request payload.", "conflict");
      }
    }
    return operatorFailure("Unable to create proposal right now.", "unknown");
  }
  return applicationSuccess(createResult.value);
}

export async function reviseOperatorProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  taskLookup: OperatorTaskLookupPort,
  input: Readonly<{
    proposalId: unknown;
    proposedTaskIds: unknown;
    idempotencyKey: unknown;
    aiRef?: unknown;
  }>,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const proposalId = String(input.proposalId ?? "").trim();
  if (!proposalId) return operatorFailure("Proposal id is required.");
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) return operatorFailure("Idempotency key is required.");
  const proposedIdsValidation = validateProposedTaskIds(input.proposedTaskIds);
  if (!proposedIdsValidation.ok) return operatorFailure(proposedIdsValidation.message);

  const aiRef = normalizeAiRef(input.aiRef);
  const incomingFingerprint = computeReviseProposalRequestFingerprint({
    parentProposalId: proposalId,
    proposedTaskIds: proposedIdsValidation.value,
    aiRef,
  });

  // Idempotency: same key + same semantic request → same result, different → conflict
  const existingByKey = await proposalRepo.findByIdempotencyKey(actor, idempotencyKey);
  if (!existingByKey.ok) return operatorFailure("Unable to check idempotency.", "unknown");
  if (existingByKey.value) {
    const storedFingerprint = computeStoredReviseFingerprint(existingByKey.value);
    if (storedFingerprint === incomingFingerprint) {
      return applicationSuccess(existingByKey.value);
    }
    return operatorFailure("Idempotency key conflict: same key with different revise payload.", "conflict");
  }

  const parentResult = await proposalRepo.findById(actor, proposalId);
  if (!parentResult.ok) return operatorFailure("Unable to load proposal.", "unknown");
  if (!parentResult.value) return operatorFailure("Proposal not found.", "notFound");
  const parent = parentResult.value;
  if (isTerminalStatus(parent.status)) return operatorFailure("Cannot revise a terminal proposal.");

  // Shared validation
  const validation = await validateProposedTasksShared(actor, taskLookup, proposedIdsValidation.value);
  if (!validation.ok) return operatorFailure(validation.message, validation.code);

  const baselineHash = computeOperatorBaselineHash({
    version: "1",
    date: parent.localDate,
    timezone: parent.timeContextId.split("::")[1] ?? "UTC",
    timeContextId: parent.timeContextId,
    candidateIds: proposedIdsValidation.value,
    taskVersions: validation.versions,
  });

  const createResult = await proposalRepo.createProposal(actor, {
    revision: parent.revision + 1,
    localDate: parent.localDate,
    timeContextId: parent.timeContextId,
    baselineHash,
    proposedTaskIds: proposedIdsValidation.value,
    taskVersions: validation.versions,
    parentProposalId: parent.id,
    idempotencyKey,
    status: "revised",
    aiRef,
  });
  if (!createResult.ok) {
    if (createResult.error.code === "conflict") {
      const retry = await proposalRepo.findByIdempotencyKey(actor, idempotencyKey);
      if (retry.ok && retry.value) {
        const storedFingerprint = computeStoredReviseFingerprint(retry.value);
        if (storedFingerprint === incomingFingerprint) {
          return applicationSuccess(retry.value);
        }
        return operatorFailure("Idempotency key conflict: same key with different revise payload.", "conflict");
      }
    }
    return operatorFailure("Unable to revise proposal.", "unknown");
  }
  return applicationSuccess(createResult.value);
}

export async function approveOperatorProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  taskLookup: OperatorTaskLookupPort,
  input: Readonly<{ proposalId: unknown }>,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const proposalId = String(input.proposalId ?? "").trim();
  if (!proposalId) return operatorFailure("Proposal id is required.");

  const found = await proposalRepo.findById(actor, proposalId);
  if (!found.ok) return operatorFailure("Unable to load proposal.", "unknown");
  if (!found.value) return operatorFailure("Proposal not found.", "notFound");
  const proposal = found.value;

  if (proposal.status === "approved") return applicationSuccess(proposal);
  if (isTerminalStatus(proposal.status)) return operatorFailure(`Cannot approve proposal in ${proposal.status} state.`);
  if (proposal.status !== "generated" && proposal.status !== "revised") {
    return operatorFailure(`Cannot approve proposal in ${proposal.status} state.`);
  }

  // Stale detection before mutation
  const staleCheck = await detectStale(actor, taskLookup, proposal);
  if (staleCheck.stale) {
    const updated = await proposalRepo.updateProposal(actor, proposal.id, {
      status: "stale",
      updatedAt: new Date().toISOString(),
      result: {
        appliedTaskIds: [],
        skippedTaskIds: [],
        failedTaskIds: proposal.proposedTaskIds.map((id) => ({ id, reason: staleCheck.reason ?? "stale" })),
        staleDetected: true,
        appliedAt: new Date().toISOString(),
        status: "stale",
      },
    });
    if (!updated.ok) return operatorFailure("Unable to mark proposal as stale.", "unknown");
    return applicationSuccess(updated.value);
  }

  const nowIso = new Date().toISOString();
  const updated = await proposalRepo.updateProposal(actor, proposal.id, {
    status: "approved",
    approvedAt: nowIso,
    updatedAt: nowIso,
  });
  if (!updated.ok) return operatorFailure("Unable to approve proposal.", "unknown");
  return applicationSuccess(updated.value);
}

/**
 * Invariant — atomic claim + crash-safe recovery + idempotent Task application:
 * - Atomic claim: approved → applying via `claimApprovedProposalForApply` WHERE status='approved'.
 *   Only winner receives mutation authority; losers observe applying/terminal and do not mutate.
 * - `applying` is durable recoverable state. Crash after claim before finalization leaves
 *   proposal in `applying` with no `result`. Retry with same proposalId resumes deterministically:
 *   each Task is checked for `plannedForDate === localDate` before mutating, so already-applied
 *   tasks are counted as applied without duplicate writes (mutation receipt = Task state).
 * - Stale detection is evaluated only before claim (when status `approved`), not on `applying`
 *   resume, because own prior mutations change `plannedForDate` and would otherwise appear stale.
 * - Finalization writes `result` + `applied`/`partially_applied`; retry after finalization is
 *   idempotent returning same `result` without extra mutations.
 * - Operation identity is `proposalId` (single writer per proposal); Task application is
 *   deterministic idempotent via `plannedForDate` equality.
 */
export async function applyOperatorProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  taskLookup: OperatorTaskLookupPort,
  todayMutation: OperatorTodayMutationPort,
  input: Readonly<{ proposalId: unknown; idempotencyKey?: unknown; taskIds?: unknown }>,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const proposalId = String(input.proposalId ?? "").trim();
  if (!proposalId) return operatorFailure("Proposal id is required.");

  const found = await proposalRepo.findById(actor, proposalId);
  if (!found.ok) return operatorFailure("Unable to load proposal.", "unknown");
  if (!found.value) return operatorFailure("Proposal not found.", "notFound");
  let proposal = found.value;

  // Idempotency: if already terminal, return same result (two devices same revision cannot apply twice)
  if (isTerminalStatus(proposal.status)) {
    return applicationSuccess(proposal);
  }

  if (proposal.status !== "approved" && proposal.status !== "applying") {
    return operatorFailure(`Cannot apply proposal in ${proposal.status} state. Approve first.`);
  }

  // Explicit partial apply: validate requested subset is within proposal (LLM cannot inject arbitrary ids)
  const explicitValidation = validateExplicitTaskIds(proposal.proposedTaskIds, input.taskIds);
  if (!explicitValidation.ok) return operatorFailure(explicitValidation.message);
  const explicitTaskIds = explicitValidation.value;

  if (proposal.status === "approved") {
    // Stale detection before claim — compares stored taskVersions vs current, scoped to explicit ids.
    // Evaluated only before claim; resume after crash skips this because own mutations would appear stale.
    const staleCheck = await detectStale(actor, taskLookup, proposal, explicitTaskIds);
    if (staleCheck.stale) {
      const nowIso = new Date().toISOString();
      const targetIds = explicitTaskIds.length ? explicitTaskIds : proposal.proposedTaskIds;
      const updated = await proposalRepo.updateProposal(actor, proposal.id, {
        status: "stale",
        updatedAt: nowIso,
        appliedAt: nowIso,
        result: {
          appliedTaskIds: [],
          skippedTaskIds: [],
          failedTaskIds: targetIds.map((id) => ({ id, reason: staleCheck.reason ?? "stale" })),
          staleDetected: true,
          appliedAt: nowIso,
          status: "stale",
        },
      });
      if (!updated.ok) return operatorFailure("Unable to mark proposal as stale.", "unknown");
      return applicationSuccess(updated.value);
    }

    // Atomic claim: approved → applying. Only winner may mutate Tasks.
    const claim = await proposalRepo.claimApprovedProposalForApply(actor, proposal.id);
    if (!claim.ok) return operatorFailure("Unable to claim proposal for apply.", "unknown");
    if (!claim.value) {
      // Lost race — another device claimed, or status no longer approved
      const latest = await proposalRepo.findById(actor, proposal.id);
      if (latest.ok && latest.value) {
        if (isTerminalStatus(latest.value.status)) return applicationSuccess(latest.value);
        if (latest.value.status === "applying") return operatorFailure("Proposal is already being applied.");
      }
      return operatorFailure("Proposal is already being applied.", "unknown");
    }
    proposal = claim.value;
  } else {
    // Status is `applying` — recoverable in-progress. Crash after claim leaves no `result`.
    // Resume deterministically without re-evaluating stale (own `plannedForDate` mutations would pollute check).
    if (proposal.result) {
      return applicationSuccess(proposal);
    }
    // No result yet → resume mutations idempotently; explicitTaskIds already validated.
  }

  // Partial apply: attempt each task's plannedForDate mutation — explicit subset when provided
  const targetIds = explicitTaskIds;
  const appliedTaskIds: string[] = [];
  const skippedTaskIds: Array<{ id: string; reason: string }> = [];
  const failedTaskIds: Array<{ id: string; reason: string }> = [];

  for (const taskId of targetIds) {
    // Re-validate each task is still actionable before mutation — revalidates ownership/state
    const taskCheck = await taskLookup.getTask(actor, taskId);
    if (!taskCheck.ok) {
      failedTaskIds.push({ id: taskId, reason: "Unable to load Task." });
      continue;
    }
    if (!taskCheck.value) {
      failedTaskIds.push({ id: taskId, reason: "Task not found." });
      continue;
    }
    // Archived/completed/canceled/blocked are skipped with structured reason — not mutated
    if (isTaskExcluded(taskCheck.value)) {
      const reason = taskCheck.value.archivedAt
        ? "Task is archived"
        : `Task is ${taskCheck.value.status}`;
      skippedTaskIds.push({ id: taskId, reason });
      continue;
    }
    // If already planned for this date, treat as already applied (idempotent retry for Today selection)
    if (taskCheck.value.plannedForDate === proposal.localDate) {
      appliedTaskIds.push(taskId);
      continue;
    }
    const mutation = await todayMutation.setPlannedDate(actor, {
      taskId,
      plannedForDate: proposal.localDate,
    });
    if (!mutation.ok) {
      if (mutation.error.code === "conflict") {
        skippedTaskIds.push({ id: taskId, reason: "Conflict" });
      } else {
        failedTaskIds.push({ id: taskId, reason: "Failed to plan Task." });
      }
      continue;
    }
    appliedTaskIds.push(taskId);
  }

  const nowIso = new Date().toISOString();
  let finalStatus: OperatorProposalStatus;
  const hasSkips = failedTaskIds.length > 0 || skippedTaskIds.length > 0;
  if (hasSkips) {
    if (appliedTaskIds.length === 0 && targetIds.length > 0) {
      finalStatus = "partially_applied";
    } else if (appliedTaskIds.length > 0 && hasSkips) {
      finalStatus = "partially_applied";
    } else if (targetIds.length === 0) {
      finalStatus = "applied";
    } else {
      finalStatus = "partially_applied";
    }
  } else {
    finalStatus = targetIds.length === 0 ? "applied" : appliedTaskIds.length === targetIds.length ? "applied" : "partially_applied";
    if (targetIds.length === 0) finalStatus = "applied";
  }

  // Edge: if we had no tasks to apply but proposal had tasks and all skipped as already planned? That's still applied? Let's treat as applied if all were already planned
  // For now keep partially_applied when any skipped.

  const result: OperatorProposalResult = {
    appliedTaskIds,
    skippedTaskIds,
    failedTaskIds,
    staleDetected: false,
    appliedAt: nowIso,
    status: finalStatus,
  };

  const finalUpdate = await proposalRepo.updateProposal(actor, proposal.id, {
    status: finalStatus,
    appliedAt: nowIso,
    updatedAt: nowIso,
    result,
  });
  if (!finalUpdate.ok) return operatorFailure("Unable to finalize proposal apply.", "unknown");
  return applicationSuccess(finalUpdate.value);
}

// Canonical alias for EGA-518: explicit approval before apply — use case validates
// proposal against current Task state before changing planned_for_date. Web calls
// this directly server-side; mobile via authenticated Hono/api-client. Thin
// transports must preserve this shared validation (LLM/client cannot bypass).
export const applyApprovedOperatorProposal = applyOperatorProposal;

export async function dismissOperatorProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  input: Readonly<{ proposalId: unknown }>,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const proposalId = String(input.proposalId ?? "").trim();
  if (!proposalId) return operatorFailure("Proposal id is required.");

  const found = await proposalRepo.findById(actor, proposalId);
  if (!found.ok) return operatorFailure("Unable to load proposal.", "unknown");
  if (!found.value) return operatorFailure("Proposal not found.", "notFound");
  const proposal = found.value;

  if (proposal.status === "dismissed") return applicationSuccess(proposal);
  if (isTerminalStatus(proposal.status)) {
    return operatorFailure(`Cannot dismiss proposal in ${proposal.status} state.`);
  }
  // Dismissal produces no Task/Today mutation — do not touch task repos

  const nowIso = new Date().toISOString();
  const updated = await proposalRepo.updateProposal(actor, proposal.id, {
    status: "dismissed",
    dismissedAt: nowIso,
    updatedAt: nowIso,
    result: {
      appliedTaskIds: [],
      skippedTaskIds: [],
      failedTaskIds: [],
      staleDetected: false,
      appliedAt: nowIso,
      status: "dismissed",
    },
  });
  if (!updated.ok) return operatorFailure("Unable to dismiss proposal.", "unknown");
  return applicationSuccess(updated.value);
}

export async function getOperatorStoredProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  proposalId: string,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const id = String(proposalId ?? "").trim();
  if (!id) return operatorFailure("Proposal id is required.");
  const found = await proposalRepo.findById(actor, id);
  if (!found.ok) return operatorFailure("Unable to load proposal.", "unknown");
  if (!found.value) return operatorFailure("Proposal not found.", "notFound");
  return applicationSuccess(found.value);
}

export type OperatorAcceptedBaseline = Readonly<{
  proposalId: string;
  revision: number;
  localDate: string;
  timeContextId: string;
  baselineHash: string;
  // What actually applied, including partial results, not merely original suggestion
  appliedTaskIds: string[];
  proposedTaskIds: string[];
  taskVersions: OperatorProposalTaskVersion[];
  status: OperatorProposalStatus;
  parentProposalId: string | null;
  result: OperatorProposalResult | null;
}>;

export async function getOperatorAcceptedBaseline(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  input: Readonly<{ proposalId: unknown }>,
): Promise<ApplicationResult<OperatorAcceptedBaseline>> {
  const proposalId = String(input.proposalId ?? "").trim();
  if (!proposalId) return operatorFailure("Proposal id is required.");
  const found = await proposalRepo.findById(actor, proposalId);
  if (!found.ok) return operatorFailure("Unable to load proposal.", "unknown");
  if (!found.value) return operatorFailure("Proposal not found.", "notFound");
  const p = found.value;
  // Baseline reconstructable: for applied/partially_applied, use result.appliedTaskIds, otherwise proposedTaskIds
  // For stale/dismissed, baseline is empty or original? Spec says baseline for later replanning is what actually applied, including partial, not merely original. So for not-applied, baseline is empty or original but flag status.
  const baseline: OperatorAcceptedBaseline = {
    proposalId: p.id,
    revision: p.revision,
    localDate: p.localDate,
    timeContextId: p.timeContextId,
    baselineHash: p.baselineHash,
    appliedTaskIds: p.result ? p.result.appliedTaskIds : [],
    proposedTaskIds: p.proposedTaskIds,
    taskVersions: p.taskVersions,
    status: p.status,
    parentProposalId: p.parentProposalId,
    result: p.result,
  };
  // Prefer result's appliedTaskIds when available
  if (p.result) {
    return applicationSuccess(baseline);
  }
  // If no result yet (generated/revised/approved), baseline is proposed
  return applicationSuccess({
    ...baseline,
    appliedTaskIds: [],
  });
}

export async function cleanupOperatorProposals(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  input: Readonly<{ retentionDays?: unknown; now?: Date }>,
): Promise<ApplicationResult<number>> {
  const retentionDaysRaw = input.retentionDays;
  let retentionDays = 30;
  if (typeof retentionDaysRaw === "number" && Number.isFinite(retentionDaysRaw) && retentionDaysRaw > 0) {
    retentionDays = Math.floor(retentionDaysRaw);
  } else if (typeof retentionDaysRaw === "string" && retentionDaysRaw.trim()) {
    const parsed = Number.parseInt(retentionDaysRaw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) retentionDays = parsed;
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) return operatorFailure("Current time is invalid.");
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const result = await proposalRepo.deleteOlderThan(actor, cutoff);
  if (!result.ok) return operatorFailure("Unable to cleanup proposals.", "unknown");
  return applicationSuccess(result.value);
}
