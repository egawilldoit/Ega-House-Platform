import {
  GOAL_ARCHIVE_STATUS,
  GOAL_STATUS_VALUES,
  isGoalStatus,
  normalizeGoalHealthInput,
  normalizeGoalNextStepInput,
  type GoalHealth,
  type GoalStatus,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import { normalizeProjectSlug } from "../projects/service";
import type { GoalsRepository } from "./ports";

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
  | Readonly<{ ok: true; data: null; values: GoalFormValues }>
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

  const result = await repository.createGoal(actor, {
    title,
    projectId,
    description: description || null,
    nextStep: nextStep.value,
    health: health.value,
    status,
    slug: slug || null,
  });

  if (!result.ok) {
    return { ok: false, errorMessage: "Unable to create goal right now.", values };
  }

  return { ok: true, data: null, values };
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
  input: GoalUpdateInput & { status: GoalStatus | typeof GOAL_ARCHIVE_STATUS },
): Promise<ApplicationResult<null>> {
  const goalId = String(input.goalId ?? "").trim();

  if (!goalId) {
    return applicationFailure("Goal update request is invalid.");
  }

  const result = await repository.updateGoalStatus(actor, {
    goalId,
    status: input.status,
    updatedAt: (input.now ?? new Date()).toISOString(),
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
    status: GOAL_ARCHIVE_STATUS,
  });
}

export function unarchiveGoal(
  actor: AuthenticatedActor,
  repository: GoalsRepository,
  input: GoalUpdateInput,
): Promise<ApplicationResult<null>> {
  return setGoalArchiveState(actor, repository, {
    ...input,
    status: "active",
  });
}

export type { GoalHealth };
