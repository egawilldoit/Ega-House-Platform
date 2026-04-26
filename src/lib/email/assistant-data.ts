import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type AssistantEmailType =
  | "morning"
  | "midday"
  | "afternoon"
  | "night-review"
  | "weekly-review";

type AssistantTask = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  updatedAt: string;
  projectName: string | null;
  goalTitle: string | null;
};

type AssistantSession = {
  id: string;
  taskId: string;
  taskTitle: string;
  projectName: string | null;
  goalTitle: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
};

type AssistantProject = {
  id: string;
  name: string;
};

type AssistantGoal = {
  id: string;
  title: string;
  status: string;
  projectName: string | null;
};

type AssistantWeekReview = {
  id: string;
  weekStart: string;
  weekEnd: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  nextSteps: string | null;
  updatedAt: string;
};

export type AssistantEmailData = {
  type: AssistantEmailType;
  generatedAt: string;
  timezoneLabel: "GMT+1";
  today: {
    startIso: string;
    endIso: string;
  };
  week: {
    startIso: string;
    endIso: string;
  };
  tasks: {
    dueToday: AssistantTask[];
    open: AssistantTask[];
    completedToday: AssistantTask[];
    completedThisWeek: AssistantTask[];
    overdue: AssistantTask[];
  };
  time: {
    todayTotalSeconds: number;
    weekTotalSeconds: number;
    sessionsToday: AssistantSession[];
    sessionsThisWeek: AssistantSession[];
  };
  projects: {
    touchedToday: AssistantProject[];
    touchedThisWeek: AssistantProject[];
  };
  goals: {
    active: AssistantGoal[];
    progressedThisWeek: AssistantGoal[];
  };
  review: {
    latestDailyReview: null;
    latestWeeklyReview: AssistantWeekReview | null;
  };
  diagnostics: {
    skippedTables: string[];
    counts: Record<string, number>;
  };
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  updated_at: string;
  project_id: string;
  goal_id: string | null;
  projects: { name: string } | null;
  goals: { title: string } | null;
};

type SessionRow = {
  id: string;
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tasks: {
    title: string;
    project_id: string;
    goal_id: string | null;
    projects: { name: string } | null;
    goals: { title: string } | null;
  } | null;
};

type GoalRow = {
  id: string;
  title: string;
  status: string;
  project_id: string;
  projects: { name: string } | null;
};

type WeekReviewRow = {
  id: string;
  week_start: string;
  week_end: string;
  summary: string | null;
  wins: string | null;
  blockers: string | null;
  next_steps: string | null;
  updated_at: string;
};

const GMT_PLUS_ONE_OFFSET_MINUTES = 60;
const DONE_STATUSES = new Set(["done", "complete", "completed"]);
const OPEN_STATUSES = new Set(["todo", "in_progress", "blocked"]);

function requireOwnerUserId() {
  const ownerUserId = process.env.EGA_OWNER_USER_ID;

  if (!ownerUserId) {
    throw new Error("Missing required server-only email environment variable: EGA_OWNER_USER_ID");
  }

  return ownerUserId;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function getGmtPlusOneDateParts(date: Date) {
  const shifted = new Date(date.getTime() + GMT_PLUS_ONE_OFFSET_MINUTES * 60 * 1000);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function localDateToUtcIso(year: number, month: number, day: number) {
  return new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - GMT_PLUS_ONE_OFFSET_MINUTES * 60 * 1000,
  ).toISOString();
}

function addDaysIsoDate(date: { year: number; month: number; day: number }, days: number) {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 0, 0, 0, 0));

  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function toLocalDateString(date: { year: number; month: number; day: number }) {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

function getAssistantWindows(now = new Date()) {
  const todayParts = getGmtPlusOneDateParts(now);
  const todayDate = {
    year: todayParts.year,
    month: todayParts.month,
    day: todayParts.day,
  };
  const tomorrowDate = addDaysIsoDate(todayDate, 1);
  const mondayOffset = todayParts.weekday === 0 ? -6 : 1 - todayParts.weekday;
  const weekStartDate = addDaysIsoDate(todayDate, mondayOffset);
  const weekEndDate = addDaysIsoDate(weekStartDate, 7);

  return {
    todayDateString: toLocalDateString(todayDate),
    todayStartIso: localDateToUtcIso(todayDate.year, todayDate.month, todayDate.day),
    todayEndIso: localDateToUtcIso(tomorrowDate.year, tomorrowDate.month, tomorrowDate.day),
    weekStartIso: localDateToUtcIso(
      weekStartDate.year,
      weekStartDate.month,
      weekStartDate.day,
    ),
    weekEndIso: localDateToUtcIso(weekEndDate.year, weekEndDate.month, weekEndDate.day),
  };
}

function toMs(value: string) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isDoneStatus(status: string) {
  return DONE_STATUSES.has(status.toLowerCase());
}

function isOpenStatus(status: string) {
  return OPEN_STATUSES.has(status.toLowerCase());
}

function isWithinIsoWindow(value: string, startIso: string, endIso: string) {
  return value >= startIso && value < endIso;
}

function getCompletedSessionDurationSeconds(session: SessionRow) {
  if (!session.ended_at) {
    return 0;
  }

  const startedMs = toMs(session.started_at);
  const endedMs = toMs(session.ended_at);

  if (startedMs !== null && endedMs !== null && endedMs >= startedMs) {
    return Math.floor((endedMs - startedMs) / 1000);
  }

  return Math.max(0, session.duration_seconds ?? 0);
}

function getSessionDurationWithinWindowSeconds(
  session: SessionRow,
  startIso: string,
  endIso: string,
) {
  if (!session.ended_at) {
    return 0;
  }

  const startedMs = toMs(session.started_at);
  const endedMs = toMs(session.ended_at);
  const windowStartMs = toMs(startIso);
  const windowEndMs = toMs(endIso);

  if (
    startedMs === null ||
    endedMs === null ||
    windowStartMs === null ||
    windowEndMs === null
  ) {
    return 0;
  }

  const overlapStart = Math.max(startedMs, windowStartMs);
  const overlapEnd = Math.min(endedMs, windowEndMs);

  if (overlapEnd <= overlapStart) {
    return 0;
  }

  return Math.floor((overlapEnd - overlapStart) / 1000);
}

function mapTask(task: TaskRow): AssistantTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.due_date,
    updatedAt: task.updated_at,
    projectName: task.projects?.name ?? null,
    goalTitle: task.goals?.title ?? null,
  };
}

