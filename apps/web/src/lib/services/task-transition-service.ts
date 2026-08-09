import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import {
  generateNextTaskForCompletedRecurrence,
  updateTaskInline,
  type ValidatedTaskInlineUpdateInput,
} from "@/lib/services/task-service";
import {
  startTimerForTask,
  stopActiveTimerSessionsForTask,
} from "@/lib/services/timer-service";
import { getTodayLocalIsoDate } from "@/lib/task-due-date";
import {
  TASK_STATUS_VALUES,
  type TaskStatus,
} from "@/lib/task-domain";
import {
  isMissingTasksBlockedReasonColumn,
  isMissingTasksCompletedAtColumn,
} from "@/lib/supabase-error";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type TaskTransitionOptions = {
  supabase?: SupabaseServerClient;
  now?: Date;
  nowIso?: string;
};

type TaskTransitionResult = {
  errorMessage: string | null;
};

export type TimerStopTaskOutcome = "done" | "in_progress" | "blocked" | "no_change";

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

function getNowIso(options?: { nowIso?: string }) {
  return options?.nowIso ?? new Date().toISOString();
}

function normalizeTaskId(taskId: string) {
  return taskId.trim();
}

async function updateTaskWorkflowFields(
  taskId: string,
  payload: TablesUpdate<"tasks">,
  options?: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const normalizedTaskId = normalizeTaskId(taskId);

  if (!normalizedTaskId) {
    return { errorMessage: "Task update request is invalid." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  let nextPayload = { ...payload };
  let { data, error } = await supabase
    .from("tasks")
    .update(nextPayload)
    .eq("id", normalizedTaskId)
    .select("id")
    .maybeSingle();

  while (error) {
    const fallbackPayload = { ...nextPayload };
    let canRetry = false;

    if (isMissingTasksBlockedReasonColumn(error) && "blocked_reason" in fallbackPayload) {
      delete fallbackPayload.blocked_reason;
      canRetry = true;
    }

    if (isMissingTasksCompletedAtColumn(error) && "completed_at" in fallbackPayload) {
      delete fallbackPayload.completed_at;
      canRetry = true;
    }

    if (!canRetry) {
      break;
    }

    nextPayload = fallbackPayload;
    const fallbackResult = await supabase
      .from("tasks")
      .update(nextPayload)
      .eq("id", normalizedTaskId)
      .select("id")
      .maybeSingle();
    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    return { errorMessage: "Unable to update task right now." };
  }

  if (!data) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  return { errorMessage: null };
}

export async function markTaskDone(
  taskId: string,
  options?: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const nowIso = getNowIso(options);
  const normalizedTaskId = normalizeTaskId(taskId);

  if (!normalizedTaskId) {
    return { errorMessage: "Task update request is invalid." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const stopResult = await stopActiveTimerSessionsForTask(normalizedTaskId, {
    supabase,
    nowIso,
  });

  if (stopResult.errorMessage) {
    return { errorMessage: stopResult.errorMessage };
  }

  const updateResult = await updateTaskWorkflowFields(
    normalizedTaskId,
    {
      status: "done",
      completed_at: nowIso,
      updated_at: nowIso,
    },
    { ...options, supabase },
  );

  if (updateResult.errorMessage) {
    return updateResult;
  }

  return generateNextTaskForCompletedRecurrence(normalizedTaskId, {
    supabase,
    completedAtIso: nowIso,
  });
}

async function loadExistingBlockedReason(
  taskId: string,
  supabase: SupabaseServerClient,
) {
  let { data, error } = await supabase
    .from("tasks")
    .select("blocked_reason")
    .eq("id", taskId)
    .maybeSingle();

  if (error && isMissingTasksBlockedReasonColumn(error)) {
    const fallbackResult = await supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .maybeSingle();

    if (!fallbackResult.error) {
      data = fallbackResult.data ? { blocked_reason: null } : null;
      error = null;
    }
  }

  if (error || !data) {
    return {
      errorMessage: "Unable to load task details right now.",
      blockedReason: null,
    };
  }

  return {
    errorMessage: null,
    blockedReason: data.blocked_reason?.trim() ?? null,
  };
}

export async function completeTaskFromTimerStop(
  taskId: string,
  outcome: TimerStopTaskOutcome,
  options?: TaskTransitionOptions & { blockedReason?: unknown },
): Promise<TaskTransitionResult> {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) {
    return { errorMessage: "Task update request is invalid." };
  }

  if (outcome === "no_change") {
    return { errorMessage: null };
  }

  if (outcome === "done") {
    return markTaskDone(normalizedTaskId, options);
  }

  if (outcome === "in_progress") {
    return resumeTask(normalizedTaskId, options);
  }

  const normalizedBlockedReason = String(options?.blockedReason ?? "").trim();
  if (!normalizedBlockedReason) {
    return { errorMessage: "Blocked reason is required when status is Blocked." };
  }

  return blockTask(normalizedTaskId, normalizedBlockedReason, options);
}

export async function updateTaskFromTodayIntent(
  taskId: string,
  status: string,
  options?: TaskTransitionOptions & { blockedReason?: string | null },
): Promise<TaskTransitionResult> {
  if (!TASK_STATUS_VALUES.includes(status as TaskStatus)) {
    return { errorMessage: `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.` };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) {
    return { errorMessage: "Task update request is invalid." };
  }

  if (status === "done") {
    return markTaskDone(normalizedTaskId, { ...options, supabase });
  }

  if (status === "todo") {
    return markTaskTodo(normalizedTaskId, { ...options, supabase });
  }

  if (status === "in_progress") {
    return resumeTask(normalizedTaskId, { ...options, supabase });
  }

  let blockedReason = options?.blockedReason?.trim() ?? null;
  if (!blockedReason) {
    const existingReasonResult = await loadExistingBlockedReason(normalizedTaskId, supabase);
    if (existingReasonResult.errorMessage) {
      return { errorMessage: existingReasonResult.errorMessage };
    }

    blockedReason = existingReasonResult.blockedReason;
  }

  if (!blockedReason) {
    return { errorMessage: "Blocked reason is required when status is Blocked." };
  }

  return blockTask(normalizedTaskId, blockedReason, { ...options, supabase });
}

export async function applyInlineTaskEdit(
  input: ValidatedTaskInlineUpdateInput,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
): Promise<TaskTransitionResult> {
  return updateTaskInline(input, options);
}

export async function startExecutionForTask(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; nowIso?: string },
): Promise<TaskTransitionResult> {
  return startTimerForTask(taskId, options);
}

export async function markTaskTodo(
  taskId: string,
  options?: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const nowIso = getNowIso(options);

  return updateTaskWorkflowFields(
    taskId,
    {
      status: "todo",
      completed_at: null,
      updated_at: nowIso,
    },
    options,
  );
}

export async function blockTask(
  taskId: string,
  blockedReason: string,
  options?: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const normalizedReason = blockedReason.trim();

  if (!normalizedReason) {
    return { errorMessage: "Blocked reason is required." };
  }

  const nowIso = getNowIso(options);

  return updateTaskWorkflowFields(
    taskId,
    {
      status: "blocked",
      blocked_reason: normalizedReason,
      updated_at: nowIso,
    },
    options,
  );
}

export async function resumeTask(
  taskId: string,
  options?: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const nowIso = getNowIso(options);

  return updateTaskWorkflowFields(
    taskId,
    {
      status: "in_progress",
      blocked_reason: null,
      updated_at: nowIso,
    },
    options,
  );
}

export async function archiveTaskSafely(
  taskId: string,
  options?: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const normalizedTaskId = normalizeTaskId(taskId);

  if (!normalizedTaskId) {
    return { errorMessage: "Task archive request is invalid." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const activeSessionResult = await supabase
    .from("task_sessions")
    .select("id")
    .eq("task_id", normalizedTaskId)
    .is("ended_at", null)
    .limit(1);

  if (activeSessionResult.error) {
    return { errorMessage: "Unable to validate timer sessions for this task right now." };
  }

  if ((activeSessionResult.data ?? []).length > 0) {
    return { errorMessage: "Stop the active timer before archiving this task." };
  }

  const nowIso = getNowIso(options);
  const userResult = await supabase.auth.getUser();
  const archivedBy = userResult.error ? null : userResult.data.user?.id ?? null;

  return updateTaskWorkflowFields(
    normalizedTaskId,
    {
      archived_at: nowIso,
      archived_by: archivedBy,
      focus_rank: null,
      updated_at: nowIso,
    },
    { ...options, supabase },
  );
}

export async function planTaskForToday(
  taskId: string,
  options?: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const today = getTodayLocalIsoDate(options?.now ?? new Date());
  const nowIso = getNowIso(options);

  return updateTaskWorkflowFields(
    taskId,
    {
      planned_for_date: today,
      updated_at: nowIso,
    },
    options,
  );
}

export async function removeTaskFromToday(
  taskId: string,
  options?: TaskTransitionOptions,
): Promise<TaskTransitionResult> {
  const nowIso = getNowIso(options);

  return updateTaskWorkflowFields(
    taskId,
    {
      planned_for_date: null,
      updated_at: nowIso,
    },
    options,
  );
}
