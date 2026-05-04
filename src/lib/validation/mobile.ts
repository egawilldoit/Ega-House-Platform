import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  isTaskDueFilter,
  isTaskSortValue,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { isTaskPriority, isTaskStatus, type TaskPriority, type TaskStatus } from "@/lib/task-domain";
import { normalizeTaskDueDateInput } from "@/lib/task-due-date";
import { normalizeTaskEstimateInput } from "@/lib/task-estimate";
import { normalizeTaskRecurrenceRuleInput } from "@/lib/task-recurrence";
import type {
  CreateTaskInput,
  MobileApiErrorCode,
  MobileApiErrorResponse,
  UpdateTaskInput,
} from "@/lib/contracts/mobile";

type ValidationSuccess<T> = {
  ok: true;
  data: T;
};

type ValidationFailure = {
  ok: false;
  error: MobileApiErrorResponse;
  status: number;
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function createMobileApiError(
  code: MobileApiErrorCode,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
): ValidationFailure {
  return {
    ok: false,
    status,
    error: {
      ok: false,
      error: {
        code,
        message,
        details,
      },
    },
  };
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export function getBearerTokenFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ", 2);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token?.trim()) {
    return null;
  }

  return token.trim();
}

export async function parseJsonRequestBody(request: Request) {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
}

export function validateMobileAuthSessionRequest(body: unknown): ValidationResult<{
  email: string;
  password: string;
}> {
  const record = asObjectRecord(body);
  if (!record) {
    return createMobileApiError("INVALID_REQUEST", "Request body must be a JSON object.");
  }

  const email = String(record.email ?? "").trim().toLowerCase();
  const password = String(record.password ?? "");
  if (!email) {
    return createMobileApiError("VALIDATION_ERROR", "Email is required.");
  }
  if (!password) {
    return createMobileApiError("VALIDATION_ERROR", "Password is required.");
  }

  return {
    ok: true,
    data: {
      email,
      password,
    },
  };
}

export function validateMobileAuthRefreshRequest(body: unknown): ValidationResult<{
  refreshToken: string;
}> {
  const record = asObjectRecord(body);
  if (!record) {
    return createMobileApiError("INVALID_REQUEST", "Request body must be a JSON object.");
  }

  const refreshToken = String(record.refreshToken ?? "").trim();
  if (!refreshToken) {
    return createMobileApiError("VALIDATION_ERROR", "refreshToken is required.");
  }

  return {
    ok: true,
    data: {
      refreshToken,
    },
  };
}

function parseTaskStatusOrNull(value: string): TaskStatus | null {
  return isTaskStatus(value) ? value : null;
}

function parseTaskPriorityOrNull(value: string): TaskPriority | null {
  return isTaskPriority(value) ? value : null;
}

export function validateMobileTaskListQuery(searchParams: URLSearchParams): ValidationResult<{
  status: TaskStatus | null;
  projectId: string | null;
  goalId: string | null;
  due: TaskDueFilter;
  sort: TaskSortValue;
  limit: number | null;
}> {
  const statusParam = searchParams.get("status")?.trim() ?? "";
  const projectId = searchParams.get("projectId")?.trim() || null;
  const goalId = searchParams.get("goalId")?.trim() || null;
  const dueParam = searchParams.get("due")?.trim() ?? DEFAULT_TASK_DUE_FILTER;
  const sortParam = searchParams.get("sort")?.trim() ?? DEFAULT_TASK_SORT;
  const limitParam = searchParams.get("limit")?.trim() ?? "";
  const status = statusParam ? parseTaskStatusOrNull(statusParam) : null;

  if (statusParam && !status) {
    return createMobileApiError("VALIDATION_ERROR", "Invalid status filter.");
  }

  if (!isTaskDueFilter(dueParam)) {
    return createMobileApiError("VALIDATION_ERROR", "Invalid due filter.");
  }

  if (!isTaskSortValue(sortParam)) {
    return createMobileApiError("VALIDATION_ERROR", "Invalid sort value.");
  }

  let limit: number | null = null;
  if (limitParam) {
    const parsedLimit = Number.parseInt(limitParam, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0 || parsedLimit > 200) {
      return createMobileApiError("VALIDATION_ERROR", "limit must be an integer between 1 and 200.");
    }
    limit = parsedLimit;
  }

  return {
    ok: true,
    data: {
      status,
      projectId,
      goalId,
      due: dueParam,
      sort: sortParam,
      limit,
    },
  };
}

