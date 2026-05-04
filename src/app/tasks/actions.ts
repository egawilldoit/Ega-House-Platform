"use server";

import type { TablesInsert } from "@/lib/supabase/database.types";
import { normalizeManualWorkedTimeInput } from "@/lib/manual-worked-time";
import { normalizeTaskDueDateInput } from "@/lib/task-due-date";
import { normalizeTaskEstimateInput } from "@/lib/task-estimate";
import { normalizeTaskRecurrenceRuleInput } from "@/lib/task-recurrence";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  isTaskPriority,
  isTaskStatus,
} from "@/lib/task-domain";
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
  updateTaskInline,
  validateTaskInlineUpdateInput,
} from "@/lib/services/task-service";
import { archiveTaskSafely } from "@/lib/services/task-transition-service";
import {
  pinTaskInFocusQueue,
  unpinTaskInFocusQueue,
} from "@/lib/services/focus-queue-service";
import {
  redirectWithWorkspaceFeedback,
  revalidateWorkspaceFor,
} from "@/lib/workspace/workspace-navigation";

export type CreateTaskFormState = {
  error: string | null;
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
  return { error, success: null, values };
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

function getTasksReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  return returnTo.startsWith("/tasks") ? returnTo : "/tasks";
}

function getTaskSurfaceReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  if (returnTo.startsWith("/tasks") || returnTo.startsWith("/dashboard")) {
    return returnTo;
  }

  return "/tasks";
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
  const workedTimeStartedAt = String(formData.get("workedTimeStartedAt") ?? "").trim();
  const workedTimeEndedAt = String(formData.get("workedTimeEndedAt") ?? "").trim();
  const workedTimeTimezoneOffsetMinutes = formData.get(
    "workedTimeTimezoneOffsetMinutes",
  );
  const returnTo = getTasksReturnPath(formData.get("returnTo"));
  const dueDateResult = normalizeTaskDueDateInput(rawDueDate);
  const estimateResult = normalizeTaskEstimateInput(rawEstimateMinutes);
  const recurrenceResult = normalizeTaskRecurrenceRuleInput(rawRecurrenceRule);
  const workedTimeResult = normalizeManualWorkedTimeInput({
    startedAt: workedTimeStartedAt,
    endedAt: workedTimeEndedAt,
    timeZoneOffsetMinutes: workedTimeTimezoneOffsetMinutes,
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
    workedTimeStartedAt,
    workedTimeEndedAt,
    returnTo,
  };

  if (!title) {
    return createErrorState("Task title is required.", values);
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

  if (workedTimeResult.error) {
    return createErrorState(workedTimeResult.error, values);
  }

  const { errorMessage, createdTaskId, workedTimeLogged } = await createTaskWithOptionalWorkedTime({
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
    },
    workedTime: workedTimeResult.payload,
    recurrenceRule: recurrenceResult.rule,
  });

  if (errorMessage) {
    if (createdTaskId) {
      revalidateWorkspaceFor("task", { returnTo });
    }

    return createErrorState(errorMessage, values);
  }

  revalidateWorkspaceFor("task", { returnTo });

  return {
    error: null,
    success: workedTimeLogged
      ? "Task created and worked time logged."
      : "Task created.",
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

export async function updateTaskInlineAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const validationResult = validateTaskInlineUpdateInput({
    taskId: String(formData.get("taskId") ?? ""),
    status: String(formData.get("status") ?? ""),
    priority: String(formData.get("priority") ?? ""),
    dueDate: formData.get("dueDate"),
    estimateMinutes: formData.get("estimateMinutes"),
    blockedReason: formData.get("blockedReason"),
    recurrenceRule: formData.has("recurrenceRule")
      ? formData.get("recurrenceRule")
      : undefined,
  });

  if (validationResult.errorMessage || !validationResult.data) {
    redirectWithTasksError(
      returnPath,
      validationResult.errorMessage ?? "Task update request is invalid.",
      String(formData.get("taskId") ?? "").trim() || undefined,
    );
  }

  const validatedInput = validationResult.data;
  const { errorMessage } = await updateTaskInline(validatedInput);

  if (errorMessage) {
    redirectWithTasksError(returnPath, errorMessage, validatedInput.taskId);
  }

  revalidateWorkspaceFor("task", { returnTo: returnPath });
  redirectWithWorkspaceFeedback(returnPath, {
    anchor: `task-${validatedInput.taskId}`,
  });
}

export async function createTaskReminderAction(formData: FormData) {
  const returnPath = getTaskSurfaceReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();

  const { errorMessage } = await createTaskEmailReminder({
    taskId,
    remindAt: formData.get("remindAt"),
    channel: formData.get("channel") ?? "email",
    status: formData.get("status") ?? "pending",
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
