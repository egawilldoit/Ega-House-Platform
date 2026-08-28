import { isTaskPriority } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TasksRepository } from "../tasks/ports";
import { createTask, createTaskReminder } from "../tasks/service";
import type { InboxRecord, InboxRepository } from "./ports";

export type ConvertInboxItemInput = Readonly<{
  inboxItemId: unknown;
  projectId?: unknown;
  goalId?: unknown;
  priority?: unknown;
  dueDate?: unknown;
  title?: unknown;
  description?: unknown;
  remindAt?: unknown;
}>;

export type ConvertInboxItemResult = Readonly<{
  inboxItem: InboxRecord;
  task: import("../tasks/ports").TaskRecord;
}>;

function optionalTrimmedString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function optionalDateOnly(value: unknown): string | null {
  const normalized = optionalTrimmedString(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function isFutureDate(value: string, now: Date): boolean {
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.getTime() > now.getTime();
}

export async function convertInboxItemToTask(
  actor: AuthenticatedActor,
  inboxRepository: InboxRepository,
  tasksRepository: TasksRepository,
  input: ConvertInboxItemInput,
  options?: { now?: Date },
): Promise<ApplicationResult<ConvertInboxItemResult>> {
  const inboxItemId = String(input.inboxItemId ?? "").trim();
  if (!inboxItemId) return applicationFailure("Idea is required.");

  // 1. Load inbox item owner-scoped
  const inboxResult = await inboxRepository.getInboxItem(actor, inboxItemId);
  if (!inboxResult.ok) return applicationFailure("Unable to load idea right now.");
  const inboxItem = inboxResult.value;
  if (!inboxItem) return applicationFailure("Idea is unavailable.");

  // 2. If already converted, return existing linked task (idempotency)
  if (inboxItem.status === "converted") {
    const linkResult = await inboxRepository.getTaskIdForInboxItem(actor, inboxItemId);
    if (!linkResult.ok) return applicationFailure("Unable to load conversion link right now.");
    if (linkResult.value) {
      const taskResult = await tasksRepository.getTask(actor, linkResult.value);
      if (!taskResult.ok) return applicationFailure("Unable to load task right now.");
      if (taskResult.value) {
        return applicationSuccess({ inboxItem, task: taskResult.value });
      }
      return applicationFailure("Converted idea is missing its task.");
    }
    // No link but status is converted -> inconsistent, allow re-conversion? treat as error
    return applicationFailure("Idea is already converted.");
  }

  if (inboxItem.status === "archived") {
    return applicationFailure("Archived ideas must be restored before conversion.");
  }

  // 3. Check for existing conversion link even though status not converted (recovery path: link created but status not updated)
  const existingLink = await inboxRepository.getTaskIdForInboxItem(actor, inboxItemId);
  if (!existingLink.ok) return applicationFailure("Unable to load conversion link right now.");
  if (existingLink.value) {
    const taskResult = await tasksRepository.getTask(actor, existingLink.value);
    if (!taskResult.ok) return applicationFailure("Unable to load task right now.");
    if (taskResult.value) {
      // Try to reconcile by marking converted
      const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
      if (!markResult.ok) {
        // If marking fails, still return the existing task so caller can retry; inbox remains not converted but link exists
        // Return success with current inboxItem (not yet converted) and task to allow caller to know task exists
        // But per AC, we should report that conversion is already done? We'll return success with existing task
        // Attempt to convey that inbox is not yet converted but task exists -> still success for idempotency
        // We'll try to return the task with existing inboxItem (status not converted) but indicate reconciled?
        // For now, return success if task found, even if mark failed, to prevent duplicate task creation
        return applicationSuccess({ inboxItem, task: taskResult.value });
      }
      return applicationSuccess({ inboxItem: markResult.value, task: taskResult.value });
    }
    // Orphan link points to missing task -> treat as not existing, proceed to create new task (clean up orphan would be ideal)
    // Fall through to creation
  }

  // 4. Determine effective fields
  const effectiveTitle = optionalTrimmedString(input.title) ?? inboxItem.title.trim();
  if (!effectiveTitle) return applicationFailure("Task title is required.");

  const effectiveProjectId = (() => {
    if (input.projectId !== undefined) {
      const v = String(input.projectId ?? "").trim();
      if (!v) return null;
      return v;
    }
    return inboxItem.projectId;
  })();

  if (!effectiveProjectId) return applicationFailure("Project is required.");

  // Validate projectId format will be checked via scope; but also check UUID-ish?
  // Use domain helper via isTaskPriority etc.
  const effectivePriorityInput = input.priority !== undefined ? String(input.priority ?? "").trim() : inboxItem.priority ?? "medium";
  const effectivePriority = String(effectivePriorityInput).trim().toLowerCase();
  if (!isTaskPriority(effectivePriority)) {
    return applicationFailure("Task priority is invalid.");
  }

  const effectiveGoalId = (() => {
    if (input.goalId !== undefined) {
      const v = String(input.goalId ?? "").trim();
      return v ? v : null;
    }
    return null;
  })();

  const effectiveDescription = optionalTrimmedString(input.description) ?? inboxItem.body ?? null;

  const rawDueDate = input.dueDate !== undefined ? input.dueDate : null;
  const effectiveDueDate = rawDueDate != null && String(rawDueDate).trim() !== "" ? optionalDateOnly(rawDueDate) : null;
  if (rawDueDate != null && String(rawDueDate).trim() !== "" && effectiveDueDate === null) {
    return applicationFailure("Due date is invalid.");
  }

  // Validate project/goal ownership via TasksRepository scope (reuse canonical validation)
  const scopeResult = await tasksRepository.getScope(actor);
  if (!scopeResult.ok) return applicationFailure("Unable to validate task scope right now.");

  if (!scopeResult.value.projectIds.includes(effectiveProjectId)) {
    return applicationFailure("Selected project is unavailable.");
  }

  if (effectiveGoalId) {
    const goal = scopeResult.value.goals.find((g) => g.id === effectiveGoalId);
    if (!goal) return applicationFailure("Selected goal is unavailable.");
    if (goal.projectId !== effectiveProjectId) {
      return applicationFailure("Selected goal does not belong to the chosen project.");
    }
  }

  // 5. Create task via canonical use case (reuse)
  const taskCreateResult = await createTask(actor, tasksRepository, {
    title: effectiveTitle,
    projectId: effectiveProjectId,
    goalId: effectiveGoalId,
    description: effectiveDescription,
    status: "todo",
    priority: effectivePriority,
    dueDate: effectiveDueDate,
    estimateMinutes: null,
  });

  if (!taskCreateResult.ok) {
    // createTask already returns sanitized error messages
    return taskCreateResult as ApplicationResult<ConvertInboxItemResult>;
  }

  const createdTask = taskCreateResult.data;

  // 6. Persist conversion link before marking converted (durability)
  const linkResult = await inboxRepository.createInboxTaskLink(actor, {
    inboxItemId,
    taskId: createdTask.id,
  });

  if (!linkResult.ok) {
    // Check if it's a duplicate (concurrent conversion already succeeded)
    const isConflict = (linkResult.error as any)?.code === "conflict";
    if (isConflict) {
      // Fetch the already-linked task
      const existingTaskIdResult = await inboxRepository.getTaskIdForInboxItem(actor, inboxItemId);
      if (existingTaskIdResult.ok && existingTaskIdResult.value) {
        const existingTaskResult = await tasksRepository.getTask(actor, existingTaskIdResult.value);
        if (existingTaskResult.ok && existingTaskResult.value) {
          // Try to reconcile status
          const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
          if (markResult.ok) {
            return applicationSuccess({ inboxItem: markResult.value, task: existingTaskResult.value });
          }
          return applicationSuccess({ inboxItem, task: existingTaskResult.value });
        }
      }
      return applicationFailure("Idea is already converted.");
    }
    // Non-conflict failure: task was created but link failed -> inbox remains recoverable
    // Do not mark converted; return failure with reason, allowing retry to reconcile.
    // On next retry, we will find no link and attempt to create again, but to avoid duplicate we should check for recent orphan?
    // For now, return failure; caller can retry and we will attempt to create new task (potential duplicate).
    // To improve reconciliation, we attempt to see if link now exists (maybe transient)
    const retryLink = await inboxRepository.getTaskIdForInboxItem(actor, inboxItemId);
    if (retryLink.ok && retryLink.value) {
      const taskRetry = await tasksRepository.getTask(actor, retryLink.value);
      if (taskRetry.ok && taskRetry.value) {
        const markRetry = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
        if (markRetry.ok) return applicationSuccess({ inboxItem: markRetry.value, task: taskRetry.value });
        return applicationSuccess({ inboxItem, task: taskRetry.value });
      }
    }
    return applicationFailure("Unable to link converted task right now.");
  }

  // 7. Optionally create reminder if requested
  const rawRemindAt = input.remindAt !== undefined ? String(input.remindAt ?? "").trim() : "";
  if (rawRemindAt) {
    const remindDate = new Date(rawRemindAt);
    const now = options?.now ?? new Date();
    if (Number.isNaN(remindDate.getTime())) {
      return applicationFailure("Reminder time is invalid.");
    }
    if (remindDate.getTime() <= now.getTime()) {
      return applicationFailure("Reminder time must be in the future.");
    }
    const reminderResult = await tasksRepository.createReminder(actor, {
      taskId: createdTask.id,
      remindAt: remindDate.toISOString(),
      channel: "email",
      status: "pending",
    });
    if (!reminderResult.ok) {
      return applicationFailure("Unable to create reminder right now.");
    }
    // Use hydrated task with reminder
    const refreshed = reminderResult.value;
    // Continue to mark converted with refreshed task
    const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
    if (!markResult.ok) {
      return applicationFailure("Unable to mark idea as converted right now.");
    }
    return applicationSuccess({ inboxItem: markResult.value, task: refreshed });
  }

  // 8. Mark inbox as converted
  const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
  if (!markResult.ok) {
    return applicationFailure("Unable to mark idea as converted right now.");
  }

  return applicationSuccess({ inboxItem: markResult.value, task: createdTask });
}
