"use server";

import { TASK_TITLE_MAX, TASK_TITLE_LENGTH_ERROR } from "@/lib/task-domain";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { after } from "next/server";
import { normalizeManualWorkedTimeInput } from "@/lib/manual-worked-time";
import { normalizeTaskDueDateInput } from "@/lib/task-due-date";
import { normalizeTaskEstimateInput } from "@/lib/task-estimate";
import { normalizeTaskRecurrenceRuleInput } from "@/lib/task-recurrence";
import { normalizeTaskScheduleInput } from "@/lib/task-schedule";
import { normalizeCalendarReminderMinutes } from "@/lib/services/calendar-settings-service";
import { processPendingCalendarSyncJobs } from "@/lib/services/calendar-sync-service";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  isTaskPriority,
  isTaskStatus,
} from "@/lib/task-domain";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  cancelTaskReminder,
  createTaskEmailReminder,
  createTaskWithOptionalWorkedTime,
  createTasks,
  deleteTaskSafely,
  getTaskInsertScopeError,
  getTaskScopeSnapshot,
  normalizeTaskBlockedReasonInput,
  unarchiveTask,
  updateTaskEmailReminder,
  updateTaskInline,
  validateTaskInlineUpdateInput,
} from "@/lib/services/task-service";
import { archiveCompletedTasksSafely, archiveTaskSafely } from "@/lib/services/task-transition-service";
import {
  pinTaskInFocusQueue,
  unpinTaskInFocusQueue,
} from "@/lib/services/focus-queue-service";
import { updateTaskFieldForOwner } from "@/lib/services/task-service";
import {
  isTaskTableCellEditableField,
  type TaskTableCellEditableField,
} from "@/lib/task-table-columns";
import type { TaskFieldDraftState } from "@/lib/task-field-draft";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

/**
 * Resolve the owner's effective IANA timezone and canonical local date for
 * wall-time interpretation and recurrence anchor fallbacks.
 * Never fabricates a timezone: data-access failure returns an explicit error
 * so the caller can surface the degraded state instead of guessing.
 */
async function resolveAccountTimezone(): Promise<{
  timezone: string | null;
  localDate: string | null;
  error: string | null;
}> {
  try {
    const context = await getWebTimeContext();
    return { timezone: context.timezone, localDate: context.localDate, error: null };
  } catch {
    return {
      timezone: null,
      localDate: null,
      error: "Unable to load the account timezone right now.",
    };
  }
}

export type CreateTaskFormState = {
  error: string | null;
  titleError?: string;
  success?: string | null;
  values: {
    title: string;
    projectId: string;
    goalId: string;
    description: string;
    blockedReason: string;
    status: string;
    priority: string;
    dueDate: string;
    estimateMinutes: string;
    recurrenceRule: string;
    recurrenceTimezone: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    calendarSyncEnabled: string;
    calendarReminderMinutes: string;
    workedTimeStartedAt: string;
    workedTimeEndedAt: string;
    returnTo: string;
  };
};

export type CreateTasksBulkFormState = {
  error: string | null;
  success: string | null;
  createdCount: number;
  skippedLines: Array<{ value: string; reason: string }>;
  values: {
    titles: string;
    projectId: string;
    goalId: string;
    description: string;
    blockedReason: string;
    status: string;
    priority: string;
    dueDate: string;
    estimateMinutes: string;
    returnTo: string;
  };
};

type BulkTaskComposerRowInput = {
  lineNumber?: number;
  title?: string;
  projectId?: string;
  goalId?: string;
  description?: string;
  blockedReason?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  estimateMinutes?: string;
};

function createErrorState(
  error: string,
  values: CreateTaskFormState["values"],
): CreateTaskFormState {
  return { error, success: null, values, ...(error === TASK_TITLE_LENGTH_ERROR || error === "Task title is required." ? { titleError: error } : {}) };
}

function createBulkErrorState(
  error: string,
  values: CreateTasksBulkFormState["values"],
  skippedLines: CreateTasksBulkFormState["skippedLines"] = [],
): CreateTasksBulkFormState {
  return {
    error,
    success: null,
    createdCount: 0,
    skippedLines,
    values,
  };
}

const TASK_SURFACE_PREFIXES = ["/tasks", "/today", "/dashboard"] as const;

/**
 * Only in-app task surfaces can be redirect targets. `//host` and absolute URLs
 * are rejected so a submitted `returnTo` can never become an open redirect.
 */
function isTaskSurfacePath(pathname: string): boolean {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return false;
  return TASK_SURFACE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function getTasksReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  if (!returnTo.startsWith("/")) return "/tasks";
  const pathname = returnTo.split("?")[0] ?? "";
  return isTaskSurfacePath(pathname) ? returnTo : "/tasks";
}

function getTaskSurfaceReturnPath(rawReturnTo: unknown) {
  return getTasksReturnPath(rawReturnTo);
}

