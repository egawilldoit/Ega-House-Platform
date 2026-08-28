import {
  FRICTION_STALE_THRESHOLD_DAYS,
  FRICTION_STALE_THRESHOLD_MS,
  getFrictionAgeDays,
  isActiveFrictionGoal,
  isActiveFrictionTask,
  isFrictionStale,
} from "@ega/domain";
import type {
  FrictionBlockedSignal,
  FrictionRadarResponse,
  FrictionStaleGoalSignal,
  FrictionStaleTaskSignal,
} from "@ega/contracts/friction";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { FrictionRepository } from "./ports";

/**
 * Canonical stale threshold — deterministic and owned outside UI/transport.
 * Re-exported so application and contracts agree.
 */
export const STALE_THRESHOLD_DAYS = FRICTION_STALE_THRESHOLD_DAYS;
export const STALE_THRESHOLD_MS = FRICTION_STALE_THRESHOLD_MS;

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
 * Friction Radar read model — stale and blocked signals.
 * Owner-scoped via the supplied repository; threshold deterministic.
 */
export async function getFrictionRadarReadModel(
  actor: AuthenticatedActor,
  repository: FrictionRepository,
  options?: Readonly<{ now?: Date }>,
): Promise<ApplicationResult<FrictionRadarResponse>> {
  const now = options?.now ?? new Date();

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

  return applicationSuccess({
    ok: true as const,
    generatedAt: now.toISOString(),
    thresholdDays: STALE_THRESHOLD_DAYS,
    blocked,
    staleTasks,
    staleGoals,
  });
}
