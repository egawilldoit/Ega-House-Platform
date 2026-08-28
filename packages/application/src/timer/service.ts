import { getLocalDayWindow } from "@ega/domain";

import {
  formatDurationLabel,
  getSessionDurationSeconds,
  getSessionOverlapSeconds,
  type DayWindow,
} from "../shared/duration";
import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TimerSessionRecord, TimerSessionRepository } from "./ports";

export type TimerActiveSession = Readonly<{
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedLabel: string;
  taskTitle: string;
}>;

export type TimerSummary = Readonly<{
  trackedTodaySeconds: number;
  trackedTodayLabel: string;
  trackedTotalSeconds: number;
  trackedTotalLabel: string;
  sessionsTodayCount: number;
  longestSessionSeconds: number | null;
  longestSessionLabel: string | null;
  longestSessionTaskTitle: string | null;
}>;

export type TimerWorkspace = Readonly<{
  activeSession: TimerActiveSession | null;
  summary: TimerSummary;
}>;

export function summarizeTimerSessions(
  sessions: readonly TimerSessionRecord[],
  nowIso: string,
  todayWindow?: DayWindow,
): TimerSummary {
  // Canonical Today window is ResolvedTimeContext.dayWindow or @ega/domain getLocalDayWindow.
  // Fallback is UTC-based and server-TZ independent.
  const window: DayWindow =
    todayWindow ??
    (() => {
      const now = new Date(nowIso);
      if (Number.isNaN(now.getTime())) return { startIso: nowIso, endIso: nowIso };
      const dateStr = now.toISOString().slice(0, 10);
      try {
        const canonical = getLocalDayWindow("UTC", dateStr);
        // Timer Today tracks [dayStart, now) within the canonical day, not full 24h.
        const endIso = nowIso < canonical.endUtcIso ? nowIso : canonical.endUtcIso;
        return { startIso: canonical.startUtcIso, endIso };
      } catch {
        return { startIso: nowIso, endIso: nowIso };
      }
    })();
  const durations = sessions.map(
    (session) => ({ session, seconds: getSessionDurationSeconds(session, nowIso) }),
  );

  let trackedTodaySeconds = 0;
  let sessionsTodayCount = 0;
  for (const { session } of durations) {
    const overlap = getSessionOverlapSeconds(session, window, nowIso);
    if (overlap > 0) {
      trackedTodaySeconds += overlap;
      sessionsTodayCount += 1;
    }
  }

  let longest: { seconds: number; taskTitle: string | null } | null = null;
  for (const { session, seconds } of durations) {
    if (!longest || seconds > longest.seconds) {
      longest = { seconds, taskTitle: session.taskTitle ?? "Untitled task" };
    }
  }

  const trackedTotalSeconds = durations.reduce((sum, entry) => sum + entry.seconds, 0);

  return {
    trackedTodaySeconds,
    trackedTodayLabel: formatDurationLabel(trackedTodaySeconds),
    trackedTotalSeconds,
    trackedTotalLabel: formatDurationLabel(trackedTotalSeconds),
    sessionsTodayCount,
    longestSessionSeconds: longest?.seconds ?? null,
    longestSessionLabel: typeof longest?.seconds === "number" ? formatDurationLabel(longest.seconds) : null,
    longestSessionTaskTitle: longest?.taskTitle ?? null,
  };
}

function toActiveSession(
  session: TimerSessionRecord,
  nowIso: string,
): TimerActiveSession {
  return {
    sessionId: session.id,
    taskId: session.taskId,
    startedAt: session.startedAt,
    elapsedLabel: formatDurationLabel(getSessionDurationSeconds(session, nowIso)),
    taskTitle: session.taskTitle ?? "Untitled task",
  };
}

export async function getTimerWorkspace(
  actor: AuthenticatedActor,
  repository: TimerSessionRepository,
  input: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<TimerWorkspace>> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const [openResult, recentResult] = await Promise.all([
    repository.listOpenSessions(actor),
    repository.listRecentSessions(actor, { limit: 150 }),
  ]);

  if (!openResult.ok) return applicationFailure("Unable to load the timer workspace right now.");
  if (!recentResult.ok) return applicationFailure("Unable to load the timer workspace right now.");

  const openSessions = [...openResult.value].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
  const activeSession = openSessions[0] ? toActiveSession(openSessions[0], nowIso) : null;

  return applicationSuccess({
    activeSession,
    summary: summarizeTimerSessions(recentResult.value, nowIso),
  });
}

export async function startTaskSession(
  actor: AuthenticatedActor,
  repository: TimerSessionRepository,
  input: Readonly<{ taskId: unknown }>,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<TimerActiveSession>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task is required.");

  const startedAtIso = (options.now ?? new Date()).toISOString();

  const taskResult = await repository.getStartableTask(actor, { taskId });
  if (!taskResult.ok) return applicationFailure("Unable to verify the task right now.");
  if (!taskResult.value) return applicationFailure("Task is unavailable.");
  if (!taskResult.value.eligible) {
    return applicationFailure(taskResult.value.reason ?? "This task cannot start a timer.");
  }

  const openResult = await repository.listOpenSessions(actor);
  if (!openResult.ok) return applicationFailure("Unable to verify running timers right now.");
  if (openResult.value.length > 0) {
    return applicationFailure("A timer is already running. Stop it before starting a new one.");
  }

  const insertResult = await repository.insertOpenSession(actor, { taskId, startedAtIso });
  if (!insertResult.ok) {
    return applicationFailure(
      insertResult.error.code === "conflict"
        ? "A timer is already running. Stop it before starting a new one."
        : "Unable to start the timer right now.",
    );
  }

  return applicationSuccess(toActiveSession(insertResult.value, startedAtIso));
}

export async function stopTaskSession(
  actor: AuthenticatedActor,
  repository: TimerSessionRepository,
  input: Readonly<{ sessionId?: unknown }>,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<Readonly<{ sessionId: string; taskId: string }>>> {
  const requestedSessionId = String(input.sessionId ?? "").trim();

  const openResult = await repository.listOpenSessions(actor);
  if (!openResult.ok) return applicationFailure("Unable to load running timers right now.");

  const openSessions = [...openResult.value].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );

  const target = requestedSessionId
    ? openSessions.find((session) => session.id === requestedSessionId)
    : openSessions[0];

  if (!target) {
    return applicationFailure("No running timer session matches this request.");
  }

  const endedAtIso = (options.now ?? new Date()).toISOString();
  const durationSeconds = getSessionDurationSeconds(target, endedAtIso);

  const finalizeResult = await repository.finalizeOpenSession(actor, {
    sessionId: target.id,
    endedAtIso,
    durationSeconds,
  });
  if (!finalizeResult.ok) return applicationFailure("Unable to stop the timer right now.");
  if (!finalizeResult.value) {
    return applicationFailure("That timer session is no longer running.");
  }

  return applicationSuccess({ sessionId: target.id, taskId: target.taskId });
}