function redirectWithTasksError(
  returnPath: string,
  errorMessage: string,
  taskId?: string,
): never {
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: taskId ? `task-${taskId}` : undefined,
    taskErrorMessage: errorMessage,
    taskId,
  });
}

function redirectWithTaskSurfaceError(
  returnPath: string,
  errorMessage: string,
  taskId?: string,
): never {
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: returnPath.startsWith("/tasks") && taskId ? `task-${taskId}` : undefined,
    taskErrorMessage: errorMessage,
    taskId,
  });
}

function drainCalendarSyncQueueAfterResponse(shouldDrain: boolean) {
  if (!shouldDrain) {
    return;
  }

  after(async () => {
    try {
      await processPendingCalendarSyncJobs({
        supabase: getSupabaseServiceClient(),
        limit: 5,
      });
    } catch {
      // Cron remains the reliable retry path if this opportunistic drain fails.
    }
  });
}

function parseBulkRowsPayload(rawRows: string): BulkTaskComposerRowInput[] {
  if (!rawRows.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawRows);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toTaskInsertRow(row: BulkTaskComposerRowInput) {
  const status = String(row.status ?? "").trim();
  const blockedReason = normalizeTaskBlockedReasonInput(row.blockedReason);

  return {
    title: String(row.title ?? "").trim(),
    project_id: String(row.projectId ?? "").trim(),
    goal_id: String(row.goalId ?? "").trim() || null,
    description: String(row.description ?? "").trim() || null,
    blocked_reason: status === "blocked" ? blockedReason : null,
    status,
    priority: String(row.priority ?? "").trim(),
    due_date: String(row.dueDate ?? "").trim() || null,
    estimate_minutes: normalizeTaskEstimateInput(row.estimateMinutes).value,
  } satisfies TablesInsert<"tasks">;
}

export async function createTaskAction(
  _previous: CreateTaskFormState,
  formData: FormData,
): Promise<CreateTaskFormState> {
  const title = String(formData.get("title") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const goalId = String(formData.get("goalId") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const blockedReason = normalizeTaskBlockedReasonInput(formData.get("blockedReason"));
  const status = String(formData.get("status") ?? "todo").trim();
  const priority = String(formData.get("priority") ?? "medium").trim();
  const rawDueDate = String(formData.get("dueDate") ?? "").trim();
  const rawEstimateMinutes = String(formData.get("estimateMinutes") ?? "").trim();
  const rawRecurrenceRule = String(formData.get("recurrenceRule") ?? "").trim();
  const recurrenceTimezone = String(formData.get("recurrenceTimezone") ?? "").trim();
  const workedTimeStartedAt = String(formData.get("workedTimeStartedAt") ?? "").trim();
  const workedTimeEndedAt = String(formData.get("workedTimeEndedAt") ?? "").trim();
  const scheduledStartAt = String(formData.get("scheduledStartAt") ?? "").trim();
  const scheduledEndAt = String(formData.get("scheduledEndAt") ?? "").trim();
  const calendarSyncEnabled = formData.get("calendarSyncEnabled") === "on";
  const rawCalendarReminderMinutes = String(
    formData.get("calendarReminderMinutes") ?? "10",
  ).trim();
  const returnTo = getTasksReturnPath(formData.get("returnTo"));
  const accountTimezoneResult = await resolveAccountTimezone();
  const dueDateResult = normalizeTaskDueDateInput(rawDueDate);
  const estimateResult = normalizeTaskEstimateInput(rawEstimateMinutes);
  const recurrenceResult = normalizeTaskRecurrenceRuleInput(rawRecurrenceRule);
  const scheduleResult = normalizeTaskScheduleInput({
    scheduledStartAt,
    scheduledEndAt,
    timezone: accountTimezoneResult.timezone ?? undefined,
  });
  const workedTimeResult = normalizeManualWorkedTimeInput({
    startedAt: workedTimeStartedAt,
    endedAt: workedTimeEndedAt,
    timezone: accountTimezoneResult.timezone ?? undefined,
  });

  const values = {
    title,
    projectId,
    goalId,
    description,
    blockedReason: blockedReason ?? "",
    status,
    priority,
    dueDate: rawDueDate,
    estimateMinutes: rawEstimateMinutes,
    recurrenceRule: rawRecurrenceRule,
    recurrenceTimezone,
    scheduledStartAt,
    scheduledEndAt,
    calendarSyncEnabled: calendarSyncEnabled ? "on" : "",
    calendarReminderMinutes: rawCalendarReminderMinutes,
    workedTimeStartedAt,
    workedTimeEndedAt,
    returnTo,
  };

  if (accountTimezoneResult.error || !accountTimezoneResult.timezone) {
    return createErrorState(
      accountTimezoneResult.error ?? "Unable to load the account timezone right now.",
      values,
    );
  }

  if (!title) {
    return createErrorState("Task title is required.", values);
  }

  if (title.length > TASK_TITLE_MAX) {
    return createErrorState(TASK_TITLE_LENGTH_ERROR, values);
  }

  if (!projectId) {
    return createErrorState("Project is required.", values);
  }

  if (!isTaskStatus(status)) {
    return createErrorState(
      `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.`,
      values,
    );
  }

  if (!isTaskPriority(priority)) {
    return createErrorState(
      `Priority must be one of: ${TASK_PRIORITY_VALUES.join(", ")}.`,
      values,
    );
  }

  if (status === "blocked" && !blockedReason) {
    return createErrorState("Blocked reason is required when status is Blocked.", values);
  }

  if (dueDateResult.error) {
    return createErrorState(dueDateResult.error, values);
  }

  if (estimateResult.error) {
    return createErrorState(estimateResult.error, values);
  }

  if (recurrenceResult.errorMessage) {
    return createErrorState(recurrenceResult.errorMessage, values);
  }

  if (scheduleResult.error) {
    return createErrorState(scheduleResult.error, values);
  }

  if (workedTimeResult.error) {
    return createErrorState(workedTimeResult.error, values);
  }

  const createResult = await createTaskWithOptionalWorkedTime({
    task: {
      title,
      project_id: projectId,
      goal_id: goalId || null,
      description: description || null,
      blocked_reason: status === "blocked" ? blockedReason : null,
      status,
      priority,
      due_date: dueDateResult.value,
      estimate_minutes: estimateResult.value,
      scheduled_start_at: scheduleResult.scheduledStartAtIso,
      scheduled_end_at: scheduleResult.scheduledEndAtIso,
      calendar_sync_enabled: calendarSyncEnabled,
      calendar_reminder_minutes: normalizeCalendarReminderMinutes(
        rawCalendarReminderMinutes,
      ),
    },
    workedTime: workedTimeResult.payload,
    recurrenceRule: recurrenceResult.rule,
    recurrenceTimezone,
  }, {
    recurrenceDefaultTimezone: accountTimezoneResult.timezone,
    fallbackAnchorDate: accountTimezoneResult.localDate ?? undefined,
  });

  if (createResult.errorMessage) {
    if (createResult.createdTaskId) {
      revalidateWorkspaceFor("task", { returnTo });
    }

    return createErrorState(createResult.errorMessage, values);
  }

  const calendarSyncErrors =
    "calendarSyncErrors" in createResult
      ? createResult.calendarSyncErrors
      : undefined;

  drainCalendarSyncQueueAfterResponse(
    calendarSyncEnabled &&
      Boolean(scheduleResult.scheduledStartAtIso && scheduleResult.scheduledEndAtIso),
  );

  revalidateWorkspaceFor("task", { returnTo });

  return {
    error: null,
    success: [
      createResult.workedTimeLogged
        ? "Task created and worked time logged."
        : "Task created.",
      ...(calendarSyncErrors?.length
        ? [`Calendar sync failed: ${calendarSyncErrors[0]}`]
        : []),
    ].join(" "),
    values: {
      title: "",
      projectId,
      goalId: "",
      description: "",
      blockedReason: "",
      status: "todo",
      priority: "medium",
      dueDate: "",
      estimateMinutes: "",
      recurrenceRule: rawRecurrenceRule,
      recurrenceTimezone,
      scheduledStartAt: "",
      scheduledEndAt: "",
      calendarSyncEnabled: calendarSyncEnabled ? "on" : "",
      calendarReminderMinutes: rawCalendarReminderMinutes,
      workedTimeStartedAt: "",
      workedTimeEndedAt: "",
      returnTo,
    },
  };
}

export async function createTasksBulkAction(
  _previous: CreateTasksBulkFormState,
  formData: FormData,
): Promise<CreateTasksBulkFormState> {
  const titles = String(formData.get("titles") ?? "");
  const rows = parseBulkRowsPayload(String(formData.get("rows") ?? ""));
  const returnTo = getTasksReturnPath(formData.get("returnTo"));

  const values = {
    titles,
    projectId: "",
    goalId: "",
    description: "",
    blockedReason: "",
    status: "todo",
    priority: "medium",
    dueDate: "",
    estimateMinutes: "",
    returnTo,
  };

  if (rows.length === 0) {
    return createBulkErrorState("Add at least one task card before creating tasks.", values);
  }

  const taskScopeResult = await getTaskScopeSnapshot();
  if (taskScopeResult.errorMessage || !taskScopeResult.data) {
    return createBulkErrorState(
      taskScopeResult.errorMessage ?? "Unable to validate task scope right now.",
      values,
    );
  }

  const validRows: TablesInsert<"tasks">[] = [];
  const skippedLines: Array<{ value: string; reason: string }> = [];

  for (const row of rows) {
    const lineLabel = row.lineNumber ? `Line ${row.lineNumber}` : "Row";
    const taskRow = toTaskInsertRow(row);
    const dueDateResult = normalizeTaskDueDateInput(row.dueDate);
    const estimateResult = normalizeTaskEstimateInput(row.estimateMinutes);

    if (!taskRow.title) {
      skippedLines.push({ value: lineLabel, reason: "Task title is required." });
      continue;
    }

    if (taskRow.title.length > TASK_TITLE_MAX) {
      skippedLines.push({ value: taskRow.title, reason: TASK_TITLE_LENGTH_ERROR });
      continue;
    }

    if (!taskRow.project_id) {
      skippedLines.push({ value: taskRow.title, reason: "Project is required." });
      continue;
    }

    if (!isTaskStatus(taskRow.status)) {
      skippedLines.push({
        value: taskRow.title,
        reason: `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.`,
      });
      continue;
    }

    if (!isTaskPriority(taskRow.priority)) {
      skippedLines.push({
        value: taskRow.title,
        reason: `Priority must be one of: ${TASK_PRIORITY_VALUES.join(", ")}.`,
      });
      continue;
    }

    if (taskRow.status === "blocked" && !taskRow.blocked_reason) {
      skippedLines.push({
        value: taskRow.title,
        reason: "Blocked reason is required when status is Blocked.",
      });
      continue;
    }

    if (dueDateResult.error) {
      skippedLines.push({
        value: taskRow.title || lineLabel,
        reason: dueDateResult.error,
      });
      continue;
    }

    if (estimateResult.error) {
      skippedLines.push({
        value: taskRow.title || lineLabel,
        reason: estimateResult.error,
      });
      continue;
    }

    taskRow.due_date = dueDateResult.value;
    taskRow.estimate_minutes = estimateResult.value;

    const scopeError = getTaskInsertScopeError(taskRow, taskScopeResult.data);

    if (scopeError) {
      skippedLines.push({ value: taskRow.title, reason: scopeError });
      continue;
    }

    validRows.push(taskRow);
  }

  if (validRows.length === 0) {
    return createBulkErrorState(
      "No valid task rows are ready to create.",
      values,
      skippedLines,
    );
  }

  const { errorMessage } = await createTasks(validRows);

  if (errorMessage) {
    return createBulkErrorState(errorMessage, values, skippedLines);
  }

  revalidateWorkspaceFor("task", { returnTo });

  return {
    error: null,
    success: `${validRows.length} task${validRows.length === 1 ? "" : "s"} created.`,
    createdCount: validRows.length,
    skippedLines,
    values: {
      titles: "",
      projectId: "",
      goalId: "",
      description: "",
      blockedReason: "",
      status: "todo",
      priority: "medium",
      dueDate: "",
      estimateMinutes: "",
      returnTo,
    },
  };
}

function parseTaskInlineUpdateFormData(
  formData: FormData,
  options?: { accountTimezone?: string; fallbackAnchorDate?: string },
) {
  return validateTaskInlineUpdateInput({
    accountTimezone: options?.accountTimezone,
    fallbackAnchorDate: options?.fallbackAnchorDate,
    taskId: String(formData.get("taskId") ?? ""),
    title: formData.has("title") ? formData.get("title") : undefined,
    projectId: formData.has("projectId") ? formData.get("projectId") : undefined,
    goalId: formData.has("goalId") ? formData.get("goalId") : undefined,
    description: formData.has("description") ? formData.get("description") : undefined,
    status: String(formData.get("status") ?? ""),
    priority: String(formData.get("priority") ?? ""),
    dueDate: formData.get("dueDate"),
    estimateMinutes: formData.get("estimateMinutes"),
    blockedReason: formData.get("blockedReason"),
    recurrenceRule: formData.has("recurrenceRule")
      ? formData.get("recurrenceRule")
      : undefined,
    recurrenceTimezone: formData.has("recurrenceTimezone")
      ? formData.get("recurrenceTimezone")
      : undefined,
    scheduledStartAt: formData.has("scheduledStartAt")
      ? formData.get("scheduledStartAt")
      : undefined,
    scheduledEndAt: formData.has("scheduledEndAt")
      ? formData.get("scheduledEndAt")
      : undefined,
    calendarSyncEnabled: formData.has("calendarSyncEnabled")
      ? formData.get("calendarSyncEnabled")
      : undefined,
    calendarReminderMinutes: formData.has("calendarReminderMinutes")
      ? formData.get("calendarReminderMinutes")
      : undefined,
  });
}

export async function updateTaskInlineAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const accountTimezoneResult = await resolveAccountTimezone();
  if (accountTimezoneResult.error || !accountTimezoneResult.timezone) {
    redirectWithTasksError(
      returnPath,
      accountTimezoneResult.error ?? "Unable to load the account timezone right now.",
      String(formData.get("taskId") ?? "").trim() || undefined,
    );
  }
  const validationResult = parseTaskInlineUpdateFormData(formData, {
    accountTimezone: accountTimezoneResult.timezone,
    fallbackAnchorDate: accountTimezoneResult.localDate ?? undefined,
  });

  if (validationResult.errorMessage || !validationResult.data) {
    redirectWithTasksError(
      returnPath,
      validationResult.errorMessage ?? "Task update request is invalid.",
      String(formData.get("taskId") ?? "").trim() || undefined,
    );
  }

  const validatedInput = validationResult.data;
  const { errorMessage } = await updateTaskInline(validatedInput, {
    fallbackAnchorDate: accountTimezoneResult.localDate ?? undefined,
  });

  if (errorMessage) {
    redirectWithTasksError(returnPath, errorMessage, validatedInput.taskId);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: `task-${validatedInput.taskId}`,
  });
}

/**
 * One-field patch for the task drawer.
 *
 * The current row is read server-side and merged into the validated input, so a
 * single-field change never writes back unrelated values the browser held. The
 * field whitelist lives in the service, next to `updateTaskInline`.
 */
export async function updateTaskFieldAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");

  const accountTimezoneResult = await resolveAccountTimezone();
  const { errorMessage } = await updateTaskFieldForOwner(
    { taskId, field, value },
    {
      accountTimezone: accountTimezoneResult.timezone ?? undefined,
      fallbackAnchorDate: accountTimezoneResult.localDate ?? undefined,
    },
  );

  if (errorMessage) {
    redirectWithTasksError(returnPath, errorMessage, taskId || undefined);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: taskId ? `task-${taskId}` : undefined,
    ...(returnPath.includes("task=") ? { taskId } : {}),
  });
}

