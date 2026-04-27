import { getWeekBounds, shiftIsoDateByDays } from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";
import { isMissingTasksBlockedReasonColumn } from "@/lib/supabase-error";
import { getTodayLocalIsoDate } from "@/lib/task-due-date";
import { isTaskCompletedStatus } from "@/lib/task-domain";
import {
  getTodayPlannerData,
  type TodayPlannerData,
  type TodayPlannerTask,
} from "@/lib/services/today-planner-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type ShutdownTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  plannedForDate: string | null;
  blockedReason: string | null;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
};

type DueSoonTaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  planned_for_date: string | null;
  blocked_reason: string | null;
  projects: { name: string; slug: string } | null;
  goals: { title: string } | null;
};

type CurrentWeekReview = {
  id: string;
  summary: string | null;
  nextSteps: string | null;
  updatedAt: string;
};

export type ShutdownData = {
  date: string;
  tomorrowDate: string;
  summary: {
    completedCount: number;
    unfinishedCount: number;
    blockerCount: number;
    trackedTodayLabel: string;
  };
  completedWork: ShutdownTask[];
  unfinishedCarryForward: ShutdownTask[];
  blockers: ShutdownTask[];
  tomorrowShortlist: ShutdownTask[];
  currentWeekReview: CurrentWeekReview | null;
};

function mapTodayTaskToShutdownTask(task: TodayPlannerTask): ShutdownTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.dueDate,
    plannedForDate: task.plannedForDate,
    blockedReason: task.blockedReason,
    projectName: task.projectName,
    projectSlug: task.projectSlug,
    goalTitle: task.goalTitle,
  };
}

function mapDueSoonTaskRow(task: DueSoonTaskRow): ShutdownTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.due_date,
    plannedForDate: task.planned_for_date,
    blockedReason: task.blocked_reason,
    projectName: task.projects?.name ?? "Unknown project",
    projectSlug: task.projects?.slug ?? null,
    goalTitle: task.goals?.title ?? null,
  };
}

function buildShortlist(
  todayData: TodayPlannerData,
  dueSoonTasks: ShutdownTask[],
  tomorrowDate: string,
) {
  const carryForwardIds = new Set(
    [...todayData.planned, ...todayData.inProgress, ...todayData.blocked].map((task) => task.id),
  );
  const shortlistById = new Map<string, ShutdownTask>();
  const suggestionSources = [...todayData.suggestions.pinned, ...todayData.suggestions.inProgress];

  for (const task of suggestionSources) {
    if (isTaskCompletedStatus(task.status) || carryForwardIds.has(task.id)) {
      continue;
    }

    shortlistById.set(task.id, mapTodayTaskToShutdownTask(task));
  }

  for (const task of dueSoonTasks) {
    if (
      isTaskCompletedStatus(task.status) ||
      carryForwardIds.has(task.id) ||
      task.plannedForDate === tomorrowDate
    ) {
      continue;
    }

    if (!shortlistById.has(task.id)) {
      shortlistById.set(task.id, task);
    }
  }

  return [...shortlistById.values()].slice(0, 8);
}

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

async function queryDueSoonTaskRows(
  supabase: SupabaseServerClient,
  today: string,
  dueSoonEndDate: string,
) {
  const primaryResult = await supabase
    .from("tasks")
    .select(
      "id, title, status, due_date, planned_for_date, blocked_reason, projects(name, slug), goals(title)",
    )
    .neq("status", "done")
    .gte("due_date", today)
    .lte("due_date", dueSoonEndDate)
    .order("due_date", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(12);

  if (!primaryResult.error) {
    return {
      data: (primaryResult.data ?? []) as DueSoonTaskRow[],
      errorMessage: null,
    };
  }

  if (!isMissingTasksBlockedReasonColumn(primaryResult.error)) {
    return {
      data: [] as DueSoonTaskRow[],
      errorMessage: primaryResult.error.message,
    };
  }

  const fallbackResult = await supabase
    .from("tasks")
    .select("id, title, status, due_date, planned_for_date, projects(name, slug), goals(title)")
    .neq("status", "done")
    .gte("due_date", today)
    .lte("due_date", dueSoonEndDate)
    .order("due_date", { ascending: true })
    .order("updated_at", { ascending: false })
    .limit(12);

  if (fallbackResult.error) {
    return {
      data: [] as DueSoonTaskRow[],
      errorMessage: fallbackResult.error.message,
    };
  }

  return {
    data: (fallbackResult.data ?? []).map((task) => ({
      ...task,
      blocked_reason: null,
    })) as DueSoonTaskRow[],
    errorMessage: null,
  };
}

async function getCurrentWeekReview(
  supabase: SupabaseServerClient,
  today: string,
): Promise<{ data: CurrentWeekReview | null; errorMessage: string | null }> {
  const weekBounds = getWeekBounds(today);
  if (!weekBounds) {
    return { data: null, errorMessage: "Unable to resolve the current week." };
  }

  const { data, error } = await supabase
    .from("week_reviews")
    .select("id, summary, next_steps, updated_at")
    .eq("week_start", weekBounds.weekStart)
    .eq("week_end", weekBounds.weekEnd)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      data: null,
      errorMessage: "Unable to load this week's review context right now.",
    };
  }

  if (!data) {
    return { data: null, errorMessage: null };
  }

  return {
    data: {
      id: data.id,
      summary: data.summary ?? null,
      nextSteps: data.next_steps ?? null,
      updatedAt: data.updated_at,
    },
    errorMessage: null,
  };
}

