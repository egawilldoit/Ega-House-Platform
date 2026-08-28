import { isTaskPriority, isTaskStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type {
  CreateTaskRecordInput,
  TaskRecord,
  TasksRepository,
  UpdateTaskRecordInput,
} from "./ports";

function optionalTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function optionalDateOnly(value: unknown): string | null {
  const normalized = optionalTrimmedString(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeEstimate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function mutationFailure(message: string): ApplicationResult<TaskRecord> {
  return applicationFailure(message);
}

export async function createTask(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  input: {
    title: unknown;
    projectId: unknown;
    goalId?: unknown;
    description?: unknown;
    blockedReason?: unknown;
    status?: unknown;
    priority?: unknown;
    dueDate?: unknown;
    estimateMinutes?: unknown;
  },
  options?: { preallocatedId?: string },
): Promise<ApplicationResult<TaskRecord>> {
  const title = String(input.title ?? "").trim();
  const projectId = String(input.projectId ?? "").trim();
  const goalId = optionalTrimmedString(input.goalId);
  const description = optionalTrimmedString(input.description);
  const blockedReason = optionalTrimmedString(input.blockedReason);
  const statusCandidate = String(input.status ?? "todo").trim();
  const priorityCandidate = String(input.priority ?? "medium").trim();

  if (!title) return applicationFailure("Task title is required.");
  if (!projectId) return applicationFailure("Project is required.");
  if (!isTaskStatus(statusCandidate)) return applicationFailure("Task status is invalid.");
  if (!isTaskPriority(priorityCandidate)) return applicationFailure("Task priority is invalid.");
  if (statusCandidate === "blocked" && !blockedReason) {
    return applicationFailure("Blocked reason is required when status is Blocked.");
  }

  const scopeResult = await repository.getScope(actor);
  if (!scopeResult.ok) return applicationFailure("Unable to validate task scope right now.");

  if (!scopeResult.value.projectIds.includes(projectId)) {
    return applicationFailure("Selected project is unavailable.");
  }

  if (goalId) {
    const goal = scopeResult.value.goals.find((candidate) => candidate.id === goalId);
    if (!goal) return applicationFailure("Selected goal is unavailable.");
    if (goal.projectId !== projectId) {
      return applicationFailure("Selected goal does not belong to the chosen project.");
    }
  }

  const record: CreateTaskRecordInput = {
    ...(options?.preallocatedId ? { id: String(options.preallocatedId).trim() } : {}),
    title,
    projectId,
    goalId,
    description,
    blockedReason,
    status: statusCandidate,
    priority: priorityCandidate,
    dueDate: optionalDateOnly(input.dueDate),
    estimateMinutes: normalizeEstimate(input.estimateMinutes),
  };

  const result = await repository.createTask(actor, record);
  return result.ok
    ? applicationSuccess(result.value)
    : mutationFailure("Unable to create task right now.");
}

export async function updateTask(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  input: {
    taskId: unknown;
    title?: unknown;
    description?: unknown;
    blockedReason?: unknown;
    status?: unknown;
    priority?: unknown;
    dueDate?: unknown;
    estimateMinutes?: unknown;
    projectId?: unknown;
    goalId?: unknown;
  },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task update request is invalid.");

  const update: UpdateTaskRecordInput = { taskId };

  if (input.title !== undefined) {
    const title = String(input.title ?? "").trim();
    if (!title) return applicationFailure("Task title is required.");
    Object.assign(update, { title });
  }
  if (input.description !== undefined) Object.assign(update, { description: optionalTrimmedString(input.description) });
  if (input.blockedReason !== undefined) Object.assign(update, { blockedReason: optionalTrimmedString(input.blockedReason) });
  if (input.status !== undefined) {
    const status = String(input.status ?? "").trim();
    if (!isTaskStatus(status)) return applicationFailure("Task status is invalid.");
    if (status === "blocked" && !optionalTrimmedString(input.blockedReason)) {
      return applicationFailure("Blocked reason is required when status is Blocked.");
    }
    Object.assign(update, { status });
  }
  if (input.priority !== undefined) {
    const priority = String(input.priority ?? "").trim();
    if (!isTaskPriority(priority)) return applicationFailure("Task priority is invalid.");
    Object.assign(update, { priority });
  }
  if (input.dueDate !== undefined) Object.assign(update, { dueDate: optionalDateOnly(input.dueDate) });
  if (input.estimateMinutes !== undefined) Object.assign(update, { estimateMinutes: normalizeEstimate(input.estimateMinutes) });
  if (input.projectId !== undefined) {
    const projectId = String(input.projectId ?? "").trim();
    if (!projectId) return applicationFailure("Project is required.");
    Object.assign(update, { projectId });
  }
  if (input.goalId !== undefined) Object.assign(update, { goalId: optionalTrimmedString(input.goalId) });

  const result = await repository.updateTask(actor, update);
  return result.ok
    ? applicationSuccess(result.value)
    : mutationFailure("Unable to update task right now.");
}

export async function archiveTask(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  input: { taskId: unknown; now?: Date },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task archive request is invalid.");
  const result = await repository.setTaskArchived(actor, {
    taskId,
    archivedAt: (input.now ?? new Date()).toISOString(),
  });
  return result.ok
    ? applicationSuccess(result.value)
    : mutationFailure("Unable to archive task right now.");
}

export async function unarchiveTask(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  input: { taskId: unknown },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task unarchive request is invalid.");
  const result = await repository.setTaskArchived(actor, { taskId, archivedAt: null });
  return result.ok
    ? applicationSuccess(result.value)
    : mutationFailure("Unable to unarchive task right now.");
}

export async function createTaskReminder(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  input: { taskId: unknown; remindAt: unknown; deliveryMode?: unknown; now?: Date },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  const raw = String(input.remindAt ?? "").trim();
  const remindAt = new Date(raw);
  const now = input.now ?? new Date();

  if (!taskId) return applicationFailure("Task is required.");
  if (!raw || Number.isNaN(remindAt.getTime())) return applicationFailure("Reminder time is required.");
  if (remindAt.getTime() <= now.getTime()) return applicationFailure("Reminder time must be in the future.");

  const rawMode = String(input.deliveryMode ?? "email").trim().toLowerCase();
  const allowedModes = new Set(["push", "email", "both"]);
  const deliveryMode = allowedModes.has(rawMode) ? (rawMode as "push" | "email" | "both") : "email";
  if (input.deliveryMode !== undefined && !allowedModes.has(rawMode)) {
    return applicationFailure("Delivery mode is invalid.");
  }

  const result = await repository.createReminder(actor, {
    taskId,
    remindAt: remindAt.toISOString(),
    channel: "email",
    status: "pending",
    deliveryMode,
  });
  return result.ok
    ? applicationSuccess(result.value)
    : mutationFailure("Unable to create reminder right now.");
}

export async function cancelTaskReminder(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  input: { taskId: unknown; reminderId: unknown },
): Promise<ApplicationResult<TaskRecord>> {
  const taskId = String(input.taskId ?? "").trim();
  const reminderId = String(input.reminderId ?? "").trim();
  if (!taskId || !reminderId) return applicationFailure("Reminder cancel request is invalid.");

  const result = await repository.cancelReminder(actor, {
    taskId,
    reminderId,
    status: "cancelled",
  });
  return result.ok
    ? applicationSuccess(result.value)
    : mutationFailure("Unable to cancel reminder right now.");
}
