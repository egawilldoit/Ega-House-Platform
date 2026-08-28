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

  // 5a. Orphan reconciliation before creating new task (EGA-507)
  // If a prior convert created a Task but failed to persist the link,
  // a retry would otherwise create a second Task (duplicate). Check for
  // a recent unlinked task with matching title/project owned by this actor,
  // time-bounded to 5 minutes to avoid overly broad reuse.
  const nowForOrphan = options?.now ?? new Date();
  const sinceIso = new Date(nowForOrphan.getTime() - 5 * 60 * 1000).toISOString();
  const rawRemindAtEarly = input.remindAt !== undefined ? String(input.remindAt ?? "").trim() : "";
  try {
    const orphanLookup = await inboxRepository.findRecentOrphanTaskId(actor, {
      title: effectiveTitle,
      projectId: effectiveProjectId,
      sinceIso,
    });
    if (orphanLookup.ok && orphanLookup.value) {
      const orphanId = orphanLookup.value;
      const linkOrphan = await inboxRepository.createInboxTaskLink(actor, {
        inboxItemId,
        taskId: orphanId,
      });
      if (linkOrphan.ok) {
        const taskResult = await tasksRepository.getTask(actor, orphanId);
        if (taskResult.ok && taskResult.value) {
          let reconciledTask = taskResult.value;
          // Handle reminder for reconciled orphan if requested (same validation as fresh path)
          if (rawRemindAtEarly) {
            const remindDate = new Date(rawRemindAtEarly);
            if (!Number.isNaN(remindDate.getTime()) && remindDate.getTime() > nowForOrphan.getTime()) {
              const reminderResult = await tasksRepository.createReminder(actor, {
                taskId: orphanId,
                remindAt: remindDate.toISOString(),
                channel: "email",
                status: "pending",
              });
              if (reminderResult.ok) {
                reconciledTask = reminderResult.value;
              } else {
                // If reminder creation fails, still mark converted with original orphan task
                // Caller will get failure on reminder but orphan is already linked to prevent duplicate
                // For now, treat as failure to keep contract consistent with fresh path
                return applicationFailure("Unable to create reminder right now.");
              }
            } else if (Number.isNaN(remindDate.getTime())) {
              return applicationFailure("Reminder time is invalid.");
            } else if (remindDate.getTime() <= nowForOrphan.getTime()) {
              return applicationFailure("Reminder time must be in the future.");
            }
          }
          const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
          if (markResult.ok) {
            return applicationSuccess({ inboxItem: markResult.value, task: reconciledTask });
          }
          return applicationSuccess({ inboxItem, task: reconciledTask });
        }
      } else {
        const isOrphanConflict = (linkOrphan.error as any)?.code === "conflict";
        if (isOrphanConflict) {
          const existingTaskIdResult = await inboxRepository.getTaskIdForInboxItem(actor, inboxItemId);
          if (existingTaskIdResult.ok && existingTaskIdResult.value) {
            const existingTaskResult = await tasksRepository.getTask(actor, existingTaskIdResult.value);
            if (existingTaskResult.ok && existingTaskResult.value) {
              const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
              if (markResult.ok) {
                return applicationSuccess({ inboxItem: markResult.value, task: existingTaskResult.value });
              }
              return applicationSuccess({ inboxItem, task: existingTaskResult.value });
            }
          }
          return applicationFailure("Idea is already converted.");
        }
        // Non-conflict orphan link failure -> fall through to fresh creation
      }
    }
  } catch {
    // Best-effort reconciliation; ignore errors and proceed to fresh creation
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
    // Attempt to see if link now exists (maybe transient)
    const retryLink = await inboxRepository.getTaskIdForInboxItem(actor, inboxItemId);
    if (retryLink.ok && retryLink.value) {
      const taskRetry = await tasksRepository.getTask(actor, retryLink.value);
      if (taskRetry.ok && taskRetry.value) {
        const markRetry = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
        if (markRetry.ok) return applicationSuccess({ inboxItem: markRetry.value, task: taskRetry.value });
        return applicationSuccess({ inboxItem, task: taskRetry.value });
      }
    }
    // Orphan reconciliation after link failure: look for a different recent unlinked task
    // that could be the orphan from this or a previous attempt. The pre-creation check
    // on the next retry will handle the common case, but we also try here to
    // avoid leaving an additional orphan when a prior orphan exists alongside
    // the just-created task.
    try {
      const orphanAfter = await inboxRepository.findRecentOrphanTaskId(actor, {
        title: effectiveTitle,
        projectId: effectiveProjectId,
        sinceIso,
      });
      if (orphanAfter.ok && orphanAfter.value && orphanAfter.value !== createdTask.id) {
        const orphanId2 = orphanAfter.value;
        const linkOrphan2 = await inboxRepository.createInboxTaskLink(actor, {
          inboxItemId,
          taskId: orphanId2,
        });
        if (linkOrphan2.ok) {
          const taskOrphan2 = await tasksRepository.getTask(actor, orphanId2);
          if (taskOrphan2.ok && taskOrphan2.value) {
            let reconciled2 = taskOrphan2.value;
            if (rawRemindAtEarly) {
              const remindDate2 = new Date(rawRemindAtEarly);
              if (!Number.isNaN(remindDate2.getTime()) && remindDate2.getTime() > nowForOrphan.getTime()) {
                const rem2 = await tasksRepository.createReminder(actor, {
                  taskId: orphanId2,
                  remindAt: remindDate2.toISOString(),
                  channel: "email",
                  status: "pending",
                });
                if (rem2.ok) reconciled2 = rem2.value;
              }
            }
            const mark2 = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
            if (mark2.ok) return applicationSuccess({ inboxItem: mark2.value, task: reconciled2 });
            return applicationSuccess({ inboxItem, task: reconciled2 });
          }
        }
      }
    } catch {
      // ignore orphan lookup errors
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
