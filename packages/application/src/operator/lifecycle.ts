import { createHash } from "node:crypto";

import { isTaskCanceledStatus, isTaskCompletedStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult, type RepositoryResult } from "../shared/result";
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

export function computeOperatorBaselineHash(input: {
  version: string;
  date: string;
  timezone: string;
  timeContextId: string;
  candidateIds: string[];
  taskVersions: OperatorProposalTaskVersion[];
}): string {
  // Reuse canonical hash input shape from proposal builder
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
    sourceEvidence: {
      version: input.version,
      generatedAt: new Date().toISOString(),
      date: input.date,
      timezone: input.timezone,
      timeContextId: input.timeContextId,
      totalCandidatesConsidered: input.candidateIds.length,
      candidateIds: input.candidateIds,
      taskVersions: input.taskVersions,
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

export async function validateProposedTasksShared(
  actor: AuthenticatedActor,
  lookup: OperatorTaskLookupPort,
  proposedTaskIds: string[],
): Promise<{ ok: true; versions: OperatorProposalTaskVersion[] } | { ok: false; message: string }> {
  if (proposedTaskIds.length === 0) {
    // Sparse day: allow empty, but still need to validate nothing
    return { ok: true, versions: [] };
  }
  const versions: OperatorProposalTaskVersion[] = [];
  for (const id of proposedTaskIds) {
    const result = await lookup.getTask(actor, id);
    if (!result.ok) return { ok: false, message: "Unable to validate Task state right now." };
    if (!result.value) return { ok: false, message: `Task ${id} not found.` };
    const task = result.value;
    if (isTaskExcluded(task)) return { ok: false, message: `Task ${id} is not actionable.` };
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
): Promise<{ stale: boolean; reason?: string }> {
  // Compare stored taskVersions vs current tasks
  for (const stored of proposal.taskVersions) {
    const currentResult = await lookup.getTask(actor, stored.id);
    if (!currentResult.ok) return { stale: true, reason: "Unable to load Task for stale check." };
    if (!currentResult.value) return { stale: true, reason: `Task ${stored.id} missing.` };
    const current = currentResult.value;
    if (current.updatedAt !== stored.updatedAt) return { stale: true, reason: `Task ${stored.id} updatedAt mismatch.` };
    if (current.status !== stored.status) return { stale: true, reason: `Task ${stored.id} status changed.` };
    if (current.priority !== stored.priority) return { stale: true, reason: `Task ${stored.id} priority changed.` };
    if (current.dueDate !== stored.dueDate) return { stale: true, reason: `Task ${stored.id} dueDate changed.` };
    if (current.focusRank !== stored.focusRank) return { stale: true, reason: `Task ${stored.id} focusRank changed.` };
    if (current.estimateMinutes !== stored.estimateMinutes) return { stale: true, reason: `Task ${stored.id} estimate changed.` };
    if (current.plannedForDate !== stored.plannedForDate) return { stale: true, reason: `Task ${stored.id} plannedForDate changed.` };
    if (isTaskExcluded(current)) return { stale: true, reason: `Task ${stored.id} is no longer actionable.` };
  }
  // Also detect if new blocking tasks appeared? For now only check versions.
  // Additional check: if proposal has 0 tasks but there are now actionable tasks? Not stale — sparse is valid.
  return { stale: false };
}

// ---------------------------------------------------------------------------
// Use cases
// ---------------------------------------------------------------------------

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
  if (!isValidDateString(localDate)) return applicationFailure("Local date is invalid. Expected YYYY-MM-DD.");

  const timeContextId = String(input.timeContextId ?? "").trim();
  if (!timeContextId) return applicationFailure("Time context is required.");
  if (timeContextId.length > 256) return applicationFailure("Time context id is too long.");

  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) return applicationFailure("Idempotency key is required.");

  const proposedIdsValidation = validateProposedTaskIds(input.proposedTaskIds);
  if (!proposedIdsValidation.ok) return applicationFailure(proposedIdsValidation.message);
  const proposedTaskIds = proposedIdsValidation.value;

  const parentProposalId = input.parentProposalId ? String(input.parentProposalId).trim() : null;
  if (parentProposalId && !parentProposalId) return applicationFailure("Parent proposal id is invalid.");

  const aiRefRaw = input.aiRef !== undefined && input.aiRef !== null ? String(input.aiRef).trim() : null;
  const aiRef = aiRefRaw && aiRefRaw.length > 0 ? aiRefRaw.slice(0, 1024) : null;

  const timezone = typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : "UTC";

  // Idempotency: if same owner+key exists, return existing (retry returns same result)
  const existingByKey = await proposalRepo.findByIdempotencyKey(actor, idempotencyKey);
  if (!existingByKey.ok) return applicationFailure("Unable to check proposal idempotency right now.");
  if (existingByKey.value) {
    // Validate that retry has same parent and task ids? For strict idempotency, if proposal already exists with same key but different payload, we should return conflict? For now return existing to satisfy retry idempotency.
    return applicationSuccess(existingByKey.value);
  }

  // Shared validation — LLM/client cannot bypass
  const validation = await validateProposedTasksShared(actor, taskLookup, proposedTaskIds);
  if (!validation.ok) return applicationFailure(validation.message);
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
    if (!parentResult.ok) return applicationFailure("Unable to load parent proposal.");
    if (!parentResult.value) return applicationFailure("Parent proposal not found.");
    const parent = parentResult.value;
    // Parent must belong to same owner (repo already scopes, but double-check)
    if (parent.ownerUserId !== actor.userId) return applicationFailure("Parent proposal not found.");
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
    // Handle unique conflict as idempotency (race)
    if (createResult.error.code === "conflict") {
      const retry = await proposalRepo.findByIdempotencyKey(actor, idempotencyKey);
      if (retry.ok && retry.value) return applicationSuccess(retry.value);
    }
    return applicationFailure("Unable to create proposal right now.");
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
  if (!proposalId) return applicationFailure("Proposal id is required.");
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  if (!idempotencyKey) return applicationFailure("Idempotency key is required.");
  const proposedIdsValidation = validateProposedTaskIds(input.proposedTaskIds);
  if (!proposedIdsValidation.ok) return applicationFailure(proposedIdsValidation.message);

  // Idempotency check first
  const existingByKey = await proposalRepo.findByIdempotencyKey(actor, idempotencyKey);
  if (!existingByKey.ok) return applicationFailure("Unable to check idempotency.");
  if (existingByKey.value) return applicationSuccess(existingByKey.value);

  const parentResult = await proposalRepo.findById(actor, proposalId);
  if (!parentResult.ok) return applicationFailure("Unable to load proposal.");
  if (!parentResult.value) return applicationFailure("Proposal not found.");
  const parent = parentResult.value;
  if (isTerminalStatus(parent.status)) return applicationFailure("Cannot revise a terminal proposal.");

  // Shared validation
  const validation = await validateProposedTasksShared(actor, taskLookup, proposedIdsValidation.value);
  if (!validation.ok) return applicationFailure(validation.message);

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
    aiRef: input.aiRef ? String(input.aiRef).trim().slice(0, 1024) : null,
  });
  if (!createResult.ok) {
    if (createResult.error.code === "conflict") {
      const retry = await proposalRepo.findByIdempotencyKey(actor, idempotencyKey);
      if (retry.ok && retry.value) return applicationSuccess(retry.value);
    }
    return applicationFailure("Unable to revise proposal.");
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
  if (!proposalId) return applicationFailure("Proposal id is required.");

  const found = await proposalRepo.findById(actor, proposalId);
  if (!found.ok) return applicationFailure("Unable to load proposal.");
  if (!found.value) return applicationFailure("Proposal not found.");
  const proposal = found.value;

  if (proposal.status === "approved") return applicationSuccess(proposal);
  if (isTerminalStatus(proposal.status)) return applicationFailure(`Cannot approve proposal in ${proposal.status} state.`);
  if (proposal.status !== "generated" && proposal.status !== "revised") {
    return applicationFailure(`Cannot approve proposal in ${proposal.status} state.`);
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
    if (!updated.ok) return applicationFailure("Unable to mark proposal as stale.");
    return applicationSuccess(updated.value);
  }

  const nowIso = new Date().toISOString();
  const updated = await proposalRepo.updateProposal(actor, proposal.id, {
    status: "approved",
    approvedAt: nowIso,
    updatedAt: nowIso,
  });
  if (!updated.ok) return applicationFailure("Unable to approve proposal.");
  return applicationSuccess(updated.value);
}

