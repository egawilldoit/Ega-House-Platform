import { type GoalHealth, toGoalHealthOrNull } from "@/lib/goal-health";
import { getOpenClawHealth } from "@/lib/openclaw";
import { createClient } from "@/lib/supabase/server";
import { getTodayLocalIsoDate } from "@/lib/task-due-date";
import { buildTodayPlanner } from "@/lib/today-planner";
import {
  getCurrentDayWindow,
  getSessionDurationWithinWindowSeconds,
} from "@/lib/task-session";
import { getFocusQueueTasks } from "@/lib/services/focus-queue-service";
import {
  getActiveTimerSession,
  getTimerSummary as getTimerSummaryData,
} from "@/lib/services/timer-service";

import {
  getLinearProjectSnapshot,
  type LinearIssueStatusCount,
  type LinearMilestoneSnapshot,
} from "./linear-dashboard";
import {
  getFocusPanelCandidateState,
  type FocusPanelCandidateState,
} from "./focus-panel";

const TODAY_TASK_LIMIT = 8;
const PANEL_ERROR_MESSAGES = {
  todaysTasks: "Could not load today's tasks right now.",
  focusQueue: "Could not load focus queue right now.",
  focusPanel: "Could not load focus recommendation right now.",
  todayPlanner: "Could not build today planner right now.",
  activeTimer: "Could not load the active timer right now.",
  projectStatuses: "Could not load project statuses right now.",
  goals: "Could not load goal visibility right now.",
  timerSummary: "Could not load timer summary right now.",
  latestReview: "Could not load weekly review summary right now.",
  linearProject: "Could not load the Linear snapshot right now.",
} as const;

type PanelResult<T> =
  | {
      data: T;
      error: null;
    }
  | {
      data: null;
      error: string;
    };

export type DashboardHealthData = {
  state: "healthy" | "unavailable";
  statusText: string;
  checkedAt: string;
};

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
  projectName: string;
  goalTitle: string | null;
};

export type DashboardFocusQueueTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  focusRank: number;
  estimateMinutes: number | null;
  updatedAt: string;
  projectName: string;
  goalTitle: string | null;
};

export type DashboardActiveSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedLabel: string;
  taskTitle: string;
  taskStatus: string;
  taskPriority: string;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
};

export type DashboardProjectStatus = {
  id: string;
  name: string;
  slug: string;
  status: string;
  updatedAt: string;
};

export type DashboardGoalStatus = {
  id: string;
  title: string;
  nextStep: string | null;
  health: GoalHealth | null;
  status: string;
  updatedAt: string;
  projectName: string;
  linkedTaskCount: number;
  completedTaskCount: number;
  progressPercent: number;
};

export type DashboardTimerSummary = {
  trackedTodaySeconds: number;
  trackedTodayLabel: string;
  trackedTotalSeconds: number;
  trackedTotalLabel: string;
  sessionsTodayCount: number;
  longestSessionSeconds: number | null;
  longestSessionLabel: string | null;
  longestSessionTaskTitle: string | null;
};

export type DashboardLatestReview = {
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string | null;
  updatedAt: string;
};

export type DashboardLinearProject = {
  id: string;
  name: string;
  url: string | null;
  status: string | null;
  targetDate: string | null;
  priority: string | null;
  updatedAt: string;
  milestones: LinearMilestoneSnapshot[];
  issueStatusCounts: LinearIssueStatusCount[];
};

export type DashboardTodayPlanner = {
  planned: DashboardTodayTask[];
  inProgress: DashboardTodayTask[];
  blocked: DashboardTodayTask[];
  completed: DashboardTodayTask[];
  all: DashboardTodayTask[];
};

export type DashboardData = {
  health: DashboardHealthData;
  todaysTasks: PanelResult<DashboardTodayTask[]>;
  todayPlanner: PanelResult<DashboardTodayPlanner>;
  focusQueue: PanelResult<DashboardFocusQueueTask[]>;
  focusPanel: PanelResult<FocusPanelCandidateState>;
  activeTimer: PanelResult<DashboardActiveSession | null>;
  projectStatuses: PanelResult<DashboardProjectStatus[]>;
  goals: PanelResult<DashboardGoalStatus[]>;
  timerSummary: PanelResult<DashboardTimerSummary>;
  latestReview: PanelResult<DashboardLatestReview | null>;
  linearProject: PanelResult<DashboardLinearProject | null>;
};

function isLinearTokenMissingError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Linear API token is not configured");
}

function getTodayWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export async function getDashboardHealthData(): Promise<DashboardHealthData> {
  try {
    const health = await getOpenClawHealth();

    return {
      state: health.reachable ? "healthy" : "unavailable",
      statusText:
        health.statusText?.trim() ||
        (health.reachable ? "Healthy" : "OpenClaw is currently unavailable."),
      checkedAt: health.checkedAt,
    };
  } catch {
    return {
      state: "unavailable",
      statusText: "Health probe unavailable in this environment.",
      checkedAt: new Date().toISOString(),
    };
  }
}

