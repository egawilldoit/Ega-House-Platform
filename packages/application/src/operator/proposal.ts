import { isTaskCanceledStatus, isTaskCompletedStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import { toLocalIsoDate } from "../shared/duration";
import type { TodayReadPort } from "../today/ports";
import { buildTodayPlan } from "../today/plan";
import type { TodayPlanTask } from "../today/plan";
import { buildOperatorSnapshot, type OperatorSnapshot, type OperatorTask } from "./snapshot";

// ---------------------------------------------------------------------------
// Constants — deterministic proposal version & bounds
// ---------------------------------------------------------------------------

export const OPERATOR_PROPOSAL_VERSION = "1";
export const OPERATOR_PROPOSAL_MIN_TASKS = 3;
export const OPERATOR_PROPOSAL_MAX_TASKS = 6;
/**
 * Load guard — when we already have MIN tasks, stop adding if total would exceed this.
 * Tasks without estimate contribute 0.
 */
export const OPERATOR_PROPOSAL_MAX_ESTIMATE_MINUTES = 360;

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Public types — stable, explainable proposal
// ---------------------------------------------------------------------------

export type OperatorProposalTaskEvidence = Readonly<{
  priority: string;
  dueBucket: OperatorTask["dueBucket"];
  dueDate: string | null;
  focusRank: number | null;
  hasActiveTimer: boolean;
  isDueToday: boolean;
  isPlannedForToday: boolean;
  status: string;
  estimateMinutes: number | null;
  isInProgress: boolean;
}>;

export type OperatorProposalTask = Readonly<{
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  focusRank: number | null;
  plannedForDate: string | null;
  updatedAt: string;
  projectName: string;
  dueBucket: OperatorTask["dueBucket"];
  hasActiveTimer: boolean;
  reasons: string[];
  evidence: OperatorProposalTaskEvidence;
}>;

export type OperatorProposalTaskVersion = Readonly<{
  id: string;
  updatedAt: string;
  status: string;
  priority: string;
  dueDate: string | null;
  focusRank: number | null;
  estimateMinutes: number | null;
  plannedForDate: string | null;
}>;

export type OperatorProposalSourceEvidence = Readonly<{
  version: string;
  generatedAt: string;
  date: string;
  timezone: string;
  timeContextId: string;
  totalCandidatesConsidered: number;
  candidateIds: string[];
  taskVersions: OperatorProposalTaskVersion[];
}>;

export type OperatorProposal = Readonly<{
  version: string;
  date: string;
  timezone: string;
  timeContextId: string;
  generatedAt: string;
  candidateIds: string[];
  tasks: OperatorProposalTask[];
  totalEstimateMinutes: number;
  isSparse: boolean;
  remainingCandidates: number;
  sourceEvidence: OperatorProposalSourceEvidence;
}>;

export type BuildOperatorProposalInput = Readonly<{
  snapshot: OperatorSnapshot;
  timezone?: string;
  now?: Date;
}>;

// ---------------------------------------------------------------------------
// Helpers — deterministic ranking and evidence
// ---------------------------------------------------------------------------

function isBlockedStatus(status: string): boolean {
  return String(status).trim().toLowerCase() === "blocked";
}

function isExcludedTask(task: OperatorTask): boolean {
  if (isTaskCompletedStatus(task.status)) return true;
  if (isTaskCanceledStatus(task.status)) return true;
  if (isBlockedStatus(task.status)) return true;
  // Defensive: archived tasks should not appear; but if snapshot ever includes them with status archived
  if (String(task.status).trim().toLowerCase() === "archived") return true;
  // Archived via hypothetical archivedAt field on OperatorTask (not currently present, guard existence)
  const maybeArchived = (task as unknown as { archivedAt?: string | null }).archivedAt;
  if (maybeArchived) return true;
  return false;
}

function dueRank(task: OperatorTask): number {
  switch (task.dueBucket) {
    case "overdue":
      return 0;
    case "today":
      return 1;
    case "soon":
      return 2;
    case "scheduled":
      return 3;
    default:
      return 4; // none
  }
}

function compareProposalCandidates(left: OperatorTask, right: OperatorTask): number {
  if (left.hasActiveTimer !== right.hasActiveTimer) return left.hasActiveTimer ? -1 : 1;

  const leftInProgress = left.status === "in_progress";
  const rightInProgress = right.status === "in_progress";
  if (leftInProgress !== rightInProgress) return leftInProgress ? -1 : 1;

  if (left.isPlannedForToday !== right.isPlannedForToday) return left.isPlannedForToday ? -1 : 1;

  const leftPrio = PRIORITY_RANK[left.priority] ?? PRIORITY_RANK.medium;
  const rightPrio = PRIORITY_RANK[right.priority] ?? PRIORITY_RANK.medium;
  if (leftPrio !== rightPrio) return leftPrio - rightPrio;

  const leftDue = dueRank(left);
  const rightDue = dueRank(right);
  if (leftDue !== rightDue) return leftDue - rightDue;

  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate);
  }
  if ((left.dueDate !== null) !== (right.dueDate !== null)) return left.dueDate !== null ? -1 : 1;

  if (left.focusRank !== null && right.focusRank !== null && left.focusRank !== right.focusRank) {
    return left.focusRank - right.focusRank;
  }
  if ((left.focusRank !== null) !== (right.focusRank !== null)) return left.focusRank !== null ? -1 : 1;

  const leftEst = left.estimateMinutes ?? Number.MAX_SAFE_INTEGER;
  const rightEst = right.estimateMinutes ?? Number.MAX_SAFE_INTEGER;
  if (leftEst !== rightEst) return leftEst - rightEst;

  if (left.updatedAt !== right.updatedAt) return right.updatedAt.localeCompare(left.updatedAt);

  return left.id.localeCompare(right.id);
}

