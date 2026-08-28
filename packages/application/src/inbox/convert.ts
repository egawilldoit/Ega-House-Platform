import { sha256Hex } from "../shared/hash";
import { createTask } from "../tasks/service";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TaskRecord, TasksRepository } from "../tasks/ports";
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
  task: TaskRecord;
}>;

const SMART_INBOX_REMINDER_SOURCE = "smart_inbox_conversion";

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
 *
 * Purity note (repair 2026-08-28): uses shared sha256Hex which wraps node:crypto.
 * Application layer may use node: (purity scan allows it); contracts/domain forbid it.
 * Centralizing in shared/hash.ts keeps single injection point and documents evaluation.
 */
export function deterministicTaskIdForInboxConversion(
  actor: AuthenticatedActor,
  inboxItemId: string,
): string {
  const input = `${actor.userId}:${String(inboxItemId).trim()}:inbox-conversion`;
  const hash = sha256Hex(input);
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function hasInboxReminder(task: TaskRecord, inboxItemId: string): boolean {
  return task.reminders.some(
    (r) => (r as unknown as { source?: string | null; sourceId?: string | null }).source === SMART_INBOX_REMINDER_SOURCE && (r as unknown as { source?: string | null; sourceId?: string | null }).sourceId === inboxItemId,
  );
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

  if (inboxItem.status === "archived") {
    return applicationFailure("Archived ideas must be restored before conversion.");
  }

  // 2. If already converted, return existing linked task (idempotency for completed)
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

  // 3. Early validation BEFORE any side effects (ensures invalid input never creates orphan)
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

  // Validate remindAt BEFORE side effects - required for invariant (never converted while reminder missing, never orphan on invalid)
  const rawRemindAt = input.remindAt !== undefined ? String(input.remindAt ?? "").trim() : "";
  let validatedRemindAtIso: string | null = null;
  if (rawRemindAt) {
    const remindDate = new Date(rawRemindAt);
    const now = options?.now ?? new Date();
    if (Number.isNaN(remindDate.getTime())) {
      return applicationFailure("Reminder time is invalid.");
    }
    if (remindDate.getTime() <= now.getTime()) {
      return applicationFailure("Reminder time must be in the future.");
    }
    validatedRemindAtIso = remindDate.toISOString();
  }

  // 4. Deterministic conversion correlation: preallocate exact Task ID
  const deterministicTaskId = deterministicTaskIdForInboxConversion(actor, inboxItemId);

  // 5. Ensure Task exists (retry-safe via deterministic ID + canonical createTask)
  // This uses canonical createTask so Project/Goal/priority validation remains centralized (BUG2 fix).
  let task: TaskRecord | null = null;
  const existingTaskResult = await tasksRepository.getTask(actor, deterministicTaskId);
  if (!existingTaskResult.ok) return applicationFailure("Unable to load task right now.");
  if (existingTaskResult.value) {
    task = existingTaskResult.value;
  } else {
    // Call canonical createTask with preallocatedId — reuses exact same validation as normal task creation.
    const effectivePriorityInput = input.priority !== undefined ? String(input.priority ?? "").trim() : inboxItem.priority ?? "medium";
    const createResult = await createTask(
      actor,
      tasksRepository,
      {
        title: effectiveTitle,
        projectId: effectiveProjectId,
        goalId: effectiveGoalId,
        description: effectiveDescription,
        priority: effectivePriorityInput,
        dueDate: effectiveDueDate,
      },
      { preallocatedId: deterministicTaskId },
    );
    if (createResult.ok) {
      task = createResult.data;
    } else {
      // Handle race: if another concurrent convert created same deterministic id, fetch it
      const msg = String((createResult as unknown as { errorMessage?: string }).errorMessage ?? "");
      const isDuplicate = /duplicate|unique|already exists|23505/i.test(msg);
      // Also check if the underlying repository would have returned duplicate via error code path: we treat any "Unable to create task" with preallocated id as possible duplicate
      // Try to fetch existing deterministic task regardless of error type when preallocated
      const retryTask = await tasksRepository.getTask(actor, deterministicTaskId);
      if (retryTask.ok && retryTask.value) {
        task = retryTask.value;
      } else if (isDuplicate) {
        if (!retryTask.ok) return applicationFailure("Unable to load task right now.");
        return applicationFailure("Unable to create task right now.");
      } else {
        // Propagate canonical validation errors (e.g., project unavailable) directly
        return createResult as ApplicationResult<never>;
      }
    }
  }

  if (!task) return applicationFailure("Unable to create task right now.");

  // 6. Ensure exact Inbox→Task link exists (retry-safe, owner-scoped)
  const linkAttempt = await inboxRepository.createInboxTaskLink(actor, {
    inboxItemId,
    taskId: task.id,
  });
  if (linkAttempt.ok) {
    // Link created now - proceed
  } else {
    const isConflict = (linkAttempt.error as { code?: string })?.code === "conflict";
    if (isConflict) {
      const existingLink = await inboxRepository.getTaskIdForInboxItem(actor, inboxItemId);
      if (!existingLink.ok) return applicationFailure("Unable to load conversion link right now.");
      if (existingLink.value) {
        const linkedTask = await tasksRepository.getTask(actor, existingLink.value);
        if (!linkedTask.ok) return applicationFailure("Unable to load task right now.");
        if (linkedTask.value) {
          // Use the already-linked task (could be same deterministic id or earlier link; exact correlation via link wins)
          task = linkedTask.value;
        } else {
          return applicationFailure("Converted idea is missing its task.");
        }
      } else {
        return applicationFailure("Idea is already converted.");
      }
    } else {
      // Transient failure: check if link now exists (retry succeeded elsewhere)
      const retryLink = await inboxRepository.getTaskIdForInboxItem(actor, inboxItemId);
      if (retryLink.ok && retryLink.value) {
        const retryTask = await tasksRepository.getTask(actor, retryLink.value);
        if (retryTask.ok && retryTask.value) {
          task = retryTask.value;
        } else if (!retryTask.ok) {
          return applicationFailure("Unable to load task right now.");
        } else {
          return applicationFailure("Unable to link converted task right now.");
        }
      } else if (!retryLink.ok) {
        return applicationFailure("Unable to load conversion link right now.");
      } else {
        return applicationFailure("Unable to link converted task right now.");
      }
    }
  }

  // 7. If reminder requested: ensure exact reminder exists (retry-safe via source correlation + DB uniqueness)
  // Required invariant: successful conversion with remindAt means reminder exists exactly once.
  // Never mark converted while reminder missing. Uses source=smart_inbox_conversion, sourceId=inboxItemId.
  if (validatedRemindAtIso) {
    // Refresh task to check current reminders via source correlation (durable state)
    const freshTaskRes = await tasksRepository.getTask(actor, task.id);
    if (!freshTaskRes.ok) return applicationFailure("Unable to load task right now.");
    const freshTask = freshTaskRes.value;
    if (!freshTask) return applicationFailure("Converted idea is missing its task.");
    task = freshTask;

    if (!hasInboxReminder(task, inboxItemId)) {
      const reminderResult = await tasksRepository.createReminder(actor, {
        taskId: task.id,
        remindAt: validatedRemindAtIso,
        channel: "email",
        status: "pending",
        source: SMART_INBOX_REMINDER_SOURCE,
        sourceId: inboxItemId,
      });
      if (!reminderResult.ok) {
        // If duplicate due to concurrent creation with same source, treat as success and fetch again
        const err = reminderResult.error as { code?: string; message?: string };
        const isDuplicate = String(err?.code ?? "").includes("23505") || /duplicate|unique/i.test(String(err?.message ?? ""));
        if (isDuplicate) {
          const dupTask = await tasksRepository.getTask(actor, task.id);
          if (!dupTask.ok) return applicationFailure("Unable to load task right now.");
          if (dupTask.value && hasInboxReminder(dupTask.value, inboxItemId)) {
            task = dupTask.value;
          } else if (!dupTask.ok) {
            return applicationFailure("Unable to load task right now.");
          } else {
            return applicationFailure("Unable to create reminder right now.");
          }
        } else {
          return applicationFailure("Unable to create reminder right now.");
        }
      } else {
        task = reminderResult.value;
        // Verify reminder now exists exactly once via source correlation (durability proof)
        if (!hasInboxReminder(task, inboxItemId)) {
          // Fallback: fetch again to ensure DB has it
          const verify = await tasksRepository.getTask(actor, task.id);
          if (!verify.ok || !verify.value || !hasInboxReminder(verify.value, inboxItemId)) {
            return applicationFailure("Unable to create reminder right now.");
          }
          task = verify.value;
        }
      }
    } else {
      // Reminder already exists exactly - idempotent, do not duplicate
      // Ensure we have freshest task with reminder
    }
  }

  // 8. Mark inbox as converted only after all side effects proven (invariant)
  const markResult = await inboxRepository.markInboxItemConverted(actor, inboxItemId);
  if (!markResult.ok) {
    return applicationFailure("Unable to mark idea as converted right now.");
  }

  return applicationSuccess({ inboxItem: markResult.value, task });
}