export function validateCreateTaskInput(body: unknown): ValidationResult<CreateTaskInput> {
  const record = asObjectRecord(body);
  if (!record) {
    return createMobileApiError("INVALID_REQUEST", "Request body must be a JSON object.");
  }

  const title = String(record.title ?? "").trim();
  const projectId = String(record.projectId ?? "").trim();
  const goalId = String(record.goalId ?? "").trim() || null;
  const descriptionRaw = record.description;
  const blockedReasonRaw = record.blockedReason;
  const statusValue = String(record.status ?? "").trim();
  const priorityValue = String(record.priority ?? "").trim();
  const dueDateResult = normalizeTaskDueDateInput(record.dueDate);
  const estimateResult = normalizeTaskEstimateInput(record.estimateMinutes);
  const recurrenceResult = normalizeTaskRecurrenceRuleInput(record.recurrenceRule);
  const recurrenceAnchorDate =
    record.recurrenceAnchorDate === null || record.recurrenceAnchorDate === undefined
      ? null
      : String(record.recurrenceAnchorDate).trim() || null;
  const recurrenceTimezone =
    record.recurrenceTimezone === null || record.recurrenceTimezone === undefined
      ? null
      : String(record.recurrenceTimezone).trim() || null;

  if (!title) {
    return createMobileApiError("VALIDATION_ERROR", "Task title is required.");
  }
  if (!projectId) {
    return createMobileApiError("VALIDATION_ERROR", "projectId is required.");
  }
  if (!isTaskStatus(statusValue)) {
    return createMobileApiError("VALIDATION_ERROR", "Invalid task status.");
  }
  if (!isTaskPriority(priorityValue)) {
    return createMobileApiError("VALIDATION_ERROR", "Invalid task priority.");
  }
  if (dueDateResult.error) {
    return createMobileApiError("VALIDATION_ERROR", dueDateResult.error);
  }
  if (estimateResult.error) {
    return createMobileApiError("VALIDATION_ERROR", estimateResult.error);
  }
  if (recurrenceResult.errorMessage) {
    return createMobileApiError("VALIDATION_ERROR", recurrenceResult.errorMessage);
  }

  const description =
    descriptionRaw === null || descriptionRaw === undefined
      ? null
      : String(descriptionRaw).trim() || null;
  const blockedReason =
    blockedReasonRaw === null || blockedReasonRaw === undefined
      ? null
      : String(blockedReasonRaw).trim() || null;

  if (statusValue === "blocked" && !blockedReason) {
    return createMobileApiError(
      "VALIDATION_ERROR",
      "Blocked reason is required when status is Blocked.",
    );
  }

  return {
    ok: true,
    data: {
      title,
      projectId,
      goalId,
      description,
      blockedReason,
      status: statusValue,
      priority: priorityValue,
      dueDate: dueDateResult.value,
      estimateMinutes: estimateResult.value,
      recurrenceRule: recurrenceResult.rule,
      recurrenceAnchorDate,
      recurrenceTimezone,
    },
  };
}