export async function applyOperatorProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  taskLookup: OperatorTaskLookupPort,
  todayMutation: OperatorTodayMutationPort,
  input: Readonly<{ proposalId: unknown; idempotencyKey?: unknown }>,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const proposalId = String(input.proposalId ?? "").trim();
  if (!proposalId) return applicationFailure("Proposal id is required.");

  const found = await proposalRepo.findById(actor, proposalId);
  if (!found.ok) return applicationFailure("Unable to load proposal.");
  if (!found.value) return applicationFailure("Proposal not found.");
  let proposal = found.value;

  // Idempotency: if already terminal, return same result (two devices same revision cannot apply twice)
  if (isTerminalStatus(proposal.status)) {
    return applicationSuccess(proposal);
  }

  if (proposal.status !== "approved" && proposal.status !== "applying") {
    return applicationFailure(`Cannot apply proposal in ${proposal.status} state. Approve first.`);
  }

  // If status is already applying, treat as idempotent in-progress — return current
  if (proposal.status === "applying" && proposal.result) {
    return applicationSuccess(proposal);
  }

  // Stale detection before mutation (compare taskVersions vs current)
  const staleCheck = await detectStale(actor, taskLookup, proposal);
  if (staleCheck.stale) {
    const nowIso = new Date().toISOString();
    const updated = await proposalRepo.updateProposal(actor, proposal.id, {
      status: "stale",
      updatedAt: nowIso,
      appliedAt: nowIso,
      result: {
        appliedTaskIds: [],
        skippedTaskIds: [],
        failedTaskIds: proposal.proposedTaskIds.map((id) => ({ id, reason: staleCheck.reason ?? "stale" })),
        staleDetected: true,
        appliedAt: nowIso,
        status: "stale",
      },
    });
    if (!updated.ok) return applicationFailure("Unable to mark proposal as stale.");
    return applicationSuccess(updated.value);
  }

  // Transition to applying
  const applyingIso = new Date().toISOString();
  const applyingUpdate = await proposalRepo.updateProposal(actor, proposal.id, {
    status: "applying",
    updatedAt: applyingIso,
  });
  if (!applyingUpdate.ok) return applicationFailure("Unable to transition proposal to applying.");
  proposal = applyingUpdate.value;

  // Partial apply: attempt each task's plannedForDate mutation
  const appliedTaskIds: string[] = [];
  const skippedTaskIds: Array<{ id: string; reason: string }> = [];
  const failedTaskIds: Array<{ id: string; reason: string }> = [];

  for (const taskId of proposal.proposedTaskIds) {
    // Re-validate each task is still actionable before mutation
    const taskCheck = await taskLookup.getTask(actor, taskId);
    if (!taskCheck.ok) {
      failedTaskIds.push({ id: taskId, reason: "Unable to load Task." });
      continue;
    }
    if (!taskCheck.value) {
      failedTaskIds.push({ id: taskId, reason: "Task not found." });
      continue;
    }
    if (isTaskExcluded(taskCheck.value)) {
      skippedTaskIds.push({ id: taskId, reason: `Task is ${taskCheck.value.status}` });
      continue;
    }
    // If already planned for this date, skip as already applied (idempotent)
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
  if (failedTaskIds.length > 0 || skippedTaskIds.length > 0) {
    if (appliedTaskIds.length === 0) {
      finalStatus = failedTaskIds.length > 0 ? "stale" : "partially_applied";
      // If nothing applied and all failed, consider stale? But spec says partially_applied when some skipped
      // For simplicity: if any applied, partially_applied; if none applied but some skipped/failed, also partially_applied unless all failed due to stale?
      // We'll define: if appliedTaskIds >0 and (skipped+failed)>0 => partially_applied, if applied==0 and proposed>0 => partially_applied (records exactly what skipped)
      // To avoid stale confusion, use partially_applied when no applied but there were attempts
      if (appliedTaskIds.length === 0 && proposal.proposedTaskIds.length > 0) {
        finalStatus = "partially_applied";
      }
    } else if (failedTaskIds.length > 0 || skippedTaskIds.length > 0) {
      finalStatus = "partially_applied";
    } else {
      finalStatus = "applied";
    }
  } else {
    finalStatus = appliedTaskIds.length === proposal.proposedTaskIds.length ? "applied" : appliedTaskIds.length === 0 && proposal.proposedTaskIds.length === 0 ? "applied" : "partially_applied";
    // Empty proposal with 0 tasks -> applied (nothing to do)
    if (proposal.proposedTaskIds.length === 0) finalStatus = "applied";
    if (appliedTaskIds.length === proposal.proposedTaskIds.length) finalStatus = "applied";
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
  if (!finalUpdate.ok) return applicationFailure("Unable to finalize proposal apply.");
  return applicationSuccess(finalUpdate.value);
}

export async function dismissOperatorProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  input: Readonly<{ proposalId: unknown }>,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const proposalId = String(input.proposalId ?? "").trim();
  if (!proposalId) return applicationFailure("Proposal id is required.");

  const found = await proposalRepo.findById(actor, proposalId);
  if (!found.ok) return applicationFailure("Unable to load proposal.");
  if (!found.value) return applicationFailure("Proposal not found.");
  const proposal = found.value;

  if (proposal.status === "dismissed") return applicationSuccess(proposal);
  if (isTerminalStatus(proposal.status)) {
    return applicationFailure(`Cannot dismiss proposal in ${proposal.status} state.`);
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
  if (!updated.ok) return applicationFailure("Unable to dismiss proposal.");
  return applicationSuccess(updated.value);
}

export async function getOperatorStoredProposal(
  actor: AuthenticatedActor,
  proposalRepo: OperatorProposalRepository,
  proposalId: string,
): Promise<ApplicationResult<OperatorProposalRecord>> {
  const id = String(proposalId ?? "").trim();
  if (!id) return applicationFailure("Proposal id is required.");
  const found = await proposalRepo.findById(actor, id);
  if (!found.ok) return applicationFailure("Unable to load proposal.");
  if (!found.value) return applicationFailure("Proposal not found.");
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
  if (!proposalId) return applicationFailure("Proposal id is required.");
  const found = await proposalRepo.findById(actor, proposalId);
  if (!found.ok) return applicationFailure("Unable to load proposal.");
  if (!found.value) return applicationFailure("Proposal not found.");
  const p = found.value;
  // Baseline reconstructable: for applied/partially_applied, use result.appliedTaskIds, otherwise proposedTaskIds
  const appliedTaskIds = p.result?.appliedTaskIds ?? (p.status === "applied" || p.status === "partially_applied" ? p.proposedTaskIds : []);
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
  if (Number.isNaN(now.getTime())) return applicationFailure("Current time is invalid.");
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const result = await proposalRepo.deleteOlderThan(actor, cutoff);
  if (!result.ok) return applicationFailure("Unable to cleanup proposals.");
  return applicationSuccess(result.value);
}