export type { TaskFieldDraftState } from "@/lib/task-field-draft";

/**
 * Draft-preserving field save for the drawer's text editors.
 *
 * The redirecting `updateTaskFieldAction` is fine for pickers, but a title or
 * description draft must survive a rejected save. This returns state instead and
 * revalidates only after a successful write, so the editor can keep the text and
 * show a field-level error.
 */
export async function updateTaskFieldDraftAction(
  _previous: TaskFieldDraftState,
  formData: FormData,
): Promise<TaskFieldDraftState> {
  const taskId = String(formData.get("taskId") ?? "").trim();
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "");
  const returnPath = getTasksReturnPath(formData.get("returnTo"));

  const accountTimezoneResult = await resolveAccountTimezone();
  const { errorMessage } = await updateTaskFieldForOwner(
    { taskId, field, value },
    {
      accountTimezone: accountTimezoneResult.timezone ?? undefined,
      fallbackAnchorDate: accountTimezoneResult.localDate ?? undefined,
    },
  );

  if (errorMessage) {
    return { errorMessage, successMessage: null, savedValue: null };
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  return { errorMessage: null, successMessage: "Saved.", savedValue: value };
}

export type TaskTableCellUpdateResult = {
  errorMessage: string | null;
  savedValue: string | null;
  updatedAt: string | null;
};