function mapSession(session: SessionRow): AssistantSession {
  return {
    id: session.id,
    taskId: session.task_id,
    taskTitle: session.tasks?.title ?? "Untitled task",
    projectName: session.tasks?.projects?.name ?? null,
    goalTitle: session.tasks?.goals?.title ?? null,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    durationSeconds: getCompletedSessionDurationSeconds(session),
  };
}

function getUniqueProjectsFromTasksAndSessions(tasks: TaskRow[], sessions: SessionRow[]) {
  const projects = new Map<string, AssistantProject>();

  tasks.forEach((task) => {
    if (task.projects?.name) {
      projects.set(task.project_id, { id: task.project_id, name: task.projects.name });
    }
  });

  sessions.forEach((session) => {
    if (session.tasks?.project_id && session.tasks.projects?.name) {
      projects.set(session.tasks.project_id, {
        id: session.tasks.project_id,
        name: session.tasks.projects.name,
      });
    }
  });

  return Array.from(projects.values()).slice(0, 10);
}

function getProgressedGoals(args: {
  goals: GoalRow[];
  tasks: TaskRow[];
  sessions: SessionRow[];
  weekStartIso: string;
}) {
  const progressedGoalIds = new Set<string>();

  args.tasks.forEach((task) => {
    if (task.goal_id && task.updated_at >= args.weekStartIso) {
      progressedGoalIds.add(task.goal_id);
    }
  });

  args.sessions.forEach((session) => {
    if (session.tasks?.goal_id) {
      progressedGoalIds.add(session.tasks.goal_id);
    }
  });

  return args.goals
    .filter((goal) => progressedGoalIds.has(goal.id))
    .map((goal) => ({
      id: goal.id,
      title: goal.title,
      status: goal.status,
      projectName: goal.projects?.name ?? null,
    }))
    .slice(0, 10);
}