export function validateUpdateTaskInput(body: unknown): ValidationResult<UpdateTaskInput> {
  const record = asObjectRecord(body);
  if (!record) {
    return createMobileApiError("INVALID_REQUEST", "Request body must be a JSON object.");
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(record, "status");
  const hasPriority = Object.prototype.hasOwnProperty.call(record, "priority");
  const hasDueDate = Object.prototype.hasOwnProperty.call(record, "dueDate");
  const hasEstimate = Object.prototype.hasOwnProperty.call(record, "estimateMinutes");
  const hasRecurrenceRule = Object.prototype.hasOwnProperty.call(record, "recurrenceRule");
  const hasRecurrenceAnchorDate = Object.prototype.hasOwnProperty.call(
    record,
    "recurrenceAnchorDate",
  );
  const hasRecurrenceTimezone = Object.prototype.hasOwnProperty.call(
    record,
    "recurrenceTimezone",
  );
  const hasDescription = Object.prototype.hasOwnProperty.call(record, "description");
  const hasBlockedReason = Object.prototype.hasOwnProperty.call(record, "blockedReason");
  if (
    !hasStatus &&
    !hasPriority &&
    !hasDueDate &&
    !hasEstimate &&
    !hasRecurrenceRule &&
    !hasRecurrenceAnchorDate &&
    !hasRecurrenceTimezone &&
    !hasDescription &&
    !hasBlockedReason
  ) {
    return createMobileApiError(
      "VALIDATION_ERROR",
      "At least one mutable field must be provided.",
    );
  }

  const output: UpdateTaskInput = {};

  if (hasStatus) {
    const value = String(record.status ?? "").trim();
    const status = parseTaskStatusOrNull(value);
    if (!status) {
      return createMobileApiError("VALIDATION_ERROR", "Invalid task status.");
    }
    output.status = status;
  }

  if (hasPriority) {
    const value = String(record.priority ?? "").trim();
    const priority = parseTaskPriorityOrNull(value);
    if (!priority) {
      return createMobileApiError("VALIDATION_ERROR", "Invalid task priority.");
    }
    output.priority = priority;
  }

  if (hasDueDate) {
    const dueDateResult = normalizeTaskDueDateInput(record.dueDate);
    if (dueDateResult.error) {
      return createMobileApiError("VALIDATION_ERROR", dueDateResult.error);
    }
    output.dueDate = dueDateResult.value;
  }

  if (hasEstimate) {
    const estimateResult = normalizeTaskEstimateInput(record.estimateMinutes);
    if (estimateResult.error) {
      return createMobileApiError("VALIDATION_ERROR", estimateResult.error);
    }
    output.estimateMinutes = estimateResult.value;
  }

  if (hasRecurrenceRule) {
    const recurrenceResult = normalizeTaskRecurrenceRuleInput(record.recurrenceRule);
    if (recurrenceResult.errorMessage) {
      return createMobileApiError("VALIDATION_ERROR", recurrenceResult.errorMessage);
    }
    output.recurrenceRule = recurrenceResult.rule;
  }

  if (hasRecurrenceAnchorDate) {
    output.recurrenceAnchorDate =
      record.recurrenceAnchorDate === null || record.recurrenceAnchorDate === undefined
        ? null
        : String(record.recurrenceAnchorDate).trim() || null;
  }

  if (hasRecurrenceTimezone) {
    output.recurrenceTimezone =
      record.recurrenceTimezone === null || record.recurrenceTimezone === undefined
        ? null
        : String(record.recurrenceTimezone).trim() || null;
  }

  if (hasDescription) {
    if (record.description === null || record.description === undefined) {
      output.description = null;
    } else {
      output.description = String(record.description).trim() || null;
    }
  }

  if (hasBlockedReason) {
    if (record.blockedReason === null || record.blockedReason === undefined) {
      output.blockedReason = null;
    } else {
      output.blockedReason = String(record.blockedReason).trim() || null;
    }
  }

  return {
    ok: true,
    data: output,
  };
}

export function validateMobileTodayStatusInput(body: unknown): ValidationResult<{
  status: TaskStatus;
}> {
  const record = asObjectRecord(body);
  if (!record) {
    return createMobileApiError("INVALID_REQUEST", "Request body must be a JSON object.");
  }

  const status = String(record.status ?? "").trim();
  if (!isTaskStatus(status)) {
    return createMobileApiError("VALIDATION_ERROR", "Invalid task status.");
  }

  return {
    ok: true,
    data: {
      status,
    },
  };
}
