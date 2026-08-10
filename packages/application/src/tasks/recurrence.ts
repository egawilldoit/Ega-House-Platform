import { normalizeTaskRecurrenceScheduleInput } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TaskRecord } from "./ports";
import type { TaskRecurrenceRepository } from "./mutations-ports";

export async function setTaskRecurrence(
  actor: AuthenticatedActor,
  repository: TaskRecurrenceRepository,
  input: {
    taskId: unknown;
    recurrenceRule: unknown;
    recurrenceAnchorDate?: unknown;
    recurrenceTimezone?: unknown;
    fallbackAnchorDate: string;
  },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task is required.");

  const normalized = normalizeTaskRecurrenceScheduleInput({
    rule: input.recurrenceRule,
    anchorDate: input.recurrenceAnchorDate,
    timezone: input.recurrenceTimezone,
    fallbackAnchorDate: input.fallbackAnchorDate,
  });
  if (normalized.errorMessage || !normalized.schedule) {
    return applicationFailure(normalized.errorMessage ?? "Recurring schedule is invalid.");
  }

  const result = await repository.setRecurrence(actor, {
    taskId,
    schedule: normalized.schedule,
  });
  return result.ok
    ? applicationSuccess(result.value)
    : applicationFailure("Unable to update recurrence right now.");
}

export async function clearTaskRecurrence(
  actor: AuthenticatedActor,
  repository: TaskRecurrenceRepository,
  input: { taskId: unknown },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task is required.");

  const result = await repository.setRecurrence(actor, { taskId, schedule: null });
  return result.ok
    ? applicationSuccess(result.value)
    : applicationFailure("Unable to clear recurrence right now.");
}