function buildReasons(task: OperatorTask): string[] {
  const reasons: string[] = [];
  if (task.hasActiveTimer) reasons.push("Active timer");
  if (task.status === "in_progress") reasons.push("In progress");
  if (task.isPlannedForToday) reasons.push("Planned for today");
  if (task.dueBucket === "overdue") reasons.push("Overdue");
  else if (task.dueBucket === "today") reasons.push("Due today");
  else if (task.dueBucket === "soon") reasons.push("Due soon");
  if (task.priority === "urgent") reasons.push("Urgent priority");
  else if (task.priority === "high") reasons.push("High priority");
  if (task.focusRank !== null) reasons.push(`Pinned in focus (rank ${task.focusRank})`);
  if (task.estimateMinutes !== null && task.estimateMinutes <= 30) reasons.push("Short task");
  else if (task.estimateMinutes !== null && task.estimateMinutes <= 60) reasons.push("Fits estimate budget");
  if (reasons.length === 0) reasons.push("Suggested");
  return reasons;
}

function buildEvidence(task: OperatorTask): OperatorProposalTaskEvidence {
  return {
    priority: task.priority,
    dueBucket: task.dueBucket,
    dueDate: task.dueDate,
    focusRank: task.focusRank,
    hasActiveTimer: task.hasActiveTimer,
    isDueToday: task.isDueToday,
    isPlannedForToday: task.isPlannedForToday,
    status: task.status,
    estimateMinutes: task.estimateMinutes,
    isInProgress: task.status === "in_progress",
  };
}

function toProposalTask(task: OperatorTask): OperatorProposalTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    estimateMinutes: task.estimateMinutes,
    focusRank: task.focusRank,
    plannedForDate: task.plannedForDate,
    updatedAt: task.updatedAt,
    projectName: task.projectName,
    dueBucket: task.dueBucket,
    hasActiveTimer: task.hasActiveTimer,
    reasons: buildReasons(task),
    evidence: buildEvidence(task),
  };
}

function dedupeTasks(tasks: OperatorTask[]): OperatorTask[] {
  const map = new Map<string, OperatorTask>();
  for (const t of tasks) {
    if (!map.has(t.id)) map.set(t.id, t);
  }
  return [...map.values()];
}

