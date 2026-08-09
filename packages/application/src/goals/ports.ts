import type { GoalHealth, GoalStatus, GoalViewFilter } from "@ega/domain";
import { GOAL_ARCHIVE_STATUS } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type GoalProjectOptionRecord = {
  id: string;
  name: string;
};

export type GoalRecord = {
  id: string;
  projectId: string;
  title: string;
  slug: string | null;
  description: string | null;
  nextStep: string | null;
  health: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type GoalTaskContextRecord = {
  id: string;
  title: string;
  status: string;
  goalId: string;
};

export type CreateGoalRecordInput = {
  title: string;
  projectId: string;
  description: string | null;
  nextStep: string | null;
  health: GoalHealth | null;
  status: GoalStatus;
  slug: string | null;
};

export interface GoalsRepository {
  listProjectOptions(actor: AuthenticatedActor): Promise<RepositoryResult<GoalProjectOptionRecord[]>>;
  listGoals(
    actor: AuthenticatedActor,
    view: GoalViewFilter,
  ): Promise<RepositoryResult<GoalRecord[]>>;
  listGoalTasks(actor: AuthenticatedActor): Promise<RepositoryResult<GoalTaskContextRecord[]>>;
  listGoalStatuses(actor: AuthenticatedActor): Promise<RepositoryResult<string[]>>;
  createGoal(
    actor: AuthenticatedActor,
    input: CreateGoalRecordInput,
  ): Promise<RepositoryResult<null>>;
  updateGoalStatus(
    actor: AuthenticatedActor,
    input: { goalId: string; status: GoalStatus | typeof GOAL_ARCHIVE_STATUS; updatedAt: string },
  ): Promise<RepositoryResult<null>>;
  updateGoalHealth(
    actor: AuthenticatedActor,
    input: { goalId: string; health: GoalHealth | null; updatedAt: string },
  ): Promise<RepositoryResult<null>>;
  updateGoalNextStep(
    actor: AuthenticatedActor,
    input: { goalId: string; nextStep: string | null; updatedAt: string },
  ): Promise<RepositoryResult<null>>;
}
