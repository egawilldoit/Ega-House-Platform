import type { MobileTaskListItem } from "@ega/contracts/mobile";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import { toMobileTaskListItem } from "./list-view";
import type { TasksRepository } from "./ports";

/**
 * Focus-queue pinning. Pin assigns the next focus rank above the current
 * maximum; unpin clears the rank. Both are idempotent when the task already
 * sits in the requested state, mirroring the mobile contract. A missing task
 * fails with "Selected task is unavailable." so transports can map it 404.
 */
export async function pinTask(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  input: { taskId: unknown },
): Promise<ApplicationResult<{ ok: true; task: MobileTaskListItem }>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task pin request is invalid.");

  const current = await repository.getFocusRank(actor, taskId);
  if (!current.ok || !current.value.exists) {
    return applicationFailure("Selected task is unavailable.");
  }

  if (current.value.focusRank !== null) {
    // Already pinned: idempotent success.
    return taskResponse(actor, repository, taskId);
  }

  const maxResult = await repository.getMaxFocusRank(actor, { includeArchived: true });
  if (!maxResult.ok) return applicationFailure("Unable to update focus queue right now.");

  const nextRank = (maxResult.value ?? 0) + 1;
  const update = await repository.setFocusRank(actor, { taskId, focusRank: nextRank });
  if (!update.ok) return applicationFailure("Unable to pin task right now.");

  return taskResponse(actor, repository, taskId);
}

export async function unpinTask(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  input: { taskId: unknown },
): Promise<ApplicationResult<{ ok: true; task: MobileTaskListItem }>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task unpin request is invalid.");

  const current = await repository.getFocusRank(actor, taskId);
  if (!current.ok || !current.value.exists) {
    return applicationFailure("Selected task is unavailable.");
  }

  if (current.value.focusRank === null) {
    // Already unpinned: idempotent success.
    return taskResponse(actor, repository, taskId);
  }

  const update = await repository.setFocusRank(actor, { taskId, focusRank: null });
  if (!update.ok) return applicationFailure("Unable to unpin task right now.");

  return taskResponse(actor, repository, taskId);
}

async function taskResponse(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  taskId: string,
): Promise<ApplicationResult<{ ok: true; task: MobileTaskListItem }>> {
  const task = await repository.getTask(actor, taskId);
  if (!task.ok || !task.value) return applicationFailure("Unable to load pinned task.");
  return applicationSuccess({ ok: true as const, task: toMobileTaskListItem(task.value) });
}
