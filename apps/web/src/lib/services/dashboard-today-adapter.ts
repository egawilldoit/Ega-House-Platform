import {
  getTodayPlannerData,
  type TodayPlannerData,
  type TodayPlannerTask,
} from "@/lib/services/today-planner-service";
import {
  calculateExecutionEvidenceForWindow,
  type ExecutionEvidenceSessionRow,
} from "@/lib/services/execution-evidence-service";
import { getActiveTasksForOwner, getTaskForOwner } from "@/lib/services/task-read-service";
import { createClient } from "@/lib/supabase/server";
import { isTaskPinned } from "@/lib/focus-queue";
import { getTaskDueDateState, getTodayLocalIsoDate } from "@/lib/task-due-date";
import { getCurrentDayWindow } from "@/lib/task-session";
import { isTaskCompletedStatus, isTaskStatus } from "@/lib/task-domain";

export type DashboardTodayTask = {
  id: string;
  title: string;
  blockedReason: string | null;
  status: string;
  priority: string;
  focusRank: number | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  updatedAt: string;
  completedAt: string | null;
  projectName: string;
  goalTitle: string | null;
};

export type DashboardTodayPlanner = {
  date: string;
  startHere: DashboardTodayTask | null;
  focusQueue: DashboardTodayTask[];
  plannedToday: DashboardTodayTask[];
  planned: DashboardTodayTask[];
  inProgress: DashboardTodayTask[];
  blocked: DashboardTodayTask[];
  completed: DashboardTodayTask[];
  suggestions: {
    pinned: DashboardTodayTask[];
    inProgress: DashboardTodayTask[];
  };
  summary: TodayPlannerData["summary"];
  activeTimer: TodayPlannerData["activeTimer"];
  all: DashboardTodayTask[];
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type DashboardVisibleTask = TodayPlannerTask & {
  trackedTodaySeconds?: number;
  dashboardPrecedence?: number;
};

const DASHBOARD_TASK_LIMIT = 120;
const PRECEDENCE = {
  activeTimer: 0,
  inProgress: 1,
  blocked: 2,
  plannedToday: 3,
  focusOrSuggestion: 4,
  overdueOrDue: 5,
  trackedToday: 6,
  completedToday: 7,
} as const;

export function mapTodayPlannerTaskToDashboardTask(
  task: TodayPlannerTask,
): DashboardTodayTask {
  return {
    id: task.id,
    title: task.title,
    blockedReason: task.blockedReason,
    status: task.status,
    priority: task.priority,
    focusRank: task.focusRank,
    dueDate: task.dueDate,
    estimateMinutes: task.estimateMinutes,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    projectName: task.projectName,
    goalTitle: task.goalTitle,
  };
}

function getCompletedDate(task: TodayPlannerTask) {
  return (task.completedAt ?? task.updatedAt).slice(0, 10);
}

function getDashboardVisibilityPrecedence(
  task: TodayPlannerTask,
  options: {
    today: string;
    suggestionTaskIds: Set<string>;
    trackedTodaySecondsByTask: Map<string, number>;
  },
) {
  if (task.hasActiveTimer) {
    return PRECEDENCE.activeTimer;
  }

  if (task.status === "in_progress") {
    return PRECEDENCE.inProgress;
  }

  if (task.status === "blocked") {
    return PRECEDENCE.blocked;
  }

  if (task.isPlannedForToday) {
    return PRECEDENCE.plannedToday;
  }

  if (isTaskPinned(task.focusRank) || options.suggestionTaskIds.has(task.id)) {
    return PRECEDENCE.focusOrSuggestion;
  }

  if (task.dueBucket === "overdue" || task.dueBucket === "today") {
    return PRECEDENCE.overdueOrDue;
  }

  if ((options.trackedTodaySecondsByTask.get(task.id) ?? 0) > 0) {
    return PRECEDENCE.trackedToday;
  }

  if (isTaskCompletedStatus(task.status) && getCompletedDate(task) === options.today) {
    return PRECEDENCE.completedToday;
  }

  return null;
}

function compareDashboardVisibleTasks(left: DashboardVisibleTask, right: DashboardVisibleTask) {
  const precedenceDelta =
    (left.dashboardPrecedence ?? Number.MAX_SAFE_INTEGER) -
    (right.dashboardPrecedence ?? Number.MAX_SAFE_INTEGER);
  if (precedenceDelta !== 0) {
    return precedenceDelta;
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

function dedupeDashboardVisibleTasks(tasks: DashboardVisibleTask[]) {
  const tasksById = new Map<string, DashboardVisibleTask>();

  for (const task of tasks) {
    const existing = tasksById.get(task.id);
    if (!existing) {
      tasksById.set(task.id, task);
      continue;
    }

    const existingPrecedence = existing.dashboardPrecedence ?? Number.MAX_SAFE_INTEGER;
    const taskPrecedence = task.dashboardPrecedence ?? Number.MAX_SAFE_INTEGER;
    if (taskPrecedence < existingPrecedence) {
      tasksById.set(task.id, task);
    }
  }

  return [...tasksById.values()].sort(compareDashboardVisibleTasks);
}

function mapSupplementalRowToTodayTask(
  row: Awaited<ReturnType<typeof getActiveTasksForOwner>>["data"][number],
  options: {
    activeTaskId: string | null;
    today: string;
  },
): TodayPlannerTask | null {
  if (!isTaskStatus(row.status) && !isTaskCompletedStatus(row.status)) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    blockedReason: row.blocked_reason ?? null,
    status: isTaskStatus(row.status) ? row.status : "done",
    priority: row.priority,
    dueDate: row.due_date,
    estimateMinutes: row.estimate_minutes,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    focusRank: row.focus_rank,
    plannedForDate: row.planned_for_date,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    projectName: row.projects?.name ?? "Unknown project",
    projectSlug: row.projects?.slug ?? null,
    goalTitle: row.goals?.title ?? null,
    hasActiveTimer: row.id === options.activeTaskId,
    isDueToday: row.due_date === options.today,
    isPlannedForToday: row.planned_for_date === options.today,
    dueBucket: getTaskDueDateState(row.due_date, row.status, options.today),
  };
}

function getSuggestionTaskIds(planner: TodayPlannerData) {
  return new Set([
    ...planner.focusQueue.map((task) => task.id),
    ...planner.suggestions.pinned.map((task) => task.id),
    ...planner.suggestions.inProgress.map((task) => task.id),
  ]);
}

export function getDashboardVisiblePlannerTasks(
  planner: TodayPlannerData,
  supplementalTasks: TodayPlannerTask[] = [],
  options?: {
    trackedTodaySecondsByTask?: Map<string, number>;
  },
) {
  const suggestionTaskIds = getSuggestionTaskIds(planner);
  const trackedTodaySecondsByTask = options?.trackedTodaySecondsByTask ?? new Map<string, number>();
  const candidates = [
    ...planner.planned,
    ...planner.inProgress,
    ...planner.blocked,
    ...planner.completed,
    ...planner.focusQueue,
    ...planner.plannedToday,
    ...planner.suggestions.pinned,
    ...planner.suggestions.inProgress,
    ...supplementalTasks,
  ];
  const visible: DashboardVisibleTask[] = [];

  for (const task of candidates) {
    const dashboardPrecedence = getDashboardVisibilityPrecedence(task, {
      today: planner.date,
      suggestionTaskIds,
      trackedTodaySecondsByTask,
    });

    if (dashboardPrecedence === null) {
      continue;
    }

    visible.push({
      ...task,
      trackedTodaySeconds: trackedTodaySecondsByTask.get(task.id) ?? 0,
      dashboardPrecedence,
    });
  }

  return dedupeDashboardVisibleTasks(visible);
}

export function mapTodayPlannerDataToDashboardPlanner(
  planner: TodayPlannerData,
  supplementalTasks: TodayPlannerTask[] = [],
  options?: {
    trackedTodaySecondsByTask?: Map<string, number>;
  },
): DashboardTodayPlanner {
  const allTasks = getDashboardVisiblePlannerTasks(planner, supplementalTasks, options);
  const planned = allTasks
    .filter(
      (task) =>
        !isTaskCompletedStatus(task.status) && task.status === "todo" && !task.hasActiveTimer,
    )
    .map(mapTodayPlannerTaskToDashboardTask);
  const inProgress = allTasks
    .filter(
      (task) =>
        !isTaskCompletedStatus(task.status) &&
        (task.status === "in_progress" || task.hasActiveTimer),
    )
    .map(mapTodayPlannerTaskToDashboardTask);
  const blocked = allTasks
    .filter((task) => !isTaskCompletedStatus(task.status) && task.status === "blocked")
    .map(mapTodayPlannerTaskToDashboardTask);
  const completed = allTasks
    .filter((task) => isTaskCompletedStatus(task.status))
    .map(mapTodayPlannerTaskToDashboardTask);
  const all = allTasks.map(mapTodayPlannerTaskToDashboardTask);

  return {
    date: planner.date,
    startHere: planner.startHere ? mapTodayPlannerTaskToDashboardTask(planner.startHere) : null,
    focusQueue: planner.focusQueue.map(mapTodayPlannerTaskToDashboardTask),
    plannedToday: planner.plannedToday.map(mapTodayPlannerTaskToDashboardTask),
    planned,
    inProgress,
    blocked,
    completed,
    suggestions: {
      pinned: planner.suggestions.pinned.map(mapTodayPlannerTaskToDashboardTask),
      inProgress: planner.suggestions.inProgress.map(mapTodayPlannerTaskToDashboardTask),
    },
    summary: planner.summary,
    activeTimer: planner.activeTimer,
    all,
  };
}

async function getDashboardTodaySessionEvidence(
  supabase: SupabaseServerClient,
  now: Date,
) {
  const todayWindow = getCurrentDayWindow(now);
  const nextDayStartIso = new Date(
    new Date(todayWindow.startIso).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await supabase
    .from("task_sessions")
    .select("task_id, started_at, ended_at, duration_seconds")
    .lt("started_at", nextDayStartIso)
    .or(`ended_at.gte.${todayWindow.startIso},ended_at.is.null`);

  if (error) {
    return { data: null, errorMessage: error.message };
  }

  const evidence = calculateExecutionEvidenceForWindow(
    (data ?? []) as ExecutionEvidenceSessionRow[],
    todayWindow,
    { nowIso: now.toISOString() },
  );

  return {
    data: evidence.trackedSecondsByTask,
    errorMessage: null,
  };
}

async function getSupplementalDashboardTasks(options: {
  supabase: SupabaseServerClient;
  planner: TodayPlannerData;
  now: Date;
  trackedTodaySecondsByTask: Map<string, number>;
}) {
  const activeTaskId = options.planner.activeTimer?.taskId ?? null;
  const today = getTodayLocalIsoDate(options.now);
  const latestResult = await getActiveTasksForOwner({
    supabase: options.supabase,
    orderByUpdatedAt: false,
    applyQuery(query) {
      return query.order("updated_at", { ascending: false }).limit(DASHBOARD_TASK_LIMIT);
    },
  });

  if (latestResult.errorMessage) {
    return { data: [], errorMessage: latestResult.errorMessage };
  }

  const rowsById = new Map(latestResult.data.map((row) => [row.id, row]));
  const requiredTaskIds = new Set([
    ...(activeTaskId ? [activeTaskId] : []),
    ...options.trackedTodaySecondsByTask.keys(),
  ]);

  for (const taskId of requiredTaskIds) {
    if (rowsById.has(taskId)) {
      continue;
    }

    const taskResult = await getTaskForOwner(taskId, { supabase: options.supabase });
    if (taskResult.errorMessage) {
      return { data: [], errorMessage: taskResult.errorMessage };
    }
    if (taskResult.data) {
      rowsById.set(taskResult.data.id, taskResult.data);
    }
  }

  return {
    data: [...rowsById.values()]
      .map((row) => mapSupplementalRowToTodayTask(row, { activeTaskId, today }))
      .filter((task): task is TodayPlannerTask => task !== null),
    errorMessage: null,
  };
}

export async function getDashboardTodayPlannerData(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
}) {
  const supabase = options?.supabase ?? (await createClient());
  const now = options?.now ?? new Date();
  const result = await getTodayPlannerData({ supabase, now });

  if (result.errorMessage || !result.data) {
    return {
      data: null,
      errorMessage: result.errorMessage ?? "Could not load Today plan right now.",
    };
  }

  const evidenceResult = await getDashboardTodaySessionEvidence(supabase, now);
  if (evidenceResult.errorMessage || !evidenceResult.data) {
    return {
      data: null,
      errorMessage: "Could not load Dashboard Today work right now.",
    };
  }

  const supplementalResult = await getSupplementalDashboardTasks({
    supabase,
    planner: result.data,
    now,
    trackedTodaySecondsByTask: evidenceResult.data,
  });

  if (supplementalResult.errorMessage) {
    return {
      data: null,
      errorMessage: "Could not load Dashboard Today work right now.",
    };
  }

  return {
    data: mapTodayPlannerDataToDashboardPlanner(result.data, supplementalResult.data, {
      trackedTodaySecondsByTask: evidenceResult.data,
    }),
    errorMessage: null,
  };
}
