import type { TaskRecurrenceRule, TaskStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";
import type { TaskRecord } from "./ports";

export type TaskRecurrenceSchedule = Readonly<{
  rule: TaskRecurrenceRule;
  anchorDate: string;
  timezone: string;
  nextOccurrenceDate: string;
}>;

export interface TaskRecurrenceRepository {
  setRecurrence(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; schedule: TaskRecurrenceSchedule | null }>,
  ): Promise<RepositoryResult<TaskRecord>>;
}

export interface TodayTaskRepository {
  setPlannedDate(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; plannedForDate: string | null; expectedUpdatedAt?: string }>,
  ): Promise<RepositoryResult<TaskRecord>>;
  setStatus(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; status: TaskStatus; blockedReason: string | null }>,
  ): Promise<RepositoryResult<TaskRecord>>;
  clearCompletedPlannedDate(
    actor: AuthenticatedActor,
    input: Readonly<{ plannedForDate: string }>,
  ): Promise<RepositoryResult<number>>;
}
