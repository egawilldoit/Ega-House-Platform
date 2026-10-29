import {
  GOAL_STATUS_VALUES,
  isGoalStatus,
  normalizeGoalHealthInput,
  normalizeGoalNextStepInput,
  type GoalHealth,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import { normalizeProjectSlug } from "../projects/service";
import type { CreateGoalRecordInput, GoalRecord, GoalsRepository } from "./ports";

export type GoalFormValues = {
  title: string;
  projectId: string;
  description: string;
  nextStep: string;
  health: string;
  status: string;
  slug: string;
};

export type CreateGoalResult =
  | Readonly<{ ok: true; data: GoalRecord | null; values: GoalFormValues }>
  | Readonly<{ ok: false; errorMessage: string; values: GoalFormValues }>;

function goalStatusMessage() {
  return `Status must be one of: ${GOAL_STATUS_VALUES.join(", ")}.`;
}

export async function createGoal(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  input: {
    title: unknown;
    projectId: unknown;
    description: unknown;
    nextStep: unknown;
    health: unknown;
    status: unknown;
    slug: unknown;
    mcpOperationId?: string;
    mcpClientId?: string;
  },
): Promise<CreateGoalResult> {
  const title = String(input.title ?? "").trim();
  const projectId = String(input.projectId ?? "").trim();
  const description = String(input.description ?? "").trim();
  const nextStep = normalizeGoalNextStepInput(String(input.nextStep ?? ""));
  const health = normalizeGoalHealthInput(String(input.health ?? ""));
  const status = String(input.status ?? "draft").trim();
  const slug = normalizeProjectSlug(String(input.slug ?? ""));

  const values: GoalFormValues = {
    title,
    projectId,
    description,
    nextStep: nextStep.value ?? "",
    health: health.value ?? "",
    status,
    slug,
  };

  if (!title) return { ok: false, errorMessage: "Goal title is required.", values };
  if (!projectId) return { ok: false, errorMessage: "Project is required.", values };
  if (!status) return { ok: false, errorMessage: "Status is required.", values };
  if (!isGoalStatus(status)) return { ok: false, errorMessage: goalStatusMessage(), values };
  if (nextStep.error) return { ok: false, errorMessage: nextStep.error, values };
  if (health.error) return { ok: false, errorMessage: health.error, values };

  const record: CreateGoalRecordInput = {
    title,
    projectId,
    description: description || null,
    nextStep: nextStep.value,
    health: health.value,
    status,
    slug: slug || null,
  };
  if (input.mcpOperationId && input.mcpClientId) {
    record.mcpOperationId = input.mcpOperationId;
    record.mcpClientId = input.mcpClientId;
  }

  const result = await repository.createGoal(actor, record);

  if (!result.ok) {
    return { ok: false, errorMessage: "Unable to create goal right now.", values };
  }

  return { ok: true, data: result.value, values };
}

type GoalUpdateInput = {
  goalId: unknown;
  now?: Date;
};

export async function updateGoalStatus(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  input: GoalUpdateInput & { status: unknown },
): Promise<ApplicationResult<null>> {
  const goalId = String(input.goalId ?? "").trim();
  const status = String(input.status ?? "").trim();

  if (!goalId || !isGoalStatus(status)) {
    return applicationFailure("Goal update request is invalid.");
  }

  const result = await repository.updateGoalStatus(actor, {
    goalId,
    status,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  return result.ok
    ? applicationSuccess(null)
    : applicationFailure("Unable to update goal right now.");
}

export async function updateGoalHealth(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  input: GoalUpdateInput & { health: unknown },
): Promise<ApplicationResult<null>> {
  const goalId = String(input.goalId ?? "").trim();

  if (!goalId) {
    return applicationFailure("Goal update request is invalid.");
  }

  const healthResult = normalizeGoalHealthInput(String(input.health ?? ""));
  if (healthResult.error) {
    return applicationFailure(healthResult.error);
  }

  const result = await repository.updateGoalHealth(actor, {
    goalId,
    health: healthResult.value,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  return result.ok
    ? applicationSuccess(null)
    : applicationFailure("Unable to update goal right now.");
}

export async function updateGoalNextStep(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  input: GoalUpdateInput & { nextStep: unknown },
): Promise<ApplicationResult<null>> {
  const goalId = String(input.goalId ?? "").trim();

  if (!goalId) {
    return applicationFailure("Goal update request is invalid.");
  }

  const nextStepResult = normalizeGoalNextStepInput(String(input.nextStep ?? ""));
  if (nextStepResult.error) {
    return applicationFailure(nextStepResult.error);
  }

  const result = await repository.updateGoalNextStep(actor, {
    goalId,
    nextStep: nextStepResult.value,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  return result.ok
    ? applicationSuccess(null)
    : applicationFailure("Unable to update goal right now.");
}

async function setGoalArchiveState(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  input: GoalUpdateInput & { archived: boolean },
): Promise<ApplicationResult<null>> {
  const goalId = String(input.goalId ?? "").trim();

  if (!goalId) {
    return applicationFailure("Goal update request is invalid.");
  }

  // Archiving a goal hides its active tasks from active surfaces, so it must
  // not detach currently running work. Mirrors the task archive rule.
  if (input.archived) {
    const timerResult = await repository.hasOpenTaskSessionForGoal(actor, goalId);
    if (!timerResult.ok) {
      return applicationFailure("Unable to validate timer sessions for this goal right now.");
    }
    if (timerResult.value) {
      return applicationFailure("Stop the active timer before archiving this goal.");
    }
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const result = await repository.updateGoalArchiveState(actor, {
    goalId,
    archivedAt: input.archived ? nowIso : null,
    updatedAt: nowIso,
  });

  return result.ok
    ? applicationSuccess(null)
    : applicationFailure("Unable to update goal right now.");
}

export function archiveGoal(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  input: GoalUpdateInput,
): Promise<ApplicationResult<null>> {
  return setGoalArchiveState(actor, repository, {
    ...input,
    archived: true,
  });
}

export function unarchiveGoal(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  input: GoalUpdateInput,
): Promise<ApplicationResult<null>> {
  return setGoalArchiveState(actor, repository, {
    ...input,
    archived: false,
  });
}

export type { GoalHealth };