export async function getAssistantEmailData(type: AssistantEmailType): Promise<AssistantEmailData> {
  const ownerUserId = requireOwnerUserId();
  const supabase = getSupabaseServiceClient();
  const windows = getAssistantWindows();

  const [tasksResult, sessionsResult, goalsResult, weeklyReviewResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, due_date, updated_at, project_id, goal_id, projects(name), goals(title)")
      .eq("owner_user_id", ownerUserId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(250),
    supabase
      .from("task_sessions")
      .select(
        "id, task_id, started_at, ended_at, duration_seconds, tasks(title, project_id, goal_id, projects(name), goals(title))",
      )
      .eq("owner_user_id", ownerUserId)
      .lt("started_at", windows.weekEndIso)
      .or(`ended_at.gte.${windows.weekStartIso},ended_at.is.null`)
      .order("started_at", { ascending: false })
      .limit(120),
    supabase
      .from("goals")
      .select("id, title, status, project_id, projects(name)")
      .eq("owner_user_id", ownerUserId)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("week_reviews")
      .select("id, week_start, week_end, summary, wins, blockers, next_steps, updated_at")
      .eq("owner_user_id", ownerUserId)
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);

  if (tasksResult.error) {
    throw new Error(`Failed to load owner-scoped tasks: ${tasksResult.error.message}`);
  }
  if (sessionsResult.error) {
    throw new Error(`Failed to load owner-scoped task sessions: ${sessionsResult.error.message}`);
  }
  if (goalsResult.error) {
    throw new Error(`Failed to load owner-scoped goals: ${goalsResult.error.message}`);
  }
  if (weeklyReviewResult.error) {
    throw new Error(`Failed to load owner-scoped week reviews: ${weeklyReviewResult.error.message}`);
  }

  const tasks = (tasksResult.data ?? []) as unknown as TaskRow[];
  const sessions = (sessionsResult.data ?? []) as unknown as SessionRow[];
  const goals = (goalsResult.data ?? []) as unknown as GoalRow[];
  const latestWeeklyReview = ((weeklyReviewResult.data ?? []) as unknown as WeekReviewRow[])[0];

  const dueToday = tasks
    .filter((task) => task.due_date === windows.todayDateString && !isDoneStatus(task.status))
    .map(mapTask)
    .slice(0, 10);
  const open = tasks
    .filter((task) => isOpenStatus(task.status))
    .map(mapTask)
    .slice(0, 10);
  const completedToday = tasks
    .filter(
      (task) =>
        isDoneStatus(task.status) &&
        isWithinIsoWindow(task.updated_at, windows.todayStartIso, windows.todayEndIso),
    )
    .map(mapTask)
    .slice(0, 10);
  const completedThisWeek = tasks
    .filter(
      (task) =>
        isDoneStatus(task.status) &&
        isWithinIsoWindow(task.updated_at, windows.weekStartIso, windows.weekEndIso),
    )
    .map(mapTask)
    .slice(0, 20);
  const overdue = tasks
    .filter(
      (task) =>
        Boolean(task.due_date) &&
        task.due_date! < windows.todayDateString &&
        !isDoneStatus(task.status),
    )
    .map(mapTask)
    .slice(0, 10);

  const sessionsToday = sessions
    .filter((session) =>
      getSessionDurationWithinWindowSeconds(
        session,
        windows.todayStartIso,
        windows.todayEndIso,
      ),
    )
    .map(mapSession)
    .slice(0, 10);
  const sessionsThisWeek = sessions
    .filter((session) =>
      getSessionDurationWithinWindowSeconds(session, windows.weekStartIso, windows.weekEndIso),
    )
    .map(mapSession)
    .slice(0, 20);

  const todayTotalSeconds = sessions.reduce(
    (total, session) =>
      total +
      getSessionDurationWithinWindowSeconds(
        session,
        windows.todayStartIso,
        windows.todayEndIso,
      ),
    0,
  );
  const weekTotalSeconds = sessions.reduce(
    (total, session) =>
      total +
      getSessionDurationWithinWindowSeconds(session, windows.weekStartIso, windows.weekEndIso),
    0,
  );

  const touchedToday = getUniqueProjectsFromTasksAndSessions(
    tasks.filter((task) => task.updated_at >= windows.todayStartIso),
    sessionsToday.length > 0 ? sessions : [],
  );
  const touchedThisWeek = getUniqueProjectsFromTasksAndSessions(
    tasks.filter((task) => task.updated_at >= windows.weekStartIso),
    sessions,
  );
  const activeGoals = goals
    .filter((goal) => goal.status === "active")
    .map((goal) => ({
      id: goal.id,
      title: goal.title,
      status: goal.status,
      projectName: goal.projects?.name ?? null,
    }))
    .slice(0, 10);

  return {
    type,
    generatedAt: new Date().toISOString(),
    timezoneLabel: "GMT+1",
    today: {
      startIso: windows.todayStartIso,
      endIso: windows.todayEndIso,
    },
    week: {
      startIso: windows.weekStartIso,
      endIso: windows.weekEndIso,
    },
    tasks: {
      dueToday,
      open,
      completedToday,
      completedThisWeek,
      overdue,
    },
    time: {
      todayTotalSeconds,
      weekTotalSeconds,
      sessionsToday,
      sessionsThisWeek,
    },
    projects: {
      touchedToday,
      touchedThisWeek,
    },
    goals: {
      active: activeGoals,
      progressedThisWeek: getProgressedGoals({
        goals,
        tasks,
        sessions,
        weekStartIso: windows.weekStartIso,
      }),
    },
    review: {
      latestDailyReview: null,
      latestWeeklyReview: latestWeeklyReview
        ? {
            id: latestWeeklyReview.id,
            weekStart: latestWeeklyReview.week_start,
            weekEnd: latestWeeklyReview.week_end,
            summary: latestWeeklyReview.summary,
            wins: latestWeeklyReview.wins,
            blockers: latestWeeklyReview.blockers,
            nextSteps: latestWeeklyReview.next_steps,
            updatedAt: latestWeeklyReview.updated_at,
          }
        : null,
    },
    diagnostics: {
      skippedTables: ["daily_reviews: no daily review table found in schema or Supabase types"],
      counts: {
        tasks: tasks.length,
        taskSessions: sessions.length,
        goals: goals.length,
        weekReviews: latestWeeklyReview ? 1 : 0,
        dueToday: dueToday.length,
        openTasks: open.length,
        completedToday: completedToday.length,
        completedThisWeek: completedThisWeek.length,
        overdueTasks: overdue.length,
        sessionsToday: sessionsToday.length,
        sessionsThisWeek: sessionsThisWeek.length,
        projectsTouchedToday: touchedToday.length,
        projectsTouchedThisWeek: touchedThisWeek.length,
        activeGoals: activeGoals.length,
      },
    },
  };
}