export type TaskTableCellUpdateInput = {
  taskId: string;
  field: TaskTableCellEditableField | string;
  value: string;
  /** The row revision the table rendered; a changed row is a conflict. */
  expectedUpdatedAt: string;
  returnTo?: string;
};

/**
 * Persist one table-cell edit without navigating away from the table.
 *
 * The cell diameter owns its draft until the server accepts the change, and the
 * row's rendered `updated_at` is a required precondition so a stale table can
 * never overwrite another editor's work. Unrelated fields are carried from the
 * server row by `updateTaskFieldForOwner`, never from the client.
 */
export async function updateTaskTableCellAction(
  input: TaskTableCellUpdateInput,
): Promise<TaskTableCellUpdateResult> {
  const payload = input && typeof input === "object" ? input : null;
  const taskId = typeof payload?.taskId === "string" ? payload.taskId.trim() : "";
  const field = typeof payload?.field === "string" ? payload.field : "";
  const value = typeof payload?.value === "string" ? payload.value : null;
  const expectedUpdatedAt =
    typeof payload?.expectedUpdatedAt === "string"
      ? payload.expectedUpdatedAt.trim()
      : "";

  if (
    !taskId ||
    !isTaskTableCellEditableField(field) ||
    value === null ||
    !expectedUpdatedAt ||
    value.length > 2_000
  ) {
    return {
      errorMessage: "Task update request is invalid.",
      savedValue: null,
      updatedAt: null,
    };
  }

  const returnPath = getTasksReturnPath(payload?.returnTo);
  const accountTimezoneResult = await resolveAccountTimezone();
  const result = await updateTaskFieldForOwner(
    { taskId, field, value, expectedUpdatedAt },
    {
      accountTimezone: accountTimezoneResult.timezone ?? undefined,
      fallbackAnchorDate: accountTimezoneResult.localDate ?? undefined,
    },
  );

  if (result.errorMessage) {
    return {
      errorMessage: result.errorMessage,
      savedValue: null,
      updatedAt: null,
    };
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  return {
    errorMessage: null,
    savedValue: result.savedValue ?? value,
    updatedAt: result.updatedAt ?? null,
  };
}

export type UpdateTaskEditorFormState = {
  errorMessage: string | null;
  successMessage: string | null;
  taskId: string | null;
};

/**
 * Edit-modal persistence for the canonical inline task update.
 * Reuses `parseTaskInlineUpdateFormData` and `updateTaskInline` (the same
 * validation and mutation as `updateTaskInlineAction`) but returns form state
 * instead of redirecting, so the modal can keep the user's edits on failure
 * and close on success.
 */
export async function updateTaskEditorAction(
  _previous: UpdateTaskEditorFormState,
  formData: FormData,
): Promise<UpdateTaskEditorFormState> {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const accountTimezoneResult = await resolveAccountTimezone();
  if (accountTimezoneResult.error || !accountTimezoneResult.timezone) {
    return {
      errorMessage:
        accountTimezoneResult.error ?? "Unable to load the account timezone right now.",
      successMessage: null,
      taskId: String(formData.get("taskId") ?? "").trim() || null,
    };
  }
  const validationResult = parseTaskInlineUpdateFormData(formData, {
    accountTimezone: accountTimezoneResult.timezone,
    fallbackAnchorDate: accountTimezoneResult.localDate ?? undefined,
  });

  if (validationResult.errorMessage || !validationResult.data) {
    return {
      errorMessage: validationResult.errorMessage ?? "Task update request is invalid.",
      successMessage: null,
      taskId: String(formData.get("taskId") ?? "").trim() || null,
    };
  }

  const validatedInput = validationResult.data;
  const { errorMessage } = await updateTaskInline(validatedInput, {
    fallbackAnchorDate: accountTimezoneResult.localDate ?? undefined,
  });

  if (errorMessage) {
    return {
      errorMessage,
      successMessage: null,
      taskId: validatedInput.taskId,
    };
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });

  return {
    errorMessage: null,
    successMessage: "Task updated.",
    taskId: validatedInput.taskId,
  };
}