function selectBoundedSet(sorted: OperatorTask[]): OperatorTask[] {
  if (sorted.length === 0) return [];
  if (sorted.length <= OPERATOR_PROPOSAL_MAX_TASKS) {
    // Still respect load guard when we have more than MIN but load would exceed threshold?
    // If pool small, just return all sorted — sparse handling will mark isSparse.
    // For consistency, apply load guard even for small pools when pool size >= MIN but load huge.
    if (sorted.length < OPERATOR_PROPOSAL_MIN_TASKS) return sorted;
    // Apply load guard: iterate and stop when threshold exceeded after MIN.
    const result: OperatorTask[] = [];
    let total = 0;
    for (const task of sorted) {
      const est = task.estimateMinutes ?? 0;
      if (result.length >= OPERATOR_PROPOSAL_MIN_TASKS && total + est > OPERATOR_PROPOSAL_MAX_ESTIMATE_MINUTES) {
        break;
      }
      if (result.length >= OPERATOR_PROPOSAL_MAX_TASKS) break;
      result.push(task);
      total += est;
    }
    // Ensure at least MIN when load guard would have trimmed below MIN (already handled first MIN unconditional if we loop with condition? Actually we did unconditional for first MIN? Above condition only checks after MIN, so first MIN always added.)
    // But above loop still respects max; if sorted length > MIN but we break early due load, we return 3..6.
    // If sorted length <= MAX and load guard would trim, we return trimmed.
    // If trimmed is still < MIN? not possible because we always add first MIN.
    return result.length >= OPERATOR_PROPOSAL_MIN_TASKS ? result : sorted.slice(0, Math.min(OPERATOR_PROPOSAL_MAX_TASKS, sorted.length));
  }

  // Sorted length > MAX
  const result: OperatorTask[] = [];
  let total = 0;
  for (const task of sorted) {
    const est = task.estimateMinutes ?? 0;
    if (result.length >= OPERATOR_PROPOSAL_MIN_TASKS && total + est > OPERATOR_PROPOSAL_MAX_ESTIMATE_MINUTES) {
      break;
    }
    if (result.length >= OPERATOR_PROPOSAL_MAX_TASKS) break;
    result.push(task);
    total += est;
  }
  // Deterministic fallback: if load guard produced fewer than MIN (should not), fill to MIN ignoring load
  if (result.length < OPERATOR_PROPOSAL_MIN_TASKS) {
    return sorted.slice(0, OPERATOR_PROPOSAL_MIN_TASKS);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pure builder — side-effect free, deterministic
// ---------------------------------------------------------------------------

export function buildOperatorProposal(input: BuildOperatorProposalInput): OperatorProposal {
  const snapshot = input.snapshot;
  const now = input.now ?? new Date();
  const timezone = (input.timezone ?? "UTC").trim() || "UTC";
  const date = snapshot.date;
  const timeContextId = `${date}::${timezone}`;
  const generatedAt = now.toISOString();

  // Candidate pool — all Today-relevant tasks the snapshot knows about
  const poolRaw: OperatorTask[] = [
    ...snapshot.sections.planned,
    ...snapshot.sections.inProgress,
    ...snapshot.sections.blocked,
    ...snapshot.sections.completed,
    ...snapshot.suggestions.pinned,
    ...snapshot.suggestions.inProgress,
    ...snapshot.plannedToday,
    ...snapshot.focus.queue,
    ...snapshot.schedule.blocks,
    ...snapshot.schedule.flexible,
  ];

  const deduped = dedupeTasks(poolRaw);
  const actionable = deduped.filter((t) => !isExcludedTask(t));
  const sorted = [...actionable].sort(compareProposalCandidates);
  const selected = selectBoundedSet(sorted);

  const proposalTasks: OperatorProposalTask[] = selected.map(toProposalTask);
  const candidateIds = proposalTasks.map((t) => t.id);
  const totalEstimateMinutes = proposalTasks.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0);
  const isSparse = sorted.length < OPERATOR_PROPOSAL_MIN_TASKS || proposalTasks.length < OPERATOR_PROPOSAL_MIN_TASKS;
  const remainingCandidates = Math.max(0, sorted.length - proposalTasks.length);

  const taskVersions: OperatorProposalTaskVersion[] = proposalTasks.map((t) => ({
    id: t.id,
    updatedAt: t.updatedAt,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    focusRank: t.focusRank,
    estimateMinutes: t.estimateMinutes,
    plannedForDate: t.plannedForDate,
  }));

  const sourceEvidence: OperatorProposalSourceEvidence = {
    version: OPERATOR_PROPOSAL_VERSION,
    generatedAt,
    date,
    timezone,
    timeContextId,
    totalCandidatesConsidered: actionable.length,
    candidateIds: [...candidateIds],
    taskVersions: [...taskVersions],
  };

  return {
    version: OPERATOR_PROPOSAL_VERSION,
    date,
    timezone,
    timeContextId,
    generatedAt,
    candidateIds: [...candidateIds],
    tasks: proposalTasks,
    totalEstimateMinutes,
    isSparse,
    remainingCandidates,
    sourceEvidence,
  };
}

/**
 * Canonical hash input — stable ordered object for EGA-526 baseline hash.
 * Serializes with sorted keys and preserves candidateIds/taskVersions order.
 */
export function getOperatorProposalHashInput(proposal: OperatorProposal): Record<string, unknown> {
  return {
    version: proposal.version,
    date: proposal.date,
    timezone: proposal.timezone,
    timeContextId: proposal.timeContextId,
    candidateIds: [...proposal.candidateIds],
    taskVersions: proposal.sourceEvidence.taskVersions.map((v) => ({
      dueDate: v.dueDate,
      estimateMinutes: v.estimateMinutes,
      focusRank: v.focusRank,
      id: v.id,
      plannedForDate: v.plannedForDate,
      priority: v.priority,
      status: v.status,
      updatedAt: v.updatedAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Application use case — read-only, zero mutations, preview only
// ---------------------------------------------------------------------------

export async function getOperatorProposal(
  actor: AuthenticatedActor,
  todayPort: TodayReadPort,
  input: Readonly<{ date?: unknown; timezone?: unknown; now?: Date }> = {},
): Promise<ApplicationResult<OperatorProposal>> {
  const now = input.now ?? new Date();
  const rawDate = String(input.date ?? "").trim();
  const today = rawDate || toLocalIsoDate(now);
  const timezone = typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : "UTC";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return applicationFailure("Today date is invalid.");
  }

  const nowIso = now.toISOString();
  const dayWindowStart = new Date(`${today}T00:00:00`);
  const windowStartIso = (() => {
    const dayStart = new Date(dayWindowStart);
    if (Number.isNaN(dayStart.valueOf())) return nowIso;
    dayStart.setHours(0, 0, 0, 0);
    return dayStart.toISOString();
  })();

  const [selectedResult, pinnedResult, inProgressResult, timerResult] = await Promise.all([
    todayPort.listSelectedTasks(actor, { today }),
    todayPort.listPinnedSuggestions(actor, { limit: 80 }),
    todayPort.listInProgressSuggestions(actor, { limit: 80 }),
    todayPort.getTodayTimerSnapshot(actor, { nowIso, windowStartIso }),
  ]);

  if (!selectedResult.ok) return applicationFailure("Unable to load Today right now.");
  if (!pinnedResult.ok || !inProgressResult.ok) {
    return applicationFailure("Unable to load Today suggestions right now.");
  }

  const timerSnapshot = timerResult.ok ? timerResult.value : { activeTimer: null, trackedTodaySeconds: 0 };

  const plan = buildTodayPlan({
    today,
    selectedRows: selectedResult.value,
    pinnedRows: pinnedResult.value,
    inProgressRows: inProgressResult.value,
    activeTimer: timerSnapshot.activeTimer,
    trackedTodaySeconds: timerSnapshot.trackedTodaySeconds,
  });

  const snapshot = buildOperatorSnapshot({ plan });

  const proposal = buildOperatorProposal({ snapshot, timezone, now });

  return applicationSuccess(proposal);
}
