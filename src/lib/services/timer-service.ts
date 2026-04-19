import { createClient } from "@/lib/supabase/server";
import {
  formatDurationLabel,
  getCurrentDayWindow,
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
  getTaskTotalDurationMap,
} from "@/lib/task-session";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type OpenSession = {
  id: string;
  started_at: string;
};

export type ActiveTimerSession = {
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

export type TimerSummary = {
  trackedTodaySeconds: number;
  trackedTodayLabel: string;
  trackedTotalSeconds: number;
  trackedTotalLabel: string;
  sessionsTodayCount: number;
  longestSessionSeconds: number | null;
  longestSessionLabel: string | null;
  longestSessionTaskTitle: string | null;
};

export type TimerWorkspaceData = {
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    projects: { name: string; slug: string } | null;
  }>;
  openSessions: Array<{
    id: string;
    task_id: string;
    started_at: string;
    tasks: {
      id: string;
      title: string;
      description: string | null;
      status: string;
      priority: string;
      goals: { title: string } | null;
      projects: { name: string; slug: string } | null;
    } | null;
  }>;
  sessionHistory: Array<{
    id: string;
    taskId: string;
    taskTitle: string;
    projectName: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number;
  }>;
  todayTaskBreakdown: Array<{
    taskId: string;
    taskTitle: string;
    durationSeconds: number;
  }>;
  todayTotalDurationSeconds: number;
  taskTotalDurations: Record<string, number>;
};

type SessionConflictResolution = {
  canonicalSessionId: string;
  sessionsToClose: Array<{
    id: string;
    endedAtIso: string;
    durationSeconds: number;
  }>;
};

function toMs(value: string) {
  return new Date(value).getTime();
}

function getSafeDurationSeconds(startedAtIso: string, endedAtIso: string) {
  return Math.max(0, Math.floor((toMs(endedAtIso) - toMs(startedAtIso)) / 1000));
}

function resolveSessionConflict(openSessions: OpenSession[], nowIso: string): SessionConflictResolution | null {
  if (openSessions.length <= 1) {
    return null;
  }

  const sorted = [...openSessions].sort(
    (left, right) =>
      toMs(right.started_at) - toMs(left.started_at) || right.id.localeCompare(left.id),
  );

  const canonical = sorted[0];
  const canonicalStartedMs = toMs(canonical.started_at);
  const nowMs = toMs(nowIso);
  const closeAtIso =
    Number.isFinite(canonicalStartedMs) && canonicalStartedMs <= nowMs
      ? canonical.started_at
      : nowIso;

  return {
    canonicalSessionId: canonical.id,
    sessionsToClose: sorted.slice(1).map((session) => ({
      id: session.id,
      endedAtIso: closeAtIso,
      durationSeconds: getSafeDurationSeconds(session.started_at, closeAtIso),
    })),
  };
}

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

function mapToActiveTimerSession(
  session: {
    id: string;
    task_id: string;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    tasks: {
      title: string;
      status: string;
      priority: string;
      goals: { title: string } | null;
      projects: { name: string; slug: string } | null;
    } | null;
  },
  nowIso: string,
): ActiveTimerSession {
  return {
    sessionId: session.id,
    taskId: session.task_id,
    startedAt: session.started_at,
    elapsedLabel: formatDurationLabel(getTaskSessionDurationSeconds(session, nowIso)),
    taskTitle: session.tasks?.title ?? "Untitled task",
    taskStatus: session.tasks?.status ?? "todo",
    taskPriority: session.tasks?.priority ?? "medium",
    projectName: session.tasks?.projects?.name ?? "Unknown project",
    projectSlug: session.tasks?.projects?.slug ?? null,
    goalTitle: session.tasks?.goals?.title ?? null,
  };
}

export async function getOpenTimerSessions(options?: {
  supabase?: SupabaseServerClient;
  limit?: number;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  let query = supabase
    .from("task_sessions")
    .select("id, started_at")
    .is("ended_at", null)
    .order("started_at", { ascending: false });

  if (typeof options?.limit === "number") {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;

  if (error) {
    return { data: null, errorMessage: "Unable to load open timer sessions." };
  }

  return { data: data ?? [], errorMessage: null };
}

export async function startTimerForTask(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; nowIso?: string },
) {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return { errorMessage: "Select a task before starting the timer." };
  }

  const supabase = await resolveSupabaseClient(options?.supabase);
  const { data: openSessions, errorMessage } = await getOpenTimerSessions({
    supabase,
    limit: 2,
  });

  if (errorMessage || !openSessions) {
    return { errorMessage: "Unable to verify active timer sessions." };
  }

  if (openSessions.length > 1) {
    return {
      errorMessage:
        "Multiple open sessions detected. Resolve the conflict before starting a new timer.",
    };
  }

  if (openSessions.length === 1) {
    return { errorMessage: "A timer is already running. Stop it first." };
  }

  const { error: insertError } = await supabase.from("task_sessions").insert({
    task_id: normalizedTaskId,
    started_at: options?.nowIso ?? new Date().toISOString(),
  });

  if (insertError) {
    return { errorMessage: "Unable to start timer right now." };
  }

  return { errorMessage: null };
}

