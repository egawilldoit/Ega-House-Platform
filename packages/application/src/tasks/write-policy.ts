import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  TASK_TITLE_LENGTH_ERROR,
  TASK_TITLE_MAX,
  getLocalTodayIsoDate,
  isTaskPriority,
  isTaskStatus,
  normalizeCalendarReminderMinutes,
  normalizeTaskDueDateInput,
  normalizeTaskEstimateInput,
  normalizeTaskPlannedDateInput,
  normalizeTaskRecurrenceScheduleInput,
  normalizeTaskScheduleInput,
  normalizeTaskStartDateInput,
  type TaskPriority,
  type TaskRecurrenceRule,
  type TaskStatus,
} from "@ega/domain";

export type ValidateTaskInlineUpdateInput = {
  taskId: string;
  title?: unknown;
  projectId?: unknown;
  goalId?: unknown;
  description?: unknown;
  status: string;
  priority: string;
  startDate?: unknown;
  dueDate: unknown;
  plannedForDate?: unknown;
  estimateMinutes: unknown;
  blockedReason: unknown;
  recurrenceRule?: unknown;
  recurrenceAnchorDate?: unknown;
  recurrenceTimezone?: unknown;
  scheduledStartAt?: unknown;
  scheduledEndAt?: unknown;
  /**
   * Canonical account IANA timezone used to interpret scheduled wall times.
   * Supplied by the server action from the owner's persisted Time Context —
   * never a numeric browser offset.
   */
  accountTimezone?: string;
  /**
   * Canonical account local date (YYYY-MM-DD) from the owner's Time Context.
   * Used as the recurrence anchor fallback instead of the runtime-local date
   * so web writes agree with the Hono transport near account midnight.
   */
  fallbackAnchorDate?: string;
  calendarSyncEnabled?: unknown;
  calendarReminderMinutes?: unknown;
};

export type ValidatedTaskInlineUpdateInput = {
  taskId: string;
  title?: string;
  projectId?: string;
  goalId?: string | null;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate?: string | null;
  dueDate: string | null;
  plannedForDate?: string | null;
  estimateMinutes: number | null;
  blockedReason: string | null;
  recurrenceRule?: TaskRecurrenceRule | null;
  recurrenceAnchorDate?: string | null;
  recurrenceTimezone?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  calendarSyncEnabled?: boolean;
  calendarReminderMinutes?: number;
};

