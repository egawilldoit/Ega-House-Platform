import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";
import type { ExecutionEvidenceWindow } from "../shared/execution-evidence";

export type WeeklyReviewRow = Readonly<{
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  nextSteps: string | null;
  createdAt: string;
  updatedAt: string | null;
  officialEmailStatus: string | null;
  officialEmailSentAt: string | null;
}>;

export interface WeeklyReviewRepository {
  getSavedReview(
    actor: AuthenticatedActor,
    weekStart: string,
    weekEnd: string,
  ): Promise<RepositoryResult<WeeklyReviewRow | null>>;
  listPastReviews(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<WeeklyReviewRow[]>>;
  getPreviousReview(
    actor: AuthenticatedActor,
    weekStart: string,
  ): Promise<RepositoryResult<WeeklyReviewRow | null>>;
}

export type WeeklyReviewTaskActivityRow = Readonly<{
  id: string;
  title: string;
  status: string;
  blockedReason: string | null;
  estimateMinutes: number | null;
  completedAt: string | null;
  updatedAt: string;
  projectName: string | null;
  goalTitle: string | null;
}>;

export interface WeeklyReviewTaskRepository {
  countTasksCreatedForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
  ): Promise<RepositoryResult<number>>;
  listGoalsTouchedForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
  ): Promise<RepositoryResult<Array<{ status: string }>>>;
  listBlockedTasks(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<Array<{ id: string; title: string; blockedReason: string | null; updatedAt: string }>>>;
  listCompletedTasksForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
    limit: number,
  ): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>>;
  listCarriedTasksForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
    limit: number,
  ): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>>;
  listBlockedTasksForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
    limit: number,
  ): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>>;
}

export type WeeklyReviewPorts = Readonly<{
  weeklyReview: WeeklyReviewRepository;
  weeklyTasks: WeeklyReviewTaskRepository;
}>;
