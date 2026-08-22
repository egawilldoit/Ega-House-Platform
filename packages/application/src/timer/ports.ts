import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type TimerSessionRecord = Readonly<{
  id: string;
  taskId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  taskTitle: string | null;
}>;

export type StartableTask = Readonly<{
  eligible: boolean;
  reason: string | null;
  taskTitle: string | null;
}>;

export interface TimerSessionRepository {
  listOpenSessions(actor: AuthenticatedActor): Promise<RepositoryResult<TimerSessionRecord[]>>;
  listRecentSessions(
    actor: AuthenticatedActor,
    input: Readonly<{ limit: number }>,
  ): Promise<RepositoryResult<TimerSessionRecord[]>>;
  getStartableTask(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string }>,
  ): Promise<RepositoryResult<StartableTask | null>>;
  insertOpenSession(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; startedAtIso: string }>,
  ): Promise<RepositoryResult<TimerSessionRecord>>;
  finalizeOpenSession(
    actor: AuthenticatedActor,
    input: Readonly<{ sessionId: string; endedAtIso: string; durationSeconds: number }>,
  ): Promise<RepositoryResult<boolean>>;
}
