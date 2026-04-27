import { getWeekBounds, shiftIsoDateByDays } from "@/lib/review-week";
import { createClient } from "@/lib/supabase/server";
import { isMissingTasksBlockedReasonColumn } from "@/lib/supabase-error";
import { getTodayLocalIsoDate } from "@/lib/task-due-date";
import { isTaskCompletedStatus } from "@/lib/task-domain";

import { addTaskToToday } from "./today-planner-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const STARTUP_TASK_SELECT_WITH_BLOCKED_REASON =
  "id, title, blocked_reason, status, priority, due_date, planned_for_date, focus_rank, updated_at, projects(name, slug), goals(title)";
const STARTUP_TASK_SELECT_WITHOUT_BLOCKED_REASON =
  "id, title, status, priority, due_date, planned_for_date, focus_rank, updated_at, projects(name, slug), goals(title)";

type StartupTaskRow = {
  id: string;
  title: string;
  blocked_reason: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  planned_for_date: string | null;
  focus_rank: number | null;
  updated_at: string;
  projects: { name: string; slug: string } | null;
  goals: { title: string } | null;
};

type StartupReviewRow = {
  id: string;
  week_start: string;
  week_end: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  next_steps: string | null;
  updated_at: string;
};

export type StartupPlannerTask = {
  id: string;
  title: string;
  blockedReason: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  plannedForDate: string | null;
  focusRank: number | null;
  updatedAt: string;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
  isPlannedForToday: boolean;
};

export type StartupPlannerGoal = {
  id: string;
  title: string;
  status: string;
  health: string | null;
  nextStep: string | null;
  updatedAt: string;
  projectName: string | null;
  projectSlug: string | null;
  linkedOpenTaskCount: number;
};

export type StartupPlannerReview = {
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  nextSteps: string | null;
  updatedAt: string;
};

export type StartupPlannerData = {
  week: {
    weekStart: string;
    weekEnd: string;
    previousWeekStart: string;
    previousWeekEnd: string;
  };
  review: {
    currentWeek: StartupPlannerReview | null;
    latest: StartupPlannerReview | null;
  };
  blockersCarryForward: StartupPlannerTask[];
  keyGoals: StartupPlannerGoal[];
  focusTasks: StartupPlannerTask[];
  dueSoonTasks: StartupPlannerTask[];
  planThisWeekTasks: StartupPlannerTask[];
  todaySummary: {
    plannedCount: number;
    inProgressCount: number;
    blockedCount: number;
  };
};

function mapTaskRow(row: StartupTaskRow, todayIsoDate: string): StartupPlannerTask {
  return {
    id: row.id,
    title: row.title,
    blockedReason: row.blocked_reason ?? null,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date ?? null,
    plannedForDate: row.planned_for_date ?? null,
    focusRank: row.focus_rank ?? null,
    updatedAt: row.updated_at,
    projectName: row.projects?.name ?? "Unknown project",
    projectSlug: row.projects?.slug ?? null,
    goalTitle: row.goals?.title ?? null,
    isPlannedForToday: row.planned_for_date === todayIsoDate,
  };
}

function mapReviewRow(row: StartupReviewRow): StartupPlannerReview {
  return {
    id: row.id,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    summary: row.summary,
    wins: row.wins,
    blockers: row.blockers,
    nextSteps: row.next_steps,
    updatedAt: row.updated_at,
  };
}

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