async function getTodaysTasks(): Promise<PanelResult<DashboardTodayTask[]>> {
  try {
    const supabase = await createClient();
    const { startIso, endIso } = getTodayWindow();

    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, blocked_reason, status, priority, due_date, estimate_minutes, updated_at, focus_rank, projects(name), goals(title)",
      )
      .gte("updated_at", startIso)
      .lt("updated_at", endIso)
      .order("updated_at", { ascending: false })
      .limit(TODAY_TASK_LIMIT);

    if (error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.todaysTasks,
      };
    }

    const scopedTasks = data ?? [];
    const fallbackTasks =
      scopedTasks.length > 0
        ? scopedTasks
        : (
            await supabase
              .from("tasks")
              .select(
                "id, title, blocked_reason, status, priority, due_date, estimate_minutes, updated_at, focus_rank, projects(name), goals(title)",
              )
              .order("updated_at", { ascending: false })
              .limit(TODAY_TASK_LIMIT)
          ).data ?? [];

    return {
      data: fallbackTasks.map((task) => ({
        id: task.id,
        title: task.title,
        blockedReason: task.blocked_reason,
        status: task.status,
        priority: task.priority,
        focusRank: task.focus_rank,
        dueDate: task.due_date,
        estimateMinutes: task.estimate_minutes,
        updatedAt: task.updated_at,
        projectName: task.projects?.name ?? "Unknown project",
        goalTitle: task.goals?.title ?? null,
      })),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.todaysTasks,
    };
  }
}


async function getTodayPlanner(): Promise<PanelResult<DashboardTodayPlanner>> {
  try {
    const supabase = await createClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const todayWindow = getCurrentDayWindow(now);
    const todayDate = getTodayLocalIsoDate(now);
    const nextDayStartIso = new Date(
      new Date(todayWindow.startIso).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();

    const [tasksResult, todaySessionsResult, activeSessionResult] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, blocked_reason, status, priority, due_date, estimate_minutes, updated_at, focus_rank, projects(name), goals(title)",
        )
        .order("updated_at", { ascending: false })
        .limit(120),
      supabase
        .from("task_sessions")
        .select("task_id, started_at, ended_at, duration_seconds")
        .lt("started_at", nextDayStartIso)
        .or(`ended_at.gte.${todayWindow.startIso},ended_at.is.null`),
      supabase
        .from("task_sessions")
        .select("task_id")
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1),
    ]);

    if (tasksResult.error || todaySessionsResult.error || activeSessionResult.error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.todayPlanner,
      };
    }

    const trackedTodaySecondsByTask = (todaySessionsResult.data ?? []).reduce<Record<string, number>>(
      (totals, session) => {
        const durationSeconds = getSessionDurationWithinWindowSeconds(session, todayWindow, nowIso);
        if (durationSeconds > 0) {
          totals[session.task_id] = (totals[session.task_id] ?? 0) + durationSeconds;
        }
        return totals;
      },
      {},
    );

    const activeTaskId = activeSessionResult.data?.[0]?.task_id ?? null;
    const planner = buildTodayPlanner(
      (tasksResult.data ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        blocked_reason: task.blocked_reason,
        status: task.status,
        priority: task.priority,
        focus_rank: task.focus_rank,
        due_date: task.due_date,
        estimate_minutes: task.estimate_minutes,
        updated_at: task.updated_at,
        projectName: task.projects?.name ?? "Unknown project",
        goalTitle: task.goals?.title ?? null,
        hasActiveSession: task.id === activeTaskId,
        trackedTodaySeconds: trackedTodaySecondsByTask[task.id] ?? 0,
        completedToday: task.status === "done" && task.updated_at.slice(0, 10) === todayDate,
      })),
    );

    const mapPlannerTask = ({
      focus_rank,
      due_date,
      estimate_minutes,
      updated_at,
      ...task
    }: (typeof planner.all)[number]): DashboardTodayTask => ({
      ...task,
      blockedReason: task.blocked_reason ?? null,
      focusRank: focus_rank,
      dueDate: due_date,
      estimateMinutes: estimate_minutes,
      updatedAt: updated_at,
    });

    return {
      data: {
        planned: planner.planned.map(mapPlannerTask),
        inProgress: planner.inProgress.map(mapPlannerTask),
        blocked: planner.blocked.map(mapPlannerTask),
        completed: planner.completed.map(mapPlannerTask),
        all: planner.all.map(mapPlannerTask),
      },
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.todayPlanner,
    };
  }
}

async function getFocusPanel(): Promise<PanelResult<FocusPanelCandidateState>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, status, priority, due_date, estimate_minutes, updated_at, focus_rank, projects(name, slug), goals(title)",
      )
      .order("updated_at", { ascending: false })
      .limit(120);

    if (error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.focusPanel,
      };
    }

    return {
      data: getFocusPanelCandidateState(
        (data ?? []).map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueDate: task.due_date,
          focusRank: task.focus_rank,
          updatedAt: task.updated_at,
          estimateMinutes: task.estimate_minutes,
          projectName: task.projects?.name ?? "Unknown project",
          projectSlug: task.projects?.slug ?? null,
          goalTitle: task.goals?.title ?? null,
        })),
      ),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.focusPanel,
    };
  }
}

