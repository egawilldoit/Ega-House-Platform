import { type GoalHealth, toGoalHealthOrNull } from "@/lib/goal-health";
import { GOAL_ARCHIVE_STATUS } from "@/lib/goal-archive";
import { getOpenClawHealth } from "@/lib/openclaw";
import { createClient } from "@/lib/supabase/server";
import { sortFocusQueueTasks } from "@/lib/focus-queue";
import {
  getCurrentDayWindow,
  formatDurationLabel,
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
} from "@/lib/task-session";

import {
  getLinearProjectSnapshot,
  type LinearIssueStatusCount,
  type LinearMilestoneSnapshot,
} from "./linear-dashboard";

const TODAY_TASK_LIMIT = 8;
const PANEL_ERROR_MESSAGES = {
  todaysTasks: "Could not load today's tasks right now.",
  focusQueue: "Could not load focus queue right now.",
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
  status: string;
  priority: string;
  focusRank: number | null;
  dueDate: string | null;
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

export type DashboardData = {
  health: DashboardHealthData;
  todaysTasks: PanelResult<DashboardTodayTask[]>;
  focusQueue: PanelResult<DashboardFocusQueueTask[]>;
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
        "id, title, status, priority, due_date, updated_at, focus_rank, projects(name), goals(title)",
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
                "id, title, status, priority, due_date, updated_at, focus_rank, projects(name), goals(title)",
              )
              .order("updated_at", { ascending: false })
              .limit(TODAY_TASK_LIMIT)
          ).data ?? [];

    return {
      data: fallbackTasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        focusRank: task.focus_rank,
        dueDate: task.due_date,
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

async function getFocusQueue(): Promise<PanelResult<DashboardFocusQueueTask[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tasks")
      .select("id, title, status, priority, updated_at, focus_rank, projects(name), goals(title)")
      .not("focus_rank", "is", null)
      .order("focus_rank", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(8);

    if (error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.focusQueue,
      };
    }

    const queue = sortFocusQueueTasks(data ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      focusRank: task.focus_rank ?? 0,
      updatedAt: task.updated_at,
      projectName: task.projects?.name ?? "Unknown project",
      goalTitle: task.goals?.title ?? null,
    }));

    return {
      data: queue,
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
    const supabase = await createClient();
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from("task_sessions")
      .select(
        "id, task_id, started_at, ended_at, duration_seconds, tasks(id, title, status, priority, goals(title), projects(name, slug))",
      )
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1);

    if (error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.activeTimer,
      };
    }

    const activeSession = data?.[0];

    if (!activeSession) {
      return {
        data: null,
        error: null,
      };
    }

    return {
      data: {
        sessionId: activeSession.id,
        taskId: activeSession.task_id,
        startedAt: activeSession.started_at,
        elapsedLabel: formatDurationLabel(
          getTaskSessionDurationSeconds(activeSession, nowIso),
        ),
        taskTitle: activeSession.tasks?.title ?? "Untitled task",
        taskStatus: activeSession.tasks?.status ?? "todo",
        taskPriority: activeSession.tasks?.priority ?? "medium",
        projectName: activeSession.tasks?.projects?.name ?? "Unknown project",
        projectSlug: activeSession.tasks?.projects?.slug ?? null,
        goalTitle: activeSession.tasks?.goals?.title ?? null,
      },
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
        .neq("status", GOAL_ARCHIVE_STATUS)
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
    const supabase = await createClient();
    const now = new Date();
    const nowIso = now.toISOString();
    const todayWindow = getCurrentDayWindow(now);

    const { data, error } = await supabase
      .from("task_sessions")
      .select("task_id, started_at, ended_at, duration_seconds, tasks(title)")
      .order("started_at", { ascending: false })
      .limit(150);

    if (error) {
      return {
        data: null,
        error: PANEL_ERROR_MESSAGES.timerSummary,
      };
    }

    const sessions = data ?? [];
    const trackedTotalSeconds = sessions.reduce((total, session) => {
      return total + getTaskSessionDurationSeconds(session, nowIso);
    }, 0);
    const trackedTodaySeconds = sessions.reduce((total, session) => {
      return (
        total +
        getSessionDurationWithinWindowSeconds(session, todayWindow, nowIso)
      );
    }, 0);

    const sessionsTodayCount = sessions.filter((session) => {
      return new Date(session.started_at).getTime() >= new Date(todayWindow.startIso).getTime();
    }).length;

    const longestSession = sessions.reduce<{
      duration: number;
      title: string | null;
    } | null>((currentLongest, session) => {
      const duration = getTaskSessionDurationSeconds(session, nowIso);
      if (!currentLongest || duration > currentLongest.duration) {
        return {
          duration,
          title: session.tasks?.title ?? "Untitled task",
        };
      }
      return currentLongest;
    }, null);

    return {
      data: {
        trackedTodaySeconds,
        trackedTodayLabel: formatDurationLabel(trackedTodaySeconds),
        trackedTotalSeconds,
        trackedTotalLabel: formatDurationLabel(trackedTotalSeconds),
        sessionsTodayCount,
        longestSessionSeconds: longestSession?.duration ?? null,
        longestSessionLabel: longestSession
          ? formatDurationLabel(longestSession.duration)
          : null,
        longestSessionTaskTitle: longestSession?.title ?? null,
      },
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
    focusQueue,
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
      getFocusQueue(),
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
    focusQueue,
    activeTimer,
    projectStatuses,
    goals,
    timerSummary,
    latestReview,
    linearProject,
  };
}