async function queryTasksWithBlockedReasonFallback(
  supabase: SupabaseServerClient,
  buildQuery: (
    selectColumns: string,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ data: StartupTaskRow[]; errorMessage: string | null }> {
  const primary = await buildQuery(STARTUP_TASK_SELECT_WITH_BLOCKED_REASON);
  if (!primary.error) {
    return {
      data: (primary.data ?? []) as StartupTaskRow[],
      errorMessage: null,
    };
  }

  if (!isMissingTasksBlockedReasonColumn(primary.error)) {
    return {
      data: [],
      errorMessage: primary.error.message,
    };
  }

  const fallback = await buildQuery(STARTUP_TASK_SELECT_WITHOUT_BLOCKED_REASON);
  if (fallback.error) {
    return {
      data: [],
      errorMessage: fallback.error.message,
    };
  }

  return {
    data: (fallback.data as Omit<StartupTaskRow, "blocked_reason">[] | null ?? []).map((task) => ({
      ...task,
      blocked_reason: null,
    })),
    errorMessage: null,
  };
}

export async function getStartupPlannerData(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const today = getTodayLocalIsoDate(options?.now ?? new Date());
  const weekBounds = getWeekBounds(today);

  if (!weekBounds) {
    return {
      errorMessage: "Could not resolve weekly startup window.",
      data: null,
    };
  }

  const previousWeekBounds = getWeekBounds(shiftIsoDateByDays(today, -7));

  if (!previousWeekBounds) {
    return {
      errorMessage: "Could not resolve previous review window.",
      data: null,
    };
  }

  const [blockedResult, focusResult, dueSoonResult, goalsResult, goalTaskCountsResult, todayTasksResult, currentWeekReviewResult, latestReviewResult] =
    await Promise.all([
      queryTasksWithBlockedReasonFallback(supabase, (selectColumns) =>
        supabase
          .from("tasks")
          .select(selectColumns)
          .eq("status", "blocked")
          .order("updated_at", { ascending: false })
          .limit(8),
      ),
      queryTasksWithBlockedReasonFallback(supabase, (selectColumns) =>
        supabase
          .from("tasks")
          .select(selectColumns)
          .not("focus_rank", "is", null)
          .neq("status", "done")
          .order("focus_rank", { ascending: true })
          .order("updated_at", { ascending: false })
          .limit(8),
      ),
      queryTasksWithBlockedReasonFallback(supabase, (selectColumns) =>
        supabase
          .from("tasks")
          .select(selectColumns)
          .neq("status", "done")
          .gte("due_date", today)
          .lte("due_date", weekBounds.weekEnd)
          .order("due_date", { ascending: true })
          .order("updated_at", { ascending: false })
          .limit(8),
      ),
      supabase
        .from("goals")
        .select("id, title, status, health, next_step, updated_at, projects(name, slug)")
        .neq("status", "done")
        .order("updated_at", { ascending: false })
        .limit(6),
      supabase
        .from("tasks")
        .select("goal_id")
        .neq("status", "done")
        .not("goal_id", "is", null),
      supabase
        .from("tasks")
        .select("id, status")
        .eq("planned_for_date", today),
      supabase
        .from("week_reviews")
        .select("id, week_start, week_end, summary, wins, blockers, next_steps, updated_at")
        .eq("week_start", weekBounds.weekStart)
        .eq("week_end", weekBounds.weekEnd)
        .order("updated_at", { ascending: false })
        .maybeSingle(),
      supabase
        .from("week_reviews")
        .select("id, week_start, week_end, summary, wins, blockers, next_steps, updated_at")
        .order("week_start", { ascending: false })
        .order("updated_at", { ascending: false })
        .maybeSingle(),
    ]);

  if (blockedResult.errorMessage || focusResult.errorMessage || dueSoonResult.errorMessage) {
    return {
      errorMessage: "Could not load startup planning tasks right now.",
      data: null,
    };
  }

  if (goalsResult.error || goalTaskCountsResult.error || todayTasksResult.error) {
    return {
      errorMessage: "Could not load startup planning goals right now.",
      data: null,
    };
  }

  if (currentWeekReviewResult.error || latestReviewResult.error) {
    return {
      errorMessage: "Could not load startup planning review context.",
      data: null,
    };
  }

  const blockersCarryForward = blockedResult.data.map((row) => mapTaskRow(row, today));
  const focusTasks = focusResult.data.map((row) => mapTaskRow(row, today));
  const dueSoonTasks = dueSoonResult.data.map((row) => mapTaskRow(row, today));

  const planThisWeekTaskById = new Map<string, StartupPlannerTask>();
  for (const task of [...focusTasks, ...dueSoonTasks, ...blockersCarryForward]) {
    if (!planThisWeekTaskById.has(task.id)) {
      planThisWeekTaskById.set(task.id, task);
    }
  }

  const goalOpenTaskCounts = (goalTaskCountsResult.data ?? []).reduce<Map<string, number>>(
    (counts, task) => {
      if (!task.goal_id) {
        return counts;
      }
      counts.set(task.goal_id, (counts.get(task.goal_id) ?? 0) + 1);
      return counts;
    },
    new Map(),
  );

  const keyGoals: StartupPlannerGoal[] = (goalsResult.data ?? []).map((goal) => ({
    id: goal.id,
    title: goal.title,
    status: goal.status,
    health: goal.health,
    nextStep: goal.next_step,
    updatedAt: goal.updated_at,
    projectName: goal.projects?.name ?? null,
    projectSlug: goal.projects?.slug ?? null,
    linkedOpenTaskCount: goalOpenTaskCounts.get(goal.id) ?? 0,
  }));

  const todaySummary = (todayTasksResult.data ?? []).reduce(
    (summary, task) => {
      if (isTaskCompletedStatus(task.status)) {
        return summary;
      }
      if (task.status === "in_progress") {
        summary.inProgressCount += 1;
      } else if (task.status === "blocked") {
        summary.blockedCount += 1;
      } else {
        summary.plannedCount += 1;
      }
      return summary;
    },
    {
      plannedCount: 0,
      inProgressCount: 0,
      blockedCount: 0,
    },
  );

  return {
    errorMessage: null,
    data: {
      week: {
        weekStart: weekBounds.weekStart,
        weekEnd: weekBounds.weekEnd,
        previousWeekStart: previousWeekBounds.weekStart,
        previousWeekEnd: previousWeekBounds.weekEnd,
      },
      review: {
        currentWeek: currentWeekReviewResult.data
          ? mapReviewRow(currentWeekReviewResult.data as StartupReviewRow)
          : null,
        latest: latestReviewResult.data ? mapReviewRow(latestReviewResult.data as StartupReviewRow) : null,
      },
      blockersCarryForward,
      keyGoals,
      focusTasks,
      dueSoonTasks,
      planThisWeekTasks: [...planThisWeekTaskById.values()].slice(0, 8),
      todaySummary,
    } satisfies StartupPlannerData,
  };
}

export async function planStartupTasksForToday(
  taskIds: string[],
  options?: { supabase?: SupabaseServerClient; now?: Date },
) {
  const uniqueTaskIds = [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
  if (uniqueTaskIds.length === 0) {
    return {
      errorMessage: "Choose at least one task to plan for Today.",
      addedCount: 0,
    };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  let addedCount = 0;

  for (const taskId of uniqueTaskIds) {
    const result = await addTaskToToday(taskId, {
      supabase,
      now: options?.now,
    });

    if (result.errorMessage) {
      return {
        errorMessage: result.errorMessage,
        addedCount,
      };
    }

    addedCount += 1;
  }

  return {
    errorMessage: null,
    addedCount,
  };
}
