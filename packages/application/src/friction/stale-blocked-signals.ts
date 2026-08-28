import {
  FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD,
  FRICTION_CONTEXT_SWITCH_THRESHOLD,
  FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD,
  FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES,
  FRICTION_ESTIMATE_PERCENT_THRESHOLD,
  FRICTION_STALE_THRESHOLD_DAYS,
  FRICTION_STALE_THRESHOLD_MS,
  getFrictionAgeDays,
  isActiveFrictionGoal,
  isActiveFrictionTask,
  isFrictionStale,
} from "@ega/domain";
import type {
  FrictionBlockedSignal,
  FrictionContextSwitchSignal,
  FrictionEstimateSignal,
  FrictionRadarResponse,
  FrictionStaleGoalSignal,
  FrictionStaleTaskSignal,
} from "@ega/contracts/friction";

import {
  type ExecutionEvidenceWindow,
  type ExecutionEvidenceRepository,
} from "../shared/execution-evidence";

import { getContextSwitchSignal } from "./context-switch";
import { getEstimateAccuracySignals } from "./estimate-accuracy";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { FrictionRepository } from "./ports";

/**
 * Canonical stale threshold — deterministic and owned outside UI/transport.
 * Re-exported so application and contracts agree.
 */
export const STALE_THRESHOLD_DAYS = FRICTION_STALE_THRESHOLD_DAYS;
export const STALE_THRESHOLD_MS = FRICTION_STALE_THRESHOLD_MS;

// Re-export deterministic thresholds owned in domain, not transports.
export const ESTIMATE_MIN_MEANINGFUL_MINUTES = FRICTION_ESTIMATE_MIN_MEANINGFUL_MINUTES;
export const ESTIMATE_PERCENT_THRESHOLD = FRICTION_ESTIMATE_PERCENT_THRESHOLD;
export const ESTIMATE_HIGH_PERCENT_THRESHOLD = FRICTION_ESTIMATE_HIGH_PERCENT_THRESHOLD;
export const CONTEXT_SWITCH_THRESHOLD = FRICTION_CONTEXT_SWITCH_THRESHOLD;
export const CONTEXT_SWITCH_HIGH_THRESHOLD = FRICTION_CONTEXT_SWITCH_HIGH_THRESHOLD;

export type FrictionRadarEvidenceOptions = Readonly<{
  window: ExecutionEvidenceWindow;
  repository: ExecutionEvidenceRepository;
  includeOpenSessions?: boolean;
  nowIso?: string;
}>;

function toBlockedSignal(
  task: { id: string; title: string; blockedReason: string | null; status: string; updatedAt: string; projectId: string; goalId: string | null },
  now: Date,
): FrictionBlockedSignal {
  return {
    id: task.id,
    title: task.title,
    blockedReason: task.blockedReason,
    ageDays: getFrictionAgeDays(task.updatedAt, now),
    updatedAt: task.updatedAt,
    projectId: task.projectId,
    goalId: task.goalId,
    status: task.status,
  };
}

function toStaleTaskSignal(
  task: { id: string; title: string; status: string; updatedAt: string; projectId: string; goalId: string | null },
  now: Date,
): FrictionStaleTaskSignal {
  return {
    id: task.id,
    title: task.title,
    ageDays: getFrictionAgeDays(task.updatedAt, now),
    updatedAt: task.updatedAt,
    status: task.status,
    projectId: task.projectId,
    goalId: task.goalId,
  };
}

function toStaleGoalSignal(
  goal: { id: string; title: string; status: string; updatedAt: string; projectId: string },
  now: Date,
): FrictionStaleGoalSignal {
  return {
    id: goal.id,
    title: goal.title,
    ageDays: getFrictionAgeDays(goal.updatedAt, now),
    updatedAt: goal.updatedAt,
    status: goal.status,
    projectId: goal.projectId,
  };
}

/**
 * Friction Radar read model — stale/blocked + estimate accuracy + context-switch.
 * Owner-scoped via the supplied repositories; thresholds deterministic and
 * owned in domain/application, not transports.
 *
 * When `evidence` is supplied, estimate and context-switch signals are
 * derived from canonical execution-evidence (window-clipped, no double-count,
 * deterministic ordered transitions). When absent, those signals return empty
 * / none so callers without evidence still receive stale/blocked semantics.
 */
