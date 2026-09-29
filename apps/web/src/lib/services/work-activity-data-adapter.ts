import { createClient } from "@/lib/supabase/server";
import type { ExecutionEvidenceWindow } from "@/lib/services/execution-evidence-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) return supabase;
  return createClient();
}

function isValidWindowIso(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export type WorkActivitySessionRow = {
  task_id: string;
  started_at: string;
  ended_at: string | null;
};

export type WorkActivityCompletionEventRow = {
  occurred_at: string;
  task_id: string | null;
};

/**
 * One bounded yearly overlapping-sessions query for the Work Activity calendar.
 *
 * Uses the canonical Work Analytics overlap semantics:
 *   started_at < window.endIso AND (ended_at IS NULL OR ended_at >= window.startIso)
 *
 * Returns compact rows only (no nested task joins) — the calendar summary
 * needs just started_at/ended_at per session. This keeps the initial yearly
 * payload bounded to daily summaries, not full nested session rows.
 */
export async function getWorkActivitySessionsForYear(args: {
  ownerUserId: string;
  window: ExecutionEvidenceWindow;
  supabase?: SupabaseServerClient;
}): Promise<{ data: WorkActivitySessionRow[] | null; errorMessage: string | null }> {
  if (!isValidWindowIso(args.window.startIso) || !isValidWindowIso(args.window.endIso)) {
    return { data: null, errorMessage: "Invalid window for work activity." };
  }
  const supabase = await resolveSupabaseClient(args.supabase);
  const { data, error } = await supabase
    .from("task_sessions")
    .select("task_id, started_at, ended_at")
    .eq("owner_user_id", args.ownerUserId)
    .lt("started_at", args.window.endIso)
    .or(`ended_at.is.null,ended_at.gte.${args.window.startIso}`)
    .order("started_at", { ascending: false });

  if (error) {
    return { data: null, errorMessage: `Failed to load work activity sessions: ${error.message}` };
  }

  return { data: (data ?? []) as WorkActivitySessionRow[], errorMessage: null };
}

/**
 * One bounded completion-window query on the durable task_status_events ledger.
 *
 * Counts only canonical completion transitions (to_status = 'done') within the
 * UTC evidence window. Returns compact rows — the calendar summary needs just
 * occurred_at per event.
 */
export async function getWorkActivityCompletionEvents(args: {
  ownerUserId: string;
  window: ExecutionEvidenceWindow;
  supabase?: SupabaseServerClient;
}): Promise<{ data: WorkActivityCompletionEventRow[] | null; errorMessage: string | null }> {
  if (!isValidWindowIso(args.window.startIso) || !isValidWindowIso(args.window.endIso)) {
    return { data: null, errorMessage: "Invalid window for work activity." };
  }
  const supabase = await resolveSupabaseClient(args.supabase);
  const { data, error } = await supabase
    .from("task_status_events")
    .select("occurred_at, task_id")
    .eq("owner_user_id", args.ownerUserId)
    .eq("to_status", "done")
    .gte("occurred_at", args.window.startIso)
    .lt("occurred_at", args.window.endIso)
    .order("occurred_at", { ascending: false });

  if (error) {
    return { data: null, errorMessage: `Failed to load work activity completions: ${error.message}` };
  }

  return { data: (data ?? []) as WorkActivityCompletionEventRow[], errorMessage: null };
}

export type WorkActivityDaySessionRow = {
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  tasks?: {
    id?: string | null;
    title?: string | null;
    project_id?: string | null;
    goal_id?: string | null;
    estimate_minutes?: number | null;
    projects?: { id?: string | null; name?: string | null } | null;
    goals?: { id?: string | null; title?: string | null } | null;
  } | null;
};

function clipSessionDurationSeconds(
  session: { started_at: string; ended_at: string | null; duration_seconds: number | null },
  dayWindow: ExecutionEvidenceWindow,
  nowIso: string,
): number | null {
  const windowStartMs = Date.parse(dayWindow.startIso);
  const windowEndMs = Date.parse(dayWindow.endIso);
  const startMs = Date.parse(session.started_at);
  const endMs = Date.parse(session.ended_at ?? nowIso);

  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) {
    return session.duration_seconds;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return session.duration_seconds;
  }

  const clippedStartMs = Math.max(startMs, windowStartMs);
  const clippedEndMs = Math.min(endMs, windowEndMs);
  if (clippedEndMs <= clippedStartMs) {
    return 0;
  }
  return Math.floor((clippedEndMs - clippedStartMs) / 1000);
}

export type WorkActivityCompletedTaskRow = {
  taskId: string;
  title: string;
  projectName: string | null;
  projectId: string | null;
  goalTitle: string | null;
  goalId: string | null;
  completedAt: string;
};

export type WorkActivityDayDetails = {
  sessions: WorkActivityDaySessionRow[];
  completedTasks: WorkActivityCompletedTaskRow[];
};

