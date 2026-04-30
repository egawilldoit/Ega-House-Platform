import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/lib/supabase/database.types";
import { stopActiveTimerSessionsForTask } from "@/lib/services/timer-service";
import { getTodayLocalIsoDate } from "@/lib/task-due-date";
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

  return updateTaskWorkflowFields(
    normalizedTaskId,
    {
      status: "done",
      completed_at: nowIso,
      updated_at: nowIso,
    },
    { ...options, supabase },
  );
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