export async function getFrictionRadarReadModel(
  actor: AuthenticatedActor,
  repository: FrictionRepository,
  options?: Readonly<{ now?: Date; evidence?: FrictionRadarEvidenceOptions }>,
): Promise<ApplicationResult<FrictionRadarResponse>> {
  const now = options?.now ?? new Date();
  const evidence = options?.evidence;

  const [tasksResult, goalsResult] = await Promise.all([
    repository.listTasks(actor),
    repository.listGoals(actor),
  ]);

  if (!tasksResult.ok || !goalsResult.ok) {
    return applicationFailure("Unable to load friction signals right now.");
  }

  const tasks = tasksResult.value ?? [];
  const goals = goalsResult.value ?? [];

  const blocked: FrictionBlockedSignal[] = [];
  const staleTasks: FrictionStaleTaskSignal[] = [];
  const staleGoals: FrictionStaleGoalSignal[] = [];

  for (const task of tasks) {
    // Guard against malformed rows — updatedAt must be parseable.
    const updatedAtValid = !Number.isNaN(new Date(task.updatedAt).getTime());
    if (!updatedAtValid) continue;

    const isActive = isActiveFrictionTask({
      status: task.status,
      archivedAt: task.archivedAt,
      updatedAt: task.updatedAt,
    });

    if (!isActive) continue;

    const isBlocked = String(task.status ?? "").trim().toLowerCase() === "blocked";

    if (isBlocked) {
      blocked.push(
        toBlockedSignal(
          {
            id: task.id,
            title: task.title,
            blockedReason: task.blockedReason ?? null,
            status: task.status,
            updatedAt: task.updatedAt,
            projectId: task.projectId,
            goalId: task.goalId ?? null,
          },
          now,
        ),
      );
    }

    if (isFrictionStale(task.updatedAt, now, STALE_THRESHOLD_MS)) {
      staleTasks.push(
        toStaleTaskSignal(
          {
            id: task.id,
            title: task.title,
            status: task.status,
            updatedAt: task.updatedAt,
            projectId: task.projectId,
            goalId: task.goalId ?? null,
          },
          now,
        ),
      );
    }
  }

  for (const goal of goals) {
    const updatedAtValid = !Number.isNaN(new Date(goal.updatedAt).getTime());
    if (!updatedAtValid) continue;

    if (!isActiveFrictionGoal({ status: goal.status, updatedAt: goal.updatedAt })) continue;

    if (isFrictionStale(goal.updatedAt, now, STALE_THRESHOLD_MS)) {
      staleGoals.push(
        toStaleGoalSignal(
          {
            id: goal.id,
            title: goal.title,
            status: goal.status,
            updatedAt: goal.updatedAt,
            projectId: goal.projectId,
          },
          now,
        ),
      );
    }
  }

  // Deterministic ordering: oldest first (higher ageDays), then id for stability.
  const byAgeDesc = (a: { ageDays: number; id: string }, b: { ageDays: number; id: string }) =>
    b.ageDays - a.ageDays || a.id.localeCompare(b.id);
  blocked.sort(byAgeDesc);
  staleTasks.sort(byAgeDesc);
  staleGoals.sort(byAgeDesc);

  // Optional evidence-derived signals — when not supplied we return deterministic
  // empty/none so web/mobile receive identical shape without local recalculation.
  let estimateSignals: FrictionEstimateSignal[] = [];
  let contextSwitch: FrictionContextSwitchSignal = {
    switchCount: 0,
    threshold: CONTEXT_SWITCH_THRESHOLD,
    highThreshold: CONTEXT_SWITCH_HIGH_THRESHOLD,
    severity: "none",
    isFriction: false,
    transitionsCount: 0,
    distinctTaskCount: 0,
    window: evidence?.window ? { startIso: evidence.window.startIso, endIso: evidence.window.endIso } : { startIso: now.toISOString(), endIso: now.toISOString() },
  };
  let evidenceWindow: { startIso: string; endIso: string } | null = null;

  if (evidence) {
    evidenceWindow = { startIso: evidence.window.startIso, endIso: evidence.window.endIso };
    try {
      const sessionsResult = await evidence.repository.listSessionsForWindow(actor, evidence.window);
      if (sessionsResult.ok) {
        const sessions = sessionsResult.value ?? [];
        // No double-count: actual time via canonical execution-evidence window clipping.
        estimateSignals = getEstimateAccuracySignals(sessions, evidence.window, {
          nowIso: evidence.nowIso ?? now.toISOString(),
          includeOpenSessions: evidence.includeOpenSessions,
        });
        contextSwitch = getContextSwitchSignal(sessions, evidence.window, {
          nowIso: evidence.nowIso ?? now.toISOString(),
          includeOpenSessions: evidence.includeOpenSessions,
        });
      }
      // If evidence repository fails, keep deterministic empty signals — stale/blocked still served.
    } catch {
      // Gracefully degrade to empty estimate/context-switch if evidence retrieval throws (e.g., test fake missing methods).
    }
  }

  return applicationSuccess({
    ok: true as const,
    generatedAt: now.toISOString(),
    thresholdDays: STALE_THRESHOLD_DAYS,
    blocked,
    staleTasks,
    staleGoals,
    estimateSignals,
    contextSwitch,
    evidenceWindow,
  });
}