/**
 * Bounded day detail for the Work Activity calendar drilldown.
 *
 * Fetches sessions overlapping the selected local day (full nested task data
 * for the drilldown DTOs) and the durable completion events on that local day
 * with their Task metadata. Bounded to the single local day window — never a
 * yearly or per-day N+1 query.
 */
export async function getWorkActivityDayDetails(args: {
  ownerUserId: string;
  dayWindow: ExecutionEvidenceWindow;
  now?: Date;
  supabase?: SupabaseServerClient;
}): Promise<{ data: WorkActivityDayDetails | null; errorMessage: string | null }> {
  if (!isValidWindowIso(args.dayWindow.startIso) || !isValidWindowIso(args.dayWindow.endIso)) {
    return { data: null, errorMessage: "Invalid day for work activity." };
  }
  const supabase = await resolveSupabaseClient(args.supabase);
  const nowIso = (args.now ?? new Date()).toISOString();

  const { data: sessions, error: sessionsError } = await supabase
    .from("task_sessions")
    .select("task_id, started_at, ended_at, duration_seconds, tasks(id, title, project_id, estimate_minutes, projects(id, name), goals(id, title))")
    .eq("owner_user_id", args.ownerUserId)
    .lt("started_at", args.dayWindow.endIso)
    .or(`ended_at.is.null,ended_at.gte.${args.dayWindow.startIso}`)
    .order("started_at", { ascending: false });

  if (sessionsError) {
    return { data: null, errorMessage: `Failed to load work activity day sessions: ${sessionsError.message}` };
  }

  const { data: completionRows, error: completionsError } = await supabase
    .from("task_status_events")
    .select("occurred_at, task_id")
    .eq("owner_user_id", args.ownerUserId)
    .eq("to_status", "done")
    .gte("occurred_at", args.dayWindow.startIso)
    .lt("occurred_at", args.dayWindow.endIso)
    .order("occurred_at", { ascending: false });

  if (completionsError) {
    return { data: null, errorMessage: `Failed to load work activity day completions: ${completionsError.message}` };
  }

  const completionTaskIds = (completionRows ?? [])
    .map((row) => (row as { task_id: string | null }).task_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  let completedTasks: WorkActivityCompletedTaskRow[] = [];
  if (completionTaskIds.length > 0) {
    const { data: taskRows, error: tasksError } = await supabase
      .from("tasks")
      .select("id, title, project_id, goal_id, projects(id, name), goals(id, title)")
      .eq("owner_user_id", args.ownerUserId)
      .in("id", completionTaskIds);

    if (tasksError) {
      return { data: null, errorMessage: `Failed to load work activity day tasks: ${tasksError.message}` };
    }

    const taskMetaById = new Map(
      (taskRows ?? []).map((row) => {
        const r = row as {
          id: string;
          title: string | null;
          project_id: string | null;
          goal_id: string | null;
          projects?: { id?: string | null; name?: string | null } | null;
          goals?: { id?: string | null; title?: string | null } | null;
        };
        return [
          r.id,
          {
            taskId: r.id,
            title: r.title ?? "Untitled task",
            projectName: r.projects?.name ?? null,
            projectId: r.projects?.id ?? r.project_id ?? null,
            goalTitle: r.goals?.title ?? null,
            goalId: r.goals?.id ?? r.goal_id ?? null,
          },
        ] as const;
      }),
    );

    completedTasks = (completionRows ?? [])
      .map((row) => {
        const r = row as { occurred_at: string; task_id: string | null };
        const meta = r.task_id ? taskMetaById.get(r.task_id) : null;
        if (!meta) return null;
        return { ...meta, completedAt: r.occurred_at };
      })
      .filter((entry): entry is WorkActivityCompletedTaskRow => entry !== null);
  }

  const windowStartMs = Date.parse(args.dayWindow.startIso);
  const windowEndMs = Date.parse(args.dayWindow.endIso);
  const nowMs = Date.parse(nowIso);
  const isCurrentLocalDay =
    Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs) && Number.isFinite(nowMs)
      ? nowMs >= windowStartMs && nowMs < windowEndMs
      : true;

  return {
    data: {
      // An open session is provisional evidence for the CURRENT local day only.
      // A stale multi-day open session must not paint historical days in the
      // drilldown, mirroring aggregateSessionEvidenceByLocalDay so the drawer
      // can never disagree with the calendar cell it drills into.
      sessions: ((sessions ?? []) as WorkActivityDaySessionRow[])
        .filter((session) => session.ended_at != null || isCurrentLocalDay)
        .map((session) => ({
          ...session,
          duration_seconds: clipSessionDurationSeconds(session, args.dayWindow, nowIso),
        })),
      completedTasks,
    },
    errorMessage: null,
  };
}
