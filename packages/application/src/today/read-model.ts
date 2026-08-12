import { isTaskCompletedStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess } from "../shared/result";
import type { TasksRepository } from "../tasks/ports";

export async function getTodayReadModel(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  localDateInput: unknown,
) {
  const localDate = String(localDateInput ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return applicationFailure("Today date is invalid.");
  }

  const result = await repository.listTasks(actor, {
    plannedForDate: localDate,
    includeArchived: false,
  });

  if (!result.ok) return applicationFailure("Unable to load Today right now.");

  const completed = result.value.filter((task) => isTaskCompletedStatus(task.status)).length;
  return applicationSuccess({
    date: localDate,
    tasks: result.value,
    summary: {
      total: result.value.length,
      completed,
      remaining: result.value.length - completed,
    },
  });
}