export function normalizeTaskBlockedReasonInput(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function getTaskBlockedReasonValidationError(
  status: TaskStatus,
  blockedReason: string | null,
) {
  if (status === "blocked" && !blockedReason) {
    return "Blocked reason is required when status is Blocked.";
  }

  return null;
}

/**
 * Canonical inline task-edit validation. Web actions and the field-patch path
 * both call this; Hono/MCP express the same rules through the task use cases in
 * `./service`, so a rejected field edit has one authority per transport family.
 */
export function validateTaskInlineUpdateInput(input: ValidateTaskInlineUpdateInput) {
  const taskId = input.taskId.trim();
  const title = input.title === undefined ? undefined : String(input.title ?? "").trim();
  const projectId =
    input.projectId === undefined ? undefined : String(input.projectId ?? "").trim();
  const goalId =
    input.goalId === undefined ? undefined : String(input.goalId ?? "").trim() || null;
  const description =
    input.description === undefined
      ? undefined
      : String(input.description ?? "").trim() || null;
  const status = input.status.trim();
  const priority = input.priority.trim();
  const startDateResult =
    input.startDate === undefined
      ? { value: undefined, error: null }
      : normalizeTaskStartDateInput(input.startDate);
  const dueDateResult = normalizeTaskDueDateInput(input.dueDate);
  const plannedForDateResult =
    input.plannedForDate === undefined
      ? { value: undefined as string | null | undefined, error: null as string | null }
      : normalizeTaskPlannedDateInput(input.plannedForDate);
  const estimateResult = normalizeTaskEstimateInput(input.estimateMinutes);
  const blockedReason = normalizeTaskBlockedReasonInput(input.blockedReason);
  const recurrenceRuleResult =
    input.recurrenceRule === undefined
      ? { errorMessage: null, schedule: undefined }
      : normalizeTaskRecurrenceScheduleInput({
          rule: input.recurrenceRule,
          anchorDate: input.recurrenceAnchorDate,
          timezone: input.recurrenceTimezone,
          defaultTimezone: input.accountTimezone,
          fallbackAnchorDate:
            dueDateResult.value ?? input.fallbackAnchorDate ?? getLocalTodayIsoDate(),
        });
  const hasScheduleFields =
    input.scheduledStartAt !== undefined || input.scheduledEndAt !== undefined;
  const hasCalendarFields =
    input.calendarSyncEnabled !== undefined || input.calendarReminderMinutes !== undefined;
  const scheduleResult = hasScheduleFields
    ? normalizeTaskScheduleInput({
        scheduledStartAt: input.scheduledStartAt ?? "",
        scheduledEndAt: input.scheduledEndAt ?? "",
        timezone: input.accountTimezone ?? "UTC",
      })
    : null;

  if (!taskId) {
    return {
      errorMessage: "Task update request is invalid.",
    };
  }

  if (title !== undefined && !title) {
    return {
      errorMessage: "Task title is required.",
    };
  }

  if (title !== undefined && title.length > TASK_TITLE_MAX) {
    return { errorMessage: TASK_TITLE_LENGTH_ERROR };
  }

  if (projectId !== undefined && !projectId) {
    return {
      errorMessage: "Project is required.",
    };
  }

  if (!isTaskStatus(status)) {
    return {
      errorMessage: `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.`,
    };
  }

  if (!isTaskPriority(priority)) {
    return {
      errorMessage: `Priority must be one of: ${TASK_PRIORITY_VALUES.join(", ")}.`,
    };
  }

  if (startDateResult.error) {
    return {
      errorMessage: startDateResult.error,
    };
  }

  if (dueDateResult.error) {
    return {
      errorMessage: dueDateResult.error,
    };
  }

  if (startDateResult.value && dueDateResult.value && dueDateResult.value < startDateResult.value) {
    return {
      errorMessage: "Due date cannot be before the start date.",
    };
  }

  if (plannedForDateResult.error) {
    return {
      errorMessage: plannedForDateResult.error,
    };
  }

  if (estimateResult.error) {
    return {
      errorMessage: estimateResult.error,
    };
  }

  if (recurrenceRuleResult.errorMessage) {
    return {
      errorMessage: recurrenceRuleResult.errorMessage,
    };
  }

  if (scheduleResult?.error) {
    return {
      errorMessage: scheduleResult.error,
    };
  }

  const blockedReasonError = getTaskBlockedReasonValidationError(status, blockedReason);
  if (blockedReasonError) {
    return {
      errorMessage: blockedReasonError,
    };
  }

  const normalizedBlockedReason = status === "blocked" ? blockedReason : null;

  return {
    errorMessage: null,
    data: {
      taskId,
      ...(title === undefined ? {} : { title }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(goalId === undefined ? {} : { goalId }),
      ...(description === undefined ? {} : { description }),
      status,
      priority,
      ...(startDateResult.value === undefined ? {} : { startDate: startDateResult.value }),
      dueDate: dueDateResult.value,
      ...(plannedForDateResult.value === undefined
        ? {}
        : { plannedForDate: plannedForDateResult.value }),
      estimateMinutes: estimateResult.value,
      blockedReason: normalizedBlockedReason,
      ...(scheduleResult
        ? {
            scheduledStartAt: scheduleResult.scheduledStartAtIso,
            scheduledEndAt: scheduleResult.scheduledEndAtIso,
          }
        : {}),
      ...(hasCalendarFields
        ? {
            calendarSyncEnabled: input.calendarSyncEnabled === "on",
            calendarReminderMinutes: normalizeCalendarReminderMinutes(
              input.calendarReminderMinutes,
            ),
          }
        : {}),
      ...(input.recurrenceRule === undefined
        ? {}
        : {
            recurrenceRule: recurrenceRuleResult.schedule?.rule ?? null,
            recurrenceAnchorDate: recurrenceRuleResult.schedule?.anchorDate ?? null,
            recurrenceTimezone: recurrenceRuleResult.schedule?.timezone ?? null,
          }),
    } satisfies ValidatedTaskInlineUpdateInput,
  };
}
