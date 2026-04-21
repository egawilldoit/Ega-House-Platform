import { createClient } from "@/lib/supabase/server";
import { getTodayLocalIsoDate } from "@/lib/task-due-date";
import { TASK_STATUS_VALUES, isTaskStatus, type TaskStatus } from "@/lib/task-domain";
import { getActiveTimerSession, getTimerSummary } from "@/lib/services/timer-service";
import { updateTaskInline, validateTaskInlineUpdateInput } from "@/lib/services/task-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const SUGGESTION_LIMIT = 6;

type TodayTaskRow = {
  id: string;
  title: string;
  description: string | null;
  blocked_reason: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  estimate_minutes: number | null;
  focus_rank: number | null;
  planned_for_date: string | null;
  updated_at: string;
  projects: { name: string; slug: string } | null;
  goals: { title: string } | null;
};

export type TodayPlannerTask = {
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: TaskStatus;
  priority: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  focusRank: number | null;
  plannedForDate: string | null;
  updatedAt: string;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
  hasActiveTimer: boolean;
  isDueToday: boolean;
  isPlannedForToday: boolean;
};

export type TodayPlannerData = {
  date: string;
  planned: TodayPlannerTask[];
  inProgress: TodayPlannerTask[];
  blocked: TodayPlannerTask[];
  completed: TodayPlannerTask[];
  suggestions: {
    pinned: TodayPlannerTask[];
    inProgress: TodayPlannerTask[];
  };
  summary: {
    plannedCount: number;
    inProgressCount: number;
    blockedCount: number;
    completedCount: number;
    clearableCompletedCount: number;
    totalEstimateMinutes: number;
    trackedTodaySeconds: number;
    trackedTodayLabel: string;
  };
  activeTimer: {
    sessionId: string;
    taskId: string;
  } | null;
};

function isKnownTaskStatus(value: string): value is TaskStatus {
  return isTaskStatus(value);
}

function mapTaskRow(row: TodayTaskRow, activeTaskId: string | null, today: string): TodayPlannerTask | null {
  if (!isKnownTaskStatus(row.status)) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    blockedReason: row.blocked_reason ?? null,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    estimateMinutes: row.estimate_minutes,
    focusRank: row.focus_rank,
    plannedForDate: row.planned_for_date,
    updatedAt: row.updated_at,
    projectName: row.projects?.name ?? "Unknown project",
    projectSlug: row.projects?.slug ?? null,
    goalTitle: row.goals?.title ?? null,
    hasActiveTimer: row.id === activeTaskId,
    isDueToday: row.due_date === today,
    isPlannedForToday: row.planned_for_date === today,
  };
}