export async function stopTimerSession(
  options?: { sessionId?: string; supabase?: SupabaseServerClient; nowIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const { data: openSessions, errorMessage } = await getOpenTimerSessions({ supabase });

  if (errorMessage || !openSessions) {
    return { errorMessage: "Unable to load open timer sessions." };
  }

  if (openSessions.length > 1) {
    return {
      errorMessage:
        "Multiple open sessions detected. Resolve the conflict before stopping timers.",
    };
  }

  const submittedSessionId = options?.sessionId?.trim();
  const targetSession = submittedSessionId
    ? openSessions.find((session) => session.id === submittedSessionId)
    : openSessions[0];

  if (!targetSession) {
    return { errorMessage: "No active timer session is available to stop." };
  }

  const endedAtIso = options?.nowIso ?? new Date().toISOString();
  const durationSeconds = getSafeDurationSeconds(targetSession.started_at, endedAtIso);

  const { error: updateError } = await supabase
    .from("task_sessions")
    .update({
      ended_at: endedAtIso,
      duration_seconds: durationSeconds,
      updated_at: endedAtIso,
    })
    .eq("id", targetSession.id);

  if (updateError) {
    return { errorMessage: "Unable to stop timer right now." };
  }

  return { errorMessage: null };
}

export async function resolveOpenTimerSessionConflict(options?: {
  supabase?: SupabaseServerClient;
  nowIso?: string;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const { data: openSessions, errorMessage } = await getOpenTimerSessions({ supabase });

  if (errorMessage || !openSessions) {
    return { errorMessage: "Unable to inspect open timer sessions." };
  }

  const resolution = resolveSessionConflict(openSessions, options?.nowIso ?? new Date().toISOString());
  if (!resolution) {
    return { errorMessage: null, resolvedCount: 0 };
  }

  for (const session of resolution.sessionsToClose) {
    const { error: updateError } = await supabase
      .from("task_sessions")
      .update({
        ended_at: session.endedAtIso,
        duration_seconds: session.durationSeconds,
        updated_at: session.endedAtIso,
      })
      .eq("id", session.id);

    if (updateError) {
      return { errorMessage: "Unable to resolve timer session conflict." };
    }
  }

  return { errorMessage: null, resolvedCount: resolution.sessionsToClose.length };
}

export async function getTimerWorkspaceData(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const todayWindow = getCurrentDayWindow(now);
  const nextDayStartIso = new Date(
    new Date(todayWindow.startIso).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();

  const [tasksResult, openSessionsResult, completedSessionsResult, todaySessionsResult] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, status, projects(name, slug)")
        .neq("status", "done")
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("task_sessions")
        .select(
          "id, task_id, started_at, tasks(id, title, description, status, priority, goals(title), projects(name, slug))",
        )
        .is("ended_at", null)
        .order("started_at", { ascending: false }),
      supabase
        .from("task_sessions")
        .select(
          "id, task_id, started_at, ended_at, duration_seconds, tasks(id, title, projects(name))",
        )
        .not("ended_at", "is", null)
        .order("started_at", { ascending: false })
        .limit(80),
      supabase
        .from("task_sessions")
        .select("id, task_id, started_at, ended_at, duration_seconds, tasks(id, title)")
        .lt("started_at", nextDayStartIso)
        .or(`ended_at.gte.${todayWindow.startIso},ended_at.is.null`)
        .order("started_at", { ascending: false }),
    ]);

  if (tasksResult.error) {
    throw new Error(`Failed to load tasks: ${tasksResult.error.message}`);
  }
  if (openSessionsResult.error) {
    throw new Error(`Failed to load open sessions: ${openSessionsResult.error.message}`);
  }
  if (completedSessionsResult.error) {
    throw new Error(`Failed to load completed sessions: ${completedSessionsResult.error.message}`);
  }
  if (todaySessionsResult.error) {
    throw new Error(`Failed to load today's sessions: ${todaySessionsResult.error.message}`);
  }

  const taskIds = [
    ...new Set([
      ...tasksResult.data.map((task) => task.id),
      ...openSessionsResult.data.map((session) => session.task_id),
      ...completedSessionsResult.data.map((session) => session.tasks?.id).filter(Boolean),
      ...todaySessionsResult.data.map((session) => session.task_id),
    ]),
  ] as string[];
  const taskTotalDurations = await getTaskTotalDurationMap(supabase, taskIds, nowIso);

  const todayTaskDurationMap = todaySessionsResult.data.reduce<
    Record<string, { taskTitle: string; durationSeconds: number }>
  >((totals, session) => {
    const durationSeconds = getSessionDurationWithinWindowSeconds(session, todayWindow, nowIso);
    if (durationSeconds <= 0) {
      return totals;
    }

    const existing = totals[session.task_id];
    totals[session.task_id] = {
      taskTitle: existing?.taskTitle ?? session.tasks?.title ?? "Untitled task",
      durationSeconds: (existing?.durationSeconds ?? 0) + durationSeconds,
    };
    return totals;
  }, {});

  const todayTaskBreakdown = Object.entries(todayTaskDurationMap)
    .map(([taskId, details]) => ({
      taskId,
      taskTitle: details.taskTitle,
      durationSeconds: details.durationSeconds,
    }))
    .sort((left, right) => right.durationSeconds - left.durationSeconds);

  const todayTotalDurationSeconds = todayTaskBreakdown.reduce(
    (sum, row) => sum + row.durationSeconds,
    0,
  );

  const sessionHistory = completedSessionsResult.data
    .map((session) => ({
      id: session.id,
      taskId: session.task_id,
      taskTitle: session.tasks?.title ?? "Untitled task",
      projectName: session.tasks?.projects?.name ?? "Unknown project",
      startedAt: session.started_at,
      endedAt: session.ended_at,
      durationSeconds: getTaskSessionDurationSeconds(session, nowIso),
    }))
    .sort(
      (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
    );

  return {
    tasks: tasksResult.data,
    openSessions: openSessionsResult.data,
    todayTaskBreakdown,
    todayTotalDurationSeconds,
    sessionHistory,
    taskTotalDurations,
  } satisfies TimerWorkspaceData;
}

export async function getActiveTimerSession(options?: {
  supabase?: SupabaseServerClient;
  nowIso?: string;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const nowIso = options?.nowIso ?? new Date().toISOString();

  const { data, error } = await supabase
    .from("task_sessions")
    .select(
      "id, task_id, started_at, ended_at, duration_seconds, tasks(title, status, priority, goals(title), projects(name, slug))",
    )
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) {
    return {
      data: null,
      errorMessage: "Could not load the active timer right now.",
    };
  }

  const session = data?.[0];
  if (!session) {
    return {
      data: null,
      errorMessage: null,
    };
  }

  return {
    data: mapToActiveTimerSession(session, nowIso),
    errorMessage: null,
  };
}

export async function getTimerSummary(options?: {
  supabase?: SupabaseServerClient;
  now?: Date;
  limit?: number;
}) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const todayWindow = getCurrentDayWindow(now);
  const { data, error } = await supabase
    .from("task_sessions")
    .select("task_id, started_at, ended_at, duration_seconds, tasks(title)")
    .order("started_at", { ascending: false })
    .limit(options?.limit ?? 150);

  if (error) {
    return {
      data: null,
      errorMessage: "Could not load timer summary right now.",
    };
  }

  const sessions = data ?? [];
  const trackedTotalSeconds = sessions.reduce((total, session) => {
    return total + getTaskSessionDurationSeconds(session, nowIso);
  }, 0);
  const trackedTodaySeconds = sessions.reduce((total, session) => {
    return total + getSessionDurationWithinWindowSeconds(session, todayWindow, nowIso);
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

  const summary: TimerSummary = {
    trackedTodaySeconds,
    trackedTodayLabel: formatDurationLabel(trackedTodaySeconds),
    trackedTotalSeconds,
    trackedTotalLabel: formatDurationLabel(trackedTotalSeconds),
    sessionsTodayCount,
    longestSessionSeconds: longestSession?.duration ?? null,
    longestSessionLabel: longestSession ? formatDurationLabel(longestSession.duration) : null,
    longestSessionTaskTitle: longestSession?.title ?? null,
  };

  return {
    data: summary,
    errorMessage: null,
  };
}