export async function createTaskReminderAction(formData: FormData) {
  const returnPath = getTaskSurfaceReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const accountTimezoneResult = await resolveAccountTimezone();
  if (accountTimezoneResult.error || !accountTimezoneResult.timezone) {
    redirectWithTaskSurfaceError(
      returnPath,
      accountTimezoneResult.error ?? "Unable to load the account timezone right now.",
      taskId || undefined,
    );
  }

  const { errorMessage } = await createTaskEmailReminder({
    taskId,
    remindAt: formData.get("remindAt"),
    channel: formData.get("channel") ?? "email",
    status: formData.get("status") ?? "pending",
    timezone: accountTimezoneResult.timezone,
  });

  if (errorMessage) {
    redirectWithTaskSurfaceError(returnPath, errorMessage, taskId || undefined);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: returnPath.startsWith("/tasks") && taskId ? `task-${taskId}` : undefined,
    taskSuccessMessage: "Reminder scheduled.",
    taskId,
  });
}

export async function updateTaskReminderAction(formData: FormData) {
  const returnPath = getTaskSurfaceReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const reminderId = String(formData.get("reminderId") ?? "").trim();

  const accountTimezoneResult = await resolveAccountTimezone();
  if (accountTimezoneResult.error || !accountTimezoneResult.timezone) {
    redirectWithTaskSurfaceError(
      returnPath,
      accountTimezoneResult.error ?? "Unable to load the account timezone right now.",
      taskId || undefined,
    );
  }

  const { errorMessage } = await updateTaskEmailReminder({
    taskId,
    reminderId,
    remindAt: formData.get("remindAt"),
    channel: formData.get("channel") ?? "email",
    status: formData.get("status") ?? "pending",
    timezone: accountTimezoneResult.timezone,
  });

  if (errorMessage) {
    redirectWithTaskSurfaceError(returnPath, errorMessage, taskId || undefined);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: returnPath.startsWith("/tasks") && taskId ? `task-${taskId}` : undefined,
    taskSuccessMessage: "Reminder updated.",
    taskId,
  });
}