function sortTodayTasks(left: TodayPlannerTask, right: TodayPlannerTask) {
  if (left.hasActiveTimer !== right.hasActiveTimer) {
    return left.hasActiveTimer ? -1 : 1;
  }

  if (left.focusRank !== null && right.focusRank !== null && left.focusRank !== right.focusRank) {
    return left.focusRank - right.focusRank;
  }

  if ((left.focusRank !== null) !== (right.focusRank !== null)) {
    return left.focusRank !== null ? -1 : 1;
  }

  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate);
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function sortSuggestionTasks(left: TodayPlannerTask, right: TodayPlannerTask) {
  if (left.focusRank !== null && right.focusRank !== null && left.focusRank !== right.focusRank) {
    return left.focusRank - right.focusRank;
  }

  if ((left.focusRank !== null) !== (right.focusRank !== null)) {
    return left.focusRank !== null ? -1 : 1;
  }

  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate);
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
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
      supabase
        .from("tasks")
        .select(
          "id, title, description, blocked_reason, status, priority, due_date, estimate_minutes, focus_rank, planned_for_date, updated_at, projects(name, slug), goals(title)",
        )
        .or(`planned_for_date.eq.${today},due_date.eq.${today}`)
        .order("updated_at", { ascending: false })
        .limit(240),
      supabase
        .from("tasks")
        .select(
          "id, title, description, blocked_reason, status, priority, due_date, estimate_minutes, focus_rank, planned_for_date, updated_at, projects(name, slug), goals(title)",
        )
        .not("focus_rank", "is", null)
        .neq("status", "done")
        .order("focus_rank", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(80),
      supabase
        .from("tasks")
        .select(
          "id, title, description, blocked_reason, status, priority, due_date, estimate_minutes, focus_rank, planned_for_date, updated_at, projects(name, slug), goals(title)",
        )
        .eq("status", "in_progress")
        .order("updated_at", { ascending: false })
        .limit(80),
      options?.activeTimerResult ? Promise.resolve(options.activeTimerResult) : getActiveTimerSession(),
      options?.timerSummaryResult ? Promise.resolve(options.timerSummaryResult) : getTimerSummary({ limit: 120 }),
    ]);

  if (selectedResult.error) {
    return { errorMessage: "Could not load Today plan right now.", data: null };
  }

  if (pinnedResult.error || inProgressResult.error) {
    return { errorMessage: "Could not load Today suggestions right now.", data: null };
  }

  const activeTaskId = activeTimerResult.data?.taskId ?? null;

  const selectedTasksById = new Map<string, TodayPlannerTask>();
  for (const row of (selectedResult.data ?? []) as TodayTaskRow[]) {
    const mapped = mapTaskRow(row, activeTaskId, today);
    if (!mapped) {
      continue;
    }

    if (!selectedTasksById.has(mapped.id)) {
      selectedTasksById.set(mapped.id, mapped);
    }
  }

  const selectedTasks = [...selectedTasksById.values()];

  const selectedTaskIds = new Set(selectedTasks.map((task) => task.id));

  const planned = selectedTasks.filter((task) => task.status === "todo").sort(sortTodayTasks);
  const inProgress = selectedTasks
    .filter((task) => task.status === "in_progress")
    .sort(sortTodayTasks);
  const blocked = selectedTasks.filter((task) => task.status === "blocked").sort(sortTodayTasks);
  const completed = selectedTasks.filter((task) => task.status === "done").sort(sortTodayTasks);
  const clearableCompletedCount = completed.filter((task) => task.isPlannedForToday).length;

  const toSuggestionSlice = (rows: TodayTaskRow[]) =>
    rows
      .map((row) => mapTaskRow(row, activeTaskId, today))
      .filter((task): task is TodayPlannerTask => task !== null)
      .filter((task) => !selectedTaskIds.has(task.id) && task.status !== "done")
      .sort(sortSuggestionTasks)
      .slice(0, SUGGESTION_LIMIT);

  const suggestions = {
    pinned: toSuggestionSlice((pinnedResult.data ?? []) as TodayTaskRow[]),
    inProgress: toSuggestionSlice((inProgressResult.data ?? []) as TodayTaskRow[]),
  };

  const totalEstimateMinutes = selectedTasks.reduce(
    (sum, task) => sum + (task.estimateMinutes ?? 0),
    0,
  );

  const trackedTodaySeconds = timerSummaryResult.data?.trackedTodaySeconds ?? 0;
  const trackedTodayLabel = timerSummaryResult.data?.trackedTodayLabel ?? "0m";

  return {
    errorMessage: null,
    data: {
      date: today,
      planned,
      inProgress,
      blocked,
      completed,
      suggestions,
      summary: {
        plannedCount: planned.length,
        inProgressCount: inProgress.length,
        blockedCount: blocked.length,
        completedCount: completed.length,
        clearableCompletedCount,
        totalEstimateMinutes,
        trackedTodaySeconds,
        trackedTodayLabel,
      },
      activeTimer: activeTaskId && activeTimerResult.data
        ? {
            sessionId: activeTimerResult.data.sessionId,
            taskId: activeTaskId,
          }
        : null,
    } satisfies TodayPlannerData,
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

  const today = getTodayLocalIsoDate(options?.now ?? new Date());
  const { error } = await supabase
    .from("tasks")
    .update({
      planned_for_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scope.taskId);

  if (error) {
    return { errorMessage: "Unable to add task to Today right now." };
  }

  return { errorMessage: null };
}

export async function removeTaskFromToday(taskId: string, options?: {
  supabase?: SupabaseServerClient;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const scope = await getOwnedTaskById(taskId, supabase);

  if (scope.errorMessage || !scope.taskId) {
    return { errorMessage: scope.errorMessage ?? "Task is unavailable." };
  }

  const { error } = await supabase
    .from("tasks")
    .update({
      planned_for_date: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scope.taskId);

  if (error) {
    return { errorMessage: "Unable to remove task from Today right now." };
  }

  return { errorMessage: null };
}

export async function updateTodayTaskStatus(
  taskId: string,
  status: string,
  options?: { supabase?: SupabaseServerClient },
) {
  if (!TASK_STATUS_VALUES.includes(status as TaskStatus)) {
    return { errorMessage: `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.` };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const scope = await getOwnedTaskById(taskId, supabase);

  if (scope.errorMessage || !scope.taskId) {
    return { errorMessage: scope.errorMessage ?? "Task is unavailable." };
  }

  const { data: taskData, error: taskLoadError } = await supabase
    .from("tasks")
    .select("status, priority, due_date, estimate_minutes, blocked_reason")
    .eq("id", scope.taskId)
    .maybeSingle();

  if (taskLoadError || !taskData) {
    return { errorMessage: "Unable to load task details right now." };
  }

  const validationResult = validateTaskInlineUpdateInput({
    taskId: scope.taskId,
    status,
    priority: taskData.priority,
    dueDate: taskData.due_date,
    estimateMinutes: taskData.estimate_minutes,
    blockedReason: status === "blocked" ? taskData.blocked_reason : null,
  });

  if (validationResult.errorMessage || !validationResult.data) {
    return {
      errorMessage:
        validationResult.errorMessage ?? "Task status update request is invalid.",
    };
  }

  const updateResult = await updateTaskInline(validationResult.data, {
    supabase,
  });

  if (updateResult.errorMessage) {
    return { errorMessage: updateResult.errorMessage };
  }

  return { errorMessage: null };
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
    .eq("status", "done")
    .eq("planned_for_date", today);

  if (error) {
    return { errorMessage: "Unable to clear completed Today items right now." };
  }

  return { errorMessage: null };
}
