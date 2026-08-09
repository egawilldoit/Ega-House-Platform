import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type TaskSessionDurationRow = Pick<
  Tables<"task_sessions">,
  "task_id" | "started_at" | "ended_at" | "duration_seconds"
>;

type SessionWindow = {
  startIso: string;
  endIso: string;
};

function toMs(iso: string) {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

export function getTaskSessionDurationSeconds(
  session: TaskSessionDurationRow,
  nowIso = new Date().toISOString(),
) {
  const sessionStartMs = toMs(session.started_at);
  const sessionEndMs = session.ended_at ? toMs(session.ended_at) : toMs(nowIso);

  if (
    sessionStartMs !== null &&
    sessionEndMs !== null &&
    sessionEndMs >= sessionStartMs
  ) {
    return Math.floor((sessionEndMs - sessionStartMs) / 1000);
  }

  if (typeof session.duration_seconds === "number") {
    return Math.max(0, session.duration_seconds);
  }

  return 0;
}

export function getCurrentDayWindow(now = new Date()): SessionWindow {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  return {
    startIso: dayStart.toISOString(),
    endIso: now.toISOString(),
  };
}

export function getSessionDurationWithinWindowSeconds(
  session: TaskSessionDurationRow,
  window: SessionWindow,
  nowIso = new Date().toISOString(),
) {
  const sessionStartMs = toMs(session.started_at);
  const sessionEndMs = session.ended_at ? toMs(session.ended_at) : toMs(nowIso);
  const windowStartMs = toMs(window.startIso);
  const windowEndMs = toMs(window.endIso);

  if (
    sessionStartMs === null ||
    sessionEndMs === null ||
    windowStartMs === null ||
    windowEndMs === null
  ) {
    return 0;
  }

  const overlapStart = Math.max(sessionStartMs, windowStartMs);
  const overlapEnd = Math.min(sessionEndMs, windowEndMs);

  if (overlapEnd <= overlapStart) {
    return 0;
  }

  return Math.floor((overlapEnd - overlapStart) / 1000);
}

export async function getTaskTotalDurationMap(
  supabase: SupabaseServerClient,
  taskIds: string[],
  nowIso = new Date().toISOString(),
) {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));

  if (uniqueTaskIds.length === 0) {
    return {} as Record<string, number>;
  }

  const { data, error } = await supabase
    .from("task_sessions")
    .select("task_id, started_at, ended_at, duration_seconds")
    .in("task_id", uniqueTaskIds);

  if (error) {
    throw new Error(`Failed to load task session totals: ${error.message}`);
  }

  return (data ?? []).reduce<Record<string, number>>((totals, session) => {
    const sessionDuration = getTaskSessionDurationSeconds(session, nowIso);
    totals[session.task_id] = (totals[session.task_id] ?? 0) + sessionDuration;
    return totals;
  }, {});
}

export function formatDurationLabel(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  }

  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }

  return `${secs}s`;
}