export async function cancelTaskReminderAction(formData: FormData) {
  const returnPath = getTaskSurfaceReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const reminderId = String(formData.get("reminderId") ?? "").trim();

  const { errorMessage } = await cancelTaskReminder({
    taskId,
    reminderId,
    status: formData.get("status") ?? "cancelled",
  });

  if (errorMessage) {
    redirectWithTaskSurfaceError(returnPath, errorMessage, taskId || undefined);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: returnPath.startsWith("/tasks") && taskId ? `task-${taskId}` : undefined,
    taskSuccessMessage: "Reminder cancelled.",
    taskId,
  });
}

export async function pinTaskAction(formData: FormData) {
  const returnPath = getTaskSurfaceReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const { errorMessage } = await pinTaskInFocusQueue(taskId);

  if (errorMessage) {
    redirectWithTaskSurfaceError(returnPath, errorMessage, taskId || undefined);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: returnPath.startsWith("/tasks") && taskId ? `task-${taskId}` : undefined,
  });
}

export async function unpinTaskAction(formData: FormData) {
  const returnPath = getTaskSurfaceReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const { errorMessage } = await unpinTaskInFocusQueue(taskId);

  if (errorMessage) {
    redirectWithTaskSurfaceError(returnPath, errorMessage, taskId || undefined);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: returnPath.startsWith("/tasks") && taskId ? `task-${taskId}` : undefined,
  });
}

