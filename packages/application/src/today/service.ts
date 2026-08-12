import { isTaskStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TaskRecord } from "../tasks/ports";
import type { TodayTaskRepository } from "../tasks/mutations-ports";

function normalizeDate(value: unknown): string | null {
  const date = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export async function planTaskForToday(
  actor: AuthenticatedActor,
  repository: TodayTaskRepository,
  input: { taskId: unknown; date: unknown },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  const date = normalizeDate(input.date);
  if (!taskId) return applicationFailure("Task is required.");
  if (!date) return applicationFailure("Today date is invalid.");

  const result = await repository.setPlannedDate(actor, { taskId, plannedForDate: date });
  return result.ok
    ? applicationSuccess(result.value)
    : applicationFailure("Unable to add task to Today right now.");
}

export async function removeTaskFromToday(
  actor: AuthenticatedActor,
  repository: TodayTaskRepository,
  input: { taskId: unknown },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task is required.");

  const result = await repository.setPlannedDate(actor, { taskId, plannedForDate: null });
  return result.ok
    ? applicationSuccess(result.value)
    : applicationFailure("Unable to remove task from Today right now.");
}

export async function updateTodayTaskStatus(
  actor: AuthenticatedActor,
  repository: TodayTaskRepository,
  input: { taskId: unknown; status: unknown; blockedReason?: unknown },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  const status = String(input.status ?? "").trim();
  const blockedReason = String(input.blockedReason ?? "").trim() || null;

  if (!taskId) return applicationFailure("Task is required.");
  if (!isTaskStatus(status)) return applicationFailure("Task status is invalid.");
  if (status === "blocked" && !blockedReason) {
    return applicationFailure("Blocked reason is required when status is Blocked.");
  }

  const result = await repository.setStatus(actor, { taskId, status, blockedReason });
  return result.ok
    ? applicationSuccess(result.value)
    : applicationFailure("Unable to update Today task right now.");
}

export async function clearCompletedToday(
  actor: AuthenticatedActor,
  repository: TodayTaskRepository,
  input: { date: unknown },
): Promise<ApplicationResult<{ clearedCount: number }>> {
  const date = normalizeDate(input.date);
  if (!date) return applicationFailure("Today date is invalid.");

  const result = await repository.clearCompletedPlannedDate(actor, { plannedForDate: date });
  return result.ok
    ? applicationSuccess({ clearedCount: result.value })
    : applicationFailure("Unable to clear completed Today items right now.");
}
