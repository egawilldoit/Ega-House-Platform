import { createHash } from "node:crypto";

import { isTaskPriority } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TasksRepository } from "../tasks/ports";
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



/**
 * Deterministic task id for inbox conversion.
 * Uses owner + inboxItemId as stable correlation key so retries always resolve to same Task,
 * never heuristic title matching. This implements Option A (preallocated exact Task ID) in
 * the smallest compatible form: hash(inboxItemId:ownerUserId) -> UUID.
 *
 * Why deterministic ID vs heuristic?
 * - Heuristic (title+project+5min) is unsafe: an unrelated task with same title/project created
 *   within window would be incorrectly adopted, leaking data across intents and causing flaky
 *   concurrent behavior. Deterministic ID guarantees exact correlation: only the task that was
 *   created for this inbox item (or will be created) is ever reused.
 * - Using task_external_refs as the correlation ensures owner-scoped, single-link idempotency.
 *   The deterministic task id makes task creation itself idempotent: duplicate create with same
 *   id returns 23505, allowing retry to fetch the orphaned task and link it deterministically.
 * - No new table needed; task PK uniqueness provides the guard. Transactional alternative would
 *   require an RPC; deterministic ID avoids orphan heuristic entirely.
 */
export function deterministicTaskIdForInboxConversion(
  actor: AuthenticatedActor,
  inboxItemId: string,
): string {
  const input = `${actor.userId}:${String(inboxItemId).trim()}:inbox-conversion`;
  const hash = createHash("sha256").update(input).digest("hex");
  // Format as UUID v4-like: 8-4-4-4-12 from hash
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
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
      const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
      if (!markResult.ok) {
        return applicationSuccess({ inboxItem, task: taskResult.value });
      }
      return applicationSuccess({ inboxItem: markResult.value, task: taskResult.value });
    }
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

  // 5. Deterministic conversion correlation: preallocate exact Task ID
  // This replaces the unsafe findRecentOrphanTaskId heuristic. Retries always resolve to same
  // deterministic task, never a same-looking unrelated task. Concurrent converts serialize via
  // primary key uniqueness on tasks.id and unique index on task_external_refs.
  const deterministicTaskId = deterministicTaskIdForInboxConversion(actor, inboxItemId);
  const nowForRemind = options?.now ?? new Date();
  const rawRemindAtEarly = input.remindAt !== undefined ? String(input.remindAt ?? "").trim() : "";

  // If a prior attempt created the deterministic task but failed to link, we can recover by
  // checking if that task already exists before creating.
  const existingDeterministicTask = await tasksRepository.getTask(actor, deterministicTaskId);
  if (existingDeterministicTask.ok && existingDeterministicTask.value) {
    // Task with deterministic id already exists - try to link it
    const linkExisting = await inboxRepository.createInboxTaskLink(actor, {
      inboxItemId,
      taskId: deterministicTaskId,
    });
    if (linkExisting.ok) {
      let reconciledTask = existingDeterministicTask.value;
      if (rawRemindAtEarly) {
        const remindDate = new Date(rawRemindAtEarly);
        if (!Number.isNaN(remindDate.getTime()) && remindDate.getTime() > nowForRemind.getTime()) {
          const reminderResult = await tasksRepository.createReminder(actor, {
            taskId: deterministicTaskId,
            remindAt: remindDate.toISOString(),
            channel: "email",
            status: "pending",
          });
          if (reminderResult.ok) {
            reconciledTask = reminderResult.value;
          } else {
            return applicationFailure("Unable to create reminder right now.");
          }
        } else if (Number.isNaN(remindDate.getTime())) {
          return applicationFailure("Reminder time is invalid.");
        } else if (remindDate.getTime() <= nowForRemind.getTime()) {
          return applicationFailure("Reminder time must be in the future.");
        }
      }
      const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
      if (markResult.ok) {
        return applicationSuccess({ inboxItem: markResult.value, task: reconciledTask });
      }
      return applicationSuccess({ inboxItem, task: reconciledTask });
    }
    const isConflict = (linkExisting.error as { code?: string })?.code === "conflict";
    if (isConflict) {
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
    // Non-conflict link failure -> fall through to try to create? But task already exists, so we should not create new.
    // Instead treat as failure and let caller retry (which will hit the same deterministic task again)
    // For now, try to proceed to link retry logic below
  } else if (!existingDeterministicTask.ok) {
    return applicationFailure("Unable to load task right now.");
  }

  // 5b. Create task with deterministic ID via canonical use case (reuse)
  // We bypass createTask wrapper for id injection and call repository directly to preserve deterministic id,
  // but still need same validation as createTask. Since we already validated scope etc., we can call repository directly.
  // However to reuse canonical validation, we construct the input and use repository.createTask with id.
  const taskCreateResult = await tasksRepository.createTask(actor, {
    id: deterministicTaskId,
    title: effectiveTitle,
    projectId: effectiveProjectId,
    goalId: effectiveGoalId,
    description: effectiveDescription,
    blockedReason: null,
    status: "todo",
    priority: effectivePriority as unknown as import("../tasks/ports").TaskRecord["priority"],
    dueDate: effectiveDueDate,
    estimateMinutes: null,
  });

  let createdTask: import("../tasks/ports").TaskRecord;
  if (!taskCreateResult.ok) {
    const err = taskCreateResult.error as { code?: string; message?: string };
    const isDuplicate =
      String(err?.code ?? "").includes("23505") ||
      /duplicate|unique|already exists/i.test(String(err?.message ?? ""));
    if (isDuplicate) {
      const existingTaskResult = await tasksRepository.getTask(actor, deterministicTaskId);
      if (existingTaskResult.ok && existingTaskResult.value) {
        createdTask = existingTaskResult.value;
      } else if (!existingTaskResult.ok) {
        return applicationFailure("Unable to load task right now.");
      } else {
        return applicationFailure("Unable to create task right now.");
      }
    } else {
      return applicationFailure("Unable to create task right now.");
    }
  } else {
    createdTask = taskCreateResult.value;
  }

  // 6. Persist conversion link before marking converted (durability)
  const linkResult = await inboxRepository.createInboxTaskLink(actor, {
    inboxItemId,
    taskId: createdTask.id,
  });

  if (!linkResult.ok) {
    const isConflict = (linkResult.error as { code?: string })?.code === "conflict";
    if (isConflict) {
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
    const refreshed = reminderResult.value;
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
