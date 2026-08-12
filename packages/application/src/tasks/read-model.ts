import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess } from "../shared/result";
import type { TaskQuery, TasksRepository } from "./ports";

export async function getTasksReadModel(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  query?: TaskQuery,
) {
  const result = await repository.listTasks(actor, query);
  return result.ok
    ? applicationSuccess({ tasks: result.value })
    : applicationFailure("Unable to load tasks right now.");
}

export async function getTaskReadModel(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  taskIdInput: unknown,
) {
  const taskId = String(taskIdInput ?? "").trim();
  if (!taskId) return applicationFailure("Task request is invalid.");

  const result = await repository.getTask(actor, taskId);
  return result.ok
    ? applicationSuccess(result.value)
    : applicationFailure("Unable to load task right now.");
}
