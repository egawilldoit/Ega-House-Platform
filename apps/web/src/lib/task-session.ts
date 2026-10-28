import { createClient } from "@/lib/supabase/server";
import { getCurrentLocalDayWindow } from "@ega/domain/time-context";
import {
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
  sessionOverlapsWindow,
  type SessionWindow,
  type TaskSessionDurationRow,
} from "@/lib/session-duration";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export {
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
  sessionOverlapsWindow,
} from "@/lib/session-duration";
export type { SessionWindow, TaskSessionDurationRow } from "@/lib/session-duration";

export function getCurrentDayWindow(now = new Date(), timezone?: string): SessionWindow {
  if (timezone) {
    const dayWindow = getCurrentLocalDayWindow(timezone, now);
    return {
      startIso: dayWindow.startUtcIso,
      endIso: now.toISOString(),
    };
  }
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  return {
    startIso: dayStart.toISOString(),
    endIso: now.toISOString(),
  };
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

  const totals: Record<string, number> = {};
  const chunkSize = 200;

  for (let index = 0; index < uniqueTaskIds.length; index += chunkSize) {
    const chunk = uniqueTaskIds.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("task_sessions")
      .select("task_id, started_at, ended_at, duration_seconds")
      .in("task_id", chunk);

    if (error) {
      throw new Error(`Failed to load task session totals: ${error.message}`);
    }

    for (const session of data ?? []) {
      const sessionDuration = getTaskSessionDurationSeconds(session, nowIso);
      totals[session.task_id] = (totals[session.task_id] ?? 0) + sessionDuration;
    }
  }

  return totals;
}

export type TaskSessionSummary = {
  totalSeconds: number;
  weekSeconds: number;
  weekSessionCount: number;
};

/**
 * One bounded session read for a Task scope, summarized for both lifetime
 * tracked time and a supplied week window. Callers pass every Task id whose
 * historical time should be retained (including archived Tasks).
 */
export async function getTaskSessionSummaryMap(
  supabase: SupabaseServerClient,
  taskIds: string[],
  weekWindow: SessionWindow,
  nowIso = new Date().toISOString(),
): Promise<{
  sessions: TaskSessionDurationRow[];
  byTask: Record<string, TaskSessionSummary>;
}> {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));

  if (uniqueTaskIds.length === 0) {
    return { sessions: [], byTask: {} };
  }

  const { data, error } = await supabase
    .from("task_sessions")
    .select("task_id, started_at, ended_at, duration_seconds")
    .in("task_id", uniqueTaskIds);

  if (error) {
    throw new Error(`Failed to load task session totals: ${error.message}`);
  }

  const sessions = (data ?? []) as TaskSessionDurationRow[];
  const summaries: Record<string, TaskSessionSummary> = {};

  for (const session of sessions) {
    const summary = summaries[session.task_id] ?? {
      totalSeconds: 0,
      weekSeconds: 0,
      weekSessionCount: 0,
    };

    summary.totalSeconds += getTaskSessionDurationSeconds(session, nowIso);
    summary.weekSeconds += getSessionDurationWithinWindowSeconds(session, weekWindow, nowIso);
    if (sessionOverlapsWindow(session, weekWindow, nowIso)) {
      summary.weekSessionCount += 1;
    }

    summaries[session.task_id] = summary;
  }

  return { sessions, byTask: summaries };
}

// Keep the web import surface stable while using the application-owned formatter.
export { formatDurationLabel } from "@ega/application/shared/duration";
