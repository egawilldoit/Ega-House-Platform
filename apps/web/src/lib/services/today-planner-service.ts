import { createClient } from "@/lib/supabase/server";
import { getTodayLocalIsoDate } from "@/lib/task-due-date";
import {
  getActiveTimerSession,
  getTimerSummary,
} from "@/lib/services/timer-service";
import {
  getTasksForTodayPlanning,
  type NormalizedTaskRow,
  type TaskPlanningReadMode,
} from "@/lib/services/task-read-service";
import {
  buildTodayPlan,
  type TodayPlannerData,
  type TodayPlannerTask,
} from "@/lib/services/today-plan-builder";
import {
  planTaskForToday,
  removeTaskFromToday as transitionRemoveTaskFromToday,
  updateTaskFromTodayIntent,
} from "@/lib/services/task-transition-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type TodayTaskRow = NormalizedTaskRow;
export type { TodayPlannerData, TodayPlannerTask };

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

async function queryTodayTaskRowsWithBlockedReasonFallback(
  supabase: SupabaseServerClient,
  mode: TaskPlanningReadMode,
  today: string,
): Promise<{ data: TodayTaskRow[]; errorMessage: string | null }> {
  return getTasksForTodayPlanning({ supabase, mode, today });
}

export async function getTodayPlannerData(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
  activeTimerResult?: Awaited<ReturnType<typeof getActiveTimerSession>>;
  timerSummaryResult?: Awaited<ReturnType<typeof getTimerSummary>>;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const now = options?.now ?? new Date();
  const today = getTodayLocalIsoDate(now);

  const [selectedResult, pinnedResult, inProgressResult, activeTimerResult, timerSummaryResult] =
    await Promise.all([
      queryTodayTaskRowsWithBlockedReasonFallback(supabase, "selected", today),
      queryTodayTaskRowsWithBlockedReasonFallback(supabase, "pinned", today),
      queryTodayTaskRowsWithBlockedReasonFallback(supabase, "inProgress", today),
      options?.activeTimerResult
        ? Promise.resolve(options.activeTimerResult)
        : getActiveTimerSession({ supabase }),
      options?.timerSummaryResult
        ? Promise.resolve(options.timerSummaryResult)
        : getTimerSummary({ supabase, limit: 120 }),
    ]);

  if (selectedResult.errorMessage) {
    console.error("Today planner selected query failed", selectedResult.errorMessage);
    return { errorMessage: "Could not load Today plan right now.", data: null };
  }

  if (pinnedResult.errorMessage || inProgressResult.errorMessage) {
    console.error("Today planner suggestions query failed", {
      pinned: pinnedResult.errorMessage,
      inProgress: inProgressResult.errorMessage,
    });
    return { errorMessage: "Could not load Today suggestions right now.", data: null };
  }

  const plan = buildTodayPlan({
    today,
    selectedRows: selectedResult.data,
    pinnedSuggestionRows: pinnedResult.data,
    inProgressSuggestionRows: inProgressResult.data,
    activeTimer: activeTimerResult.data,
    timerSummary: timerSummaryResult.data,
  });

  return {
    errorMessage: null,
    data: plan satisfies TodayPlannerData,
  };
}

async function getOwnedTaskById(taskId: string, supabase: SupabaseServerClient) {
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    return {
      errorMessage: "Task is required.",
      taskId: null,
    };
  }

  const { data, error } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to verify task ownership right now.",
      taskId: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Task is unavailable.",
      taskId: null,
    };
  }

  return {
    errorMessage: null,
    taskId: data.id,
  };
}

export async function addTaskToToday(taskId: string, options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const scope = await getOwnedTaskById(taskId, supabase);

  if (scope.errorMessage || !scope.taskId) {
    return { errorMessage: scope.errorMessage ?? "Task is unavailable." };
  }

  return planTaskForToday(scope.taskId, {
    supabase,
    now: options?.now,
  });
}

export async function removeTaskFromToday(taskId: string, options?: {
  supabase?: SupabaseServerClient;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const scope = await getOwnedTaskById(taskId, supabase);

  if (scope.errorMessage || !scope.taskId) {
    return { errorMessage: scope.errorMessage ?? "Task is unavailable." };
  }

  return transitionRemoveTaskFromToday(scope.taskId, { supabase });
}

export async function updateTodayTaskStatus(
  taskId: string,
  status: string,
  options?: { supabase?: SupabaseServerClient; blockedReason?: string | null },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const scope = await getOwnedTaskById(taskId, supabase);

  if (scope.errorMessage || !scope.taskId) {
    return { errorMessage: scope.errorMessage ?? "Task is unavailable." };
  }

  return updateTaskFromTodayIntent(scope.taskId, status, {
    supabase,
    blockedReason: options?.blockedReason,
  });
}

export async function clearCompletedFromToday(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const today = getTodayLocalIsoDate(options?.now ?? new Date());

  const { error } = await supabase
    .from("tasks")
    .update({
      planned_for_date: null,
      updated_at: new Date().toISOString(),
    })
    .in("status", ["done", "complete", "completed"])
    .eq("planned_for_date", today);

  if (error) {
    return { errorMessage: "Unable to clear completed Today items right now." };
  }

  return { errorMessage: null };
}
