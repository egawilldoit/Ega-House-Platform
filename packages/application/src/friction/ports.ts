import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type FrictionTaskRow = Readonly<{
  id: string;
  title: string;
  blockedReason: string | null;
  status: string;
  updatedAt: string;
  projectId: string;
  goalId: string | null;
  archivedAt: string | null;
}>;

export type FrictionGoalRow = Readonly<{
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  projectId: string;
}>;

export interface FrictionRepository {
  listTasks(actor: AuthenticatedActor): Promise<RepositoryResult<FrictionTaskRow[]>>;
  listGoals(actor: AuthenticatedActor): Promise<RepositoryResult<FrictionGoalRow[]>>;
}