export async function getShutdownData(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
  todayPlannerResult?: { errorMessage: string | null; data: TodayPlannerData | null };
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const now = options?.now ?? new Date();
  const today = getTodayLocalIsoDate(now);
  const tomorrowDate = shiftIsoDateByDays(today, 1);
  const dueSoonEndDate = shiftIsoDateByDays(today, 2);

  const todayResult =
    options?.todayPlannerResult ??
    (await getTodayPlannerData({
      supabase,
      now,
    }));

  if (todayResult.errorMessage || !todayResult.data) {
    return {
      errorMessage: todayResult.errorMessage ?? "Could not load shutdown data right now.",
      data: null,
    };
  }

  const [dueSoonRowsResult, currentWeekReviewResult] = await Promise.all([
    queryDueSoonTaskRows(supabase, today, dueSoonEndDate),
    getCurrentWeekReview(supabase, today),
  ]);

  if (dueSoonRowsResult.errorMessage) {
    return {
      errorMessage: "Could not load due-soon tasks for shutdown.",
      data: null,
    };
  }

  if (currentWeekReviewResult.errorMessage) {
    return {
      errorMessage: currentWeekReviewResult.errorMessage,
      data: null,
    };
  }

  const completedWork = todayResult.data.completed.map(mapTodayTaskToShutdownTask);
  const unfinishedCarryForward = [
    ...todayResult.data.planned,
    ...todayResult.data.inProgress,
    ...todayResult.data.blocked,
  ].map(mapTodayTaskToShutdownTask);
  const blockers = todayResult.data.blocked.map(mapTodayTaskToShutdownTask);
  const dueSoonTasks = dueSoonRowsResult.data.map(mapDueSoonTaskRow);
  const tomorrowShortlist = buildShortlist(todayResult.data, dueSoonTasks, tomorrowDate);

  return {
    errorMessage: null,
    data: {
      date: today,
      tomorrowDate,
      summary: {
        completedCount: completedWork.length,
        unfinishedCount: unfinishedCarryForward.length,
        blockerCount: blockers.length,
        trackedTodayLabel: todayResult.data.summary.trackedTodayLabel,
      },
      completedWork,
      unfinishedCarryForward,
      blockers,
      tomorrowShortlist,
      currentWeekReview: currentWeekReviewResult.data,
    } satisfies ShutdownData,
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
      errorMessage: "Unable to verify task scope right now.",
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

export async function queueTaskForTomorrow(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; now?: Date },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const scope = await getOwnedTaskById(taskId, supabase);

  if (scope.errorMessage || !scope.taskId) {
    return { errorMessage: scope.errorMessage ?? "Task is unavailable." };
  }

  const today = getTodayLocalIsoDate(options?.now ?? new Date());
  const tomorrowDate = shiftIsoDateByDays(today, 1);
  const { error } = await supabase
    .from("tasks")
    .update({
      planned_for_date: tomorrowDate,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scope.taskId);

  if (error) {
    return { errorMessage: "Unable to queue this task for tomorrow right now." };
  }

  return { errorMessage: null, tomorrowDate };
}

export async function saveShutdownReflectionNote(
  note: string,
  options?: { supabase?: SupabaseServerClient; now?: Date },
) {
  const normalizedNote = note.trim();
  if (!normalizedNote) {
    return { errorMessage: "Reflection note is required." };
  }

  if (normalizedNote.length > 320) {
    return { errorMessage: "Reflection note must be 320 characters or less." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const today = getTodayLocalIsoDate(options?.now ?? new Date());
  const weekBounds = getWeekBounds(today);

  if (!weekBounds) {
    return { errorMessage: "Unable to resolve this week's review." };
  }

  const noteLine = `[Shutdown ${today}] ${normalizedNote}`;
  const { data: existingReviews, error: existingError } = await supabase
    .from("week_reviews")
    .select("id, next_steps")
    .eq("week_start", weekBounds.weekStart)
    .eq("week_end", weekBounds.weekEnd)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (existingError) {
    return { errorMessage: "Unable to load this week's review right now." };
  }

  const existing = existingReviews?.[0] ?? null;

  if (existing) {
    const previous = existing.next_steps?.trim() ?? "";
    const nextSteps = previous ? `${previous}\n\n${noteLine}` : noteLine;
    const { error } = await supabase
      .from("week_reviews")
      .update({
        next_steps: nextSteps,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) {
      return { errorMessage: "Unable to save shutdown reflection right now." };
    }

    return { errorMessage: null };
  }

  const { error } = await supabase.from("week_reviews").insert({
    week_start: weekBounds.weekStart,
    week_end: weekBounds.weekEnd,
    next_steps: noteLine,
  });

  if (error) {
    return { errorMessage: "Unable to save shutdown reflection right now." };
  }

  return { errorMessage: null };
}