async function getFocusQueue(): Promise<PanelResult<DashboardFocusQueueTask[]>> {
  try {
    const queueResult = await getFocusQueueTasks({ limit: 8 });
    if (queueResult.errorMessage || !queueResult.data) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.focusQueue,
      };
    }

    return {
      data: queueResult.data,
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.focusQueue,
    };
  }
}

async function getActiveTimer(): Promise<PanelResult<DashboardActiveSession | null>> {
  try {
    const activeSessionResult = await getActiveTimerSession();
    if (activeSessionResult.errorMessage) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.activeTimer,
      };
    }
    if (!activeSessionResult.data) {
      return {
        data: null,
        error: null,
      };
    }

    return {
      data: activeSessionResult.data,
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.activeTimer,
    };
  }
}

async function getProjectStatuses(): Promise<PanelResult<DashboardProjectStatus[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, slug, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(8);

    if (error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.projectStatuses,
      };
    }

    return {
      data: (data ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        status: project.status,
        updatedAt: project.updated_at,
      })),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.projectStatuses,
    };
  }
}

async function getGoals(): Promise<PanelResult<DashboardGoalStatus[]>> {
  try {
    const supabase = await createClient();
    const [goalsResult, tasksResult] = await Promise.all([
      supabase
        .from("goals")
        .select("id, title, next_step, health, status, updated_at, projects(name)")
        .order("updated_at", { ascending: false })
        .limit(6),
      supabase
        .from("tasks")
        .select("id, goal_id, status")
        .not("goal_id", "is", null),
    ]);

    if (goalsResult.error || tasksResult.error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.goals,
      };
    }

    const taskCounts = (tasksResult.data ?? []).reduce<
      Record<string, { total: number; completed: number }>
    >((allCounts, task) => {
      const goalId = task.goal_id;
      if (!goalId) {
        return allCounts;
      }

      const bucket = allCounts[goalId] ?? { total: 0, completed: 0 };
      bucket.total += 1;
      if (task.status === "done") {
        bucket.completed += 1;
      }
      allCounts[goalId] = bucket;
      return allCounts;
    }, {});

    return {
      data: (goalsResult.data ?? []).map((goal) => {
        const counts = taskCounts[goal.id] ?? { total: 0, completed: 0 };
        const progressPercent =
          counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

        return {
          id: goal.id,
          title: goal.title,
          nextStep: goal.next_step,
          health: toGoalHealthOrNull(goal.health),
          status: goal.status,
          updatedAt: goal.updated_at,
          projectName: goal.projects?.name ?? "Unknown project",
          linkedTaskCount: counts.total,
          completedTaskCount: counts.completed,
          progressPercent,
        };
      }),
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.goals,
    };
  }
}

async function getTimerSummary(): Promise<PanelResult<DashboardTimerSummary>> {
  try {
    const summaryResult = await getTimerSummaryData({ limit: 150 });
    if (summaryResult.errorMessage || !summaryResult.data) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.timerSummary,
      };
    }

    return {
      data: summaryResult.data,
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.timerSummary,
    };
  }
}

async function getLatestReview(): Promise<PanelResult<DashboardLatestReview | null>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("week_reviews")
      .select("id, week_start, week_end, summary, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.latestReview,
      };
    }

    const review = data?.[0];
    if (!review) {
      return {
        data: null,
        error: null,
      };
    }

    return {
      data: {
        id: review.id,
        weekStart: review.week_start,
        weekEnd: review.week_end,
        summary: review.summary,
        updatedAt: review.updated_at,
      },
      error: null,
    };
  } catch {
    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.latestReview,
    };
  }
}

async function getLinearProject(): Promise<PanelResult<DashboardLinearProject | null>> {
  try {
    const project = await getLinearProjectSnapshot();

    if (!project) {
      return {
        data: null,
        error: null,
      };
    }

    return {
      data: {
        id: project.id,
        name: project.name,
        url: project.url,
        status: project.status,
        targetDate: project.targetDate,
        priority: project.priority,
        updatedAt: project.updatedAt,
        milestones: project.milestones,
        issueStatusCounts: project.issueStatusCounts,
      },
      error: null,
    };
  } catch (error) {
    if (isLinearTokenMissingError(error)) {
      return {
        data: null,
        error: null,
      };
    }

    return {
      data: null,
      error: PANEL_ERROR_MESSAGES.linearProject,
    };
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const [
    health,
    todaysTasks,
    todayPlanner,
    focusQueue,
    focusPanel,
    activeTimer,
    projectStatuses,
    goals,
    timerSummary,
    latestReview,
    linearProject,
  ] =
    await Promise.all([
      getDashboardHealthData(),
      getTodaysTasks(),
      getTodayPlanner(),
      getFocusQueue(),
      getFocusPanel(),
      getActiveTimer(),
      getProjectStatuses(),
      getGoals(),
      getTimerSummary(),
      getLatestReview(),
      getLinearProject(),
    ]);

  return {
    health,
    todaysTasks,
    todayPlanner,
    focusQueue,
    focusPanel,
    activeTimer,
    projectStatuses,
    goals,
    timerSummary,
    latestReview,
    linearProject,
  };
}