async function updateTaskArchiveAction(formData: FormData, archived: boolean) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const { errorMessage } = archived
    ? await archiveTaskSafely(taskId)
    : await unarchiveTask(taskId);

  if (errorMessage) {
    redirectWithTasksError(returnPath, errorMessage, taskId || undefined);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });

  if (archived) {
    redirectWithWorkspaceFeedback(returnPath, {
      taskSuccessMessage: "Task archived.",
    });
  }

  redirectWithWorkspaceFeedback(returnPath, {
    anchor: `task-${taskId}`,
    taskSuccessMessage: "Task restored.",
  });
}

export async function archiveTaskAction(formData: FormData) {
  await updateTaskArchiveAction(formData, true);
}

export async function unarchiveTaskAction(formData: FormData) {
  await updateTaskArchiveAction(formData, false);
}

export async function archiveManyCompletedTasksAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));

  if (String(formData.get("confirmArchiveCompleted") ?? "").trim() !== "true") {
    redirectWithTasksError(returnPath, "Bulk archive confirmation is required.");
  }

  const requestIds = formData
    .getAll("taskIds")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const uniqueIds = [...new Set(requestIds)];

  if (uniqueIds.length === 0) {
    redirectWithTasksError(returnPath, "Select at least one completed task to archive.");
  }

  // Eligibility is re-verified server-side by the transition service under the
  // caller's RLS scope; the submitted ids only seed the intent.
  const bulkResult = await archiveCompletedTasksSafely(uniqueIds);

  const archivedCount = bulkResult.archivedTaskIds.length;
  const failureCount = bulkResult.failures.length;
  const ineligibleCount = bulkResult.ineligibleCount;

  if (archivedCount === 0) {
    redirectWithTasksError(
      returnPath,
      failureCount > 0
        ? bulkResult.failures[0]?.errorMessage ?? "Unable to archive tasks right now."
        : "No completed tasks are eligible to archive right now.",
    );
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });

  const parts = [`Archived ${archivedCount} completed task${archivedCount === 1 ? "" : "s"}`];
  if (failureCount > 0) {
    parts.push(`${failureCount} could not be archived`);
  }
  if (ineligibleCount > 0) {
    parts.push(`${ineligibleCount} were no longer eligible`);
  }
  const successMessage = `${parts.join("; ")}.`;

  redirectWithWorkspaceFeedback(returnPath, {
    taskSuccessMessage: successMessage,
  });
}

export async function deleteTaskAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const confirmDelete = String(formData.get("confirmDelete") ?? "").trim();

  if (!taskId) {
    redirectWithTasksError(returnPath, "Task delete request is invalid.");
  }

  if (confirmDelete !== "true") {
    redirectWithTasksError(returnPath, "Task delete confirmation is required.", taskId);
  }

  const { errorMessage } = await deleteTaskSafely(taskId);

  if (errorMessage) {
    redirectWithTasksError(returnPath, errorMessage, taskId);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath);
}

// ---------------------------------------------------------------------------
// Bulk task operations (EGA-786)
//
// The client calls these with explicit visible ids and shows a toast from the
// returned operation id. They return state instead of redirecting so a partial
// result can be reported per item and Undo can report the server's real
// outcome; no client-supplied row snapshot is trusted.
// ---------------------------------------------------------------------------

export async function bulkTaskFieldAction(input: {
  taskIds: string[];
  field: string;
  value: string;
  returnTo?: string;
}): Promise<import("@/lib/services/task-bulk-service").BulkTaskResult> {
  const { bulkPatchTasksForOwner } = await import("@/lib/services/task-bulk-service");
  const result = await bulkPatchTasksForOwner({
    taskIds: Array.isArray(input.taskIds) ? input.taskIds : [],
    field: input.field,
    value: input.value,
  });

  if (result.applied > 0) {
    revalidateWorkspaceFor("task", {
      returnTo: getTasksReturnPath(input.returnTo),
    });
  }

  return result;
}

