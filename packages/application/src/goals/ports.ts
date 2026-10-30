import type { GoalHealth, GoalStatus, GoalViewFilter } from "@ega/domain";

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
  mcpOperationId?: string;
  mcpClientId?: string;
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
  ): Promise<RepositoryResult<GoalRecord | null>>;
  updateGoalStatus(
    actor: AuthenticatedActor,
    input: { goalId: string; status: GoalStatus; updatedAt: string },
  ): Promise<RepositoryResult<null>>;
  /**
   * Write the archive marker and its metadata in one statement. `archivedAt`
   * is null for a restore; the repository derives `status` and `archived_by`
   * so the pair can never diverge (DB CHECK enforces the same invariant).
   */
  updateGoalArchiveState(
    actor: AuthenticatedActor,
    input: { goalId: string; archivedAt: string | null; updatedAt: string },
  ): Promise<RepositoryResult<null>>;
  hasOpenTaskSessionForGoal(
    actor: AuthenticatedActor,
    goalId: string,
  ): Promise<RepositoryResult<boolean>>;
  updateGoalHealth(
    actor: AuthenticatedActor,
    input: { goalId: string; health: GoalHealth | null; updatedAt: string },
  ): Promise<RepositoryResult<null>>;
  updateGoalNextStep(
    actor: AuthenticatedActor,
    input: { goalId: string; nextStep: string | null; updatedAt: string },
  ): Promise<RepositoryResult<null>>;
}
