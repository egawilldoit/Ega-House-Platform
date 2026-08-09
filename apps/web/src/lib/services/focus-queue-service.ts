import { isTaskPinned, sortFocusQueueTasks } from "@/lib/focus-queue";
import { getFocusQueueTaskRows } from "@/lib/services/task-read-service";
import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

async function getVisibleTaskFocusRank(
  supabase: SupabaseServerClient,
  taskId: string,
) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, focus_rank")
    .eq("id", taskId)
    .maybeSingle();

  if (error || !data) {
    return {
      errorMessage: "Selected task is unavailable.",
      focusRank: null,
    };
  }

  return {
    errorMessage: null,
    focusRank: data.focus_rank,
  };
}

export async function pinTaskInFocusQueue(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return { errorMessage: "Task pin request is invalid." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const taskResult = await getVisibleTaskFocusRank(supabase, normalizedTaskId);
  if (taskResult.errorMessage) {
    return { errorMessage: taskResult.errorMessage };
  }

  if (isTaskPinned(taskResult.focusRank)) {
    return {
      errorMessage: null,
      alreadyPinned: true,
    };
  }

  const buildHighestRankQuery = (includeArchiveFilter: boolean) => {
    const query = supabase
      .from("tasks")
      .select("focus_rank")
      .not("focus_rank", "is", null)
      .order("focus_rank", { ascending: false })
      .limit(1);

    return includeArchiveFilter ? query.is("archived_at", null) : query;
  };

  let { data: highestRankRows, error: highestRankError } = await buildHighestRankQuery(true);

  if (highestRankError) {
    const fallbackResult = await buildHighestRankQuery(false);
    highestRankRows = fallbackResult.data;
    highestRankError = fallbackResult.error;
  }

  if (highestRankError) {
    return { errorMessage: "Unable to update focus queue right now." };
  }

  const nextFocusRank = (highestRankRows?.[0]?.focus_rank ?? 0) + 1;
  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      focus_rank: nextFocusRank,
      updated_at: options?.updatedAtIso ?? new Date().toISOString(),
    })
    .eq("id", normalizedTaskId);

  if (updateError) {
    return { errorMessage: "Unable to pin task right now." };
  }

  return {
    errorMessage: null,
    alreadyPinned: false,
  };
}

export async function unpinTaskInFocusQueue(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return { errorMessage: "Task unpin request is invalid." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const taskResult = await getVisibleTaskFocusRank(supabase, normalizedTaskId);
  if (taskResult.errorMessage) {
    return { errorMessage: taskResult.errorMessage };
  }

  if (!isTaskPinned(taskResult.focusRank)) {
    return {
      errorMessage: null,
      alreadyUnpinned: true,
    };
  }

  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      focus_rank: null,
      updated_at: options?.updatedAtIso ?? new Date().toISOString(),
    })
    .eq("id", normalizedTaskId);

  if (updateError) {
    return { errorMessage: "Unable to unpin task right now." };
  }

  return {
    errorMessage: null,
    alreadyUnpinned: false,
  };
}

export async function getFocusQueueTasks(
  options?: { supabase?: SupabaseServerClient; limit?: number },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const result = await getFocusQueueTaskRows({
    supabase,
    limit: options?.limit,
  });

  if (result.errorMessage) {
    return { data: null, errorMessage: "Could not load focus queue right now." };
  }

  const queue = sortFocusQueueTasks(result.data).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    focusRank: task.focus_rank ?? 0,
    estimateMinutes: task.estimate_minutes,
    updatedAt: task.updated_at,
    projectName: task.projects?.name ?? "Unknown project",
    goalTitle: task.goals?.title ?? null,
  }));

  return {
    data: queue,
    errorMessage: null,
  };
}
