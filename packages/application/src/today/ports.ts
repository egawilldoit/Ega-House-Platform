import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type TodaySourceTask = Readonly<{
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  focusRank: number | null;
  plannedForDate: string | null;
  updatedAt: string;
  completedAt: string | null;
  projectName: string | null;
  projectSlug: string | null;
  goalTitle: string | null;
}>;

export type TodayActiveTimer = Readonly<{
  sessionId: string;
  taskId: string;
}>;

export type TodayTimerSnapshot = Readonly<{
  activeTimer: TodayActiveTimer | null;
  trackedTodaySeconds: number;
}>;

export interface TodayReadPort {
  listSelectedTasks(
    actor: AuthenticatedActor,
    input: Readonly<{ today: string }>,
  ): Promise<RepositoryResult<TodaySourceTask[]>>;
  listPinnedSuggestions(
    actor: AuthenticatedActor,
    input: Readonly<{ limit: number }>,
  ): Promise<RepositoryResult<TodaySourceTask[]>>;
  listInProgressSuggestions(
    actor: AuthenticatedActor,
    input: Readonly<{ limit: number }>,
  ): Promise<RepositoryResult<TodaySourceTask[]>>;
  getTodayTimerSnapshot(
    actor: AuthenticatedActor,
    input: Readonly<{ nowIso: string; windowStartIso: string }>,
  ): Promise<RepositoryResult<TodayTimerSnapshot>>;
}