export async function bulkTaskArchiveAction(input: {
  taskIds: string[];
  archived: boolean;
  returnTo?: string;
}): Promise<import("@/lib/services/task-bulk-service").BulkTaskResult> {
  const { bulkArchiveTasksForOwner } = await import("@/lib/services/task-bulk-service");
  const result = await bulkArchiveTasksForOwner({
    taskIds: Array.isArray(input.taskIds) ? input.taskIds : [],
    archived: Boolean(input.archived),
  });

  if (result.applied > 0) {
    revalidateWorkspaceFor("task", {
      returnTo: getTasksReturnPath(input.returnTo),
    });
  }

  return result;
}

export async function undoTaskOperationAction(
  operationId: string,
): Promise<"success" | "conflict" | "failure"> {
  const { undoTaskOperationForOwner } = await import("@/lib/services/task-bulk-service");
  const { results, errorMessage } = await undoTaskOperationForOwner(String(operationId ?? ""));

  if (errorMessage && results.length === 0) return "failure";

  const restored = results.filter((result) => result.outcome === "restored").length;
  if (restored > 0) {
    revalidateWorkspaceFor("task", { returnTo: "/tasks" });
    return results.some((result) => result.outcome !== "restored") ? "conflict" : "success";
  }

  return results.some((result) => result.outcome === "conflict") ? "conflict" : "failure";
}

// ---------------------------------------------------------------------------
// Subtasks / checklist (EGA-782)
// ---------------------------------------------------------------------------

async function subtaskFeedback(
  returnPath: string,
  taskId: string,
  result: { errorMessage: string | null },
  successMessage: string,
): Promise<never> {
  if (result.errorMessage) {
    redirectWithTasksError(returnPath, result.errorMessage, taskId);
  }
  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    taskSuccessMessage: successMessage,
    taskId,
  });
  // `redirect` inside redirectWithWorkspaceFeedback is `never`; keep TS happy.
  throw new Error("unreachable");
}

export async function addSubtaskAction(formData: FormData): Promise<never> {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const { addTaskSubtask } = await import("@/lib/services/subtask-service");
  const result = await addTaskSubtask({
    taskId,
    title: String(formData.get("title") ?? ""),
  });
  return subtaskFeedback(returnPath, taskId, result, "Subtask added.");
}

export async function toggleSubtaskAction(formData: FormData): Promise<never> {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const { setTaskSubtaskDone } = await import("@/lib/services/subtask-service");
  const result = await setTaskSubtaskDone({
    subtaskId: String(formData.get("subtaskId") ?? "").trim(),
    done: String(formData.get("done") ?? "") === "true",
  });
  return subtaskFeedback(returnPath, taskId, result, "Subtask updated.");
}

export async function renameSubtaskAction(formData: FormData): Promise<never> {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const { renameTaskSubtask } = await import("@/lib/services/subtask-service");
  const result = await renameTaskSubtask({
    subtaskId: String(formData.get("subtaskId") ?? "").trim(),
    title: String(formData.get("title") ?? ""),
  });
  return subtaskFeedback(returnPath, taskId, result, "Subtask renamed.");
}

export async function deleteSubtaskAction(formData: FormData): Promise<never> {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const { deleteTaskSubtask } = await import("@/lib/services/subtask-service");
  const result = await deleteTaskSubtask(String(formData.get("subtaskId") ?? "").trim());
  return subtaskFeedback(returnPath, taskId, result, "Subtask deleted.");
}

export async function moveSubtaskAction(formData: FormData): Promise<never> {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const direction = String(formData.get("direction") ?? "") === "up" ? "up" : "down";
  const { moveTaskSubtask } = await import("@/lib/services/subtask-service");
  const result = await moveTaskSubtask({
    taskId,
    subtaskId: String(formData.get("subtaskId") ?? "").trim(),
    direction,
  });
  return subtaskFeedback(returnPath, taskId, result, "Subtask reordered.");
}

export async function promoteSubtaskAction(formData: FormData): Promise<never> {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const { promoteTaskSubtask } = await import("@/lib/services/subtask-service");
  const result = await promoteTaskSubtask(String(formData.get("subtaskId") ?? "").trim());
  if (result.errorMessage || !result.data) {
    redirectWithTasksError(returnPath, result.errorMessage ?? "Unable to promote the subtask.", taskId);
  }
  revalidateWorkspaceFor("task", { returnTo: returnPath });
  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("task", result.data.taskId);
  target.searchParams.delete("taskMode");
  redirectWithWorkspaceFeedback(`${target.pathname}?${target.searchParams.toString()}`, {
    taskSuccessMessage: "Subtask promoted to a task.",
    taskId: result.data.taskId,
  });
  throw new Error("unreachable");
}
