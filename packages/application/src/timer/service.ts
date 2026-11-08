import { getLocalDayWindow } from "@ega/domain";

import {
  formatDurationLabel,
  getSessionDurationSeconds,
  getSessionOverlapSeconds,
  type DayWindow,
} from "../shared/duration";
import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import { resolveTimeContext, type TimeContextRepository } from "../shared/time-context";
import type { TimerSessionRecord, TimerSessionRepository } from "./ports";

/**
 * Canonical timer failure messages. Transport layers map these to protocol
 * error codes without duplicating the wording.
 */
export const TIMER_ALREADY_RUNNING_MESSAGE =
  "A timer is already running. Stop it before starting a new one.";
export const TIMER_TASK_UNAVAILABLE_MESSAGE = "Task is unavailable.";
export const TIMER_NO_OPEN_SESSION_MATCH_MESSAGE =
  "No running timer session matches this request.";
export const TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE =
  "That timer session is no longer running.";
export const TIMER_SESSION_ID_REQUIRED_MESSAGE =
  "A timer session id is required to stop the timer.";

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

/**
 * Result of an idempotent stop request. `already_stopped` is a successful
 * acknowledgement for a session that was already finalized by an earlier or
 * concurrent request; it performs no second write.
 */
export type TimerStopOutcome = Readonly<{
  status: "stopped" | "already_stopped";
  sessionId: string;
  taskId: string;
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
  timeContextRepository: TimeContextRepository,
  input: Readonly<{ now?: Date; timezone?: unknown }> = {},
): Promise<ApplicationResult<TimerWorkspace>> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return applicationFailure("Current time is invalid.");
  }
  const nowIso = now.toISOString();
  const requestedTimezone =
    typeof input.timezone === "string" ? input.timezone.trim() : null;

  const timeContextResult = await resolveTimeContext(actor, timeContextRepository, {
    requestedTimezone: requestedTimezone ?? undefined,
    now,
  });
  if (!timeContextResult.ok) {
    return applicationFailure("Unable to load the timer workspace right now.");
  }

  const dayWindow = timeContextResult.data.dayWindow;
  const window: DayWindow = {
    startIso: dayWindow.startUtcIso,
    endIso: nowIso < dayWindow.endUtcIso ? nowIso : dayWindow.endUtcIso,
  };

  const [openResult, recentResult] = await Promise.all([
    repository.listOpenSessions(actor),
    repository.listSummarySessions(actor),
  ]);

  if (!openResult.ok) return applicationFailure("Unable to load the timer workspace right now.");
  if (!recentResult.ok) return applicationFailure("Unable to load the timer workspace right now.");

  const openSessions = [...openResult.value].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
  const activeSession = openSessions[0] ? toActiveSession(openSessions[0], nowIso) : null;

  return applicationSuccess({
    activeSession,
    summary: summarizeTimerSessions(recentResult.value, nowIso, window),
  });
}

export async function startTaskSession(
  actor: AuthenticatedActor,
  repository: TimerSessionRepository,
  input: Readonly<{
    taskId: unknown;
    mcpOperationId?: string;
    mcpClientId?: string;
  }>,
  options: Readonly<{ now?: Date }> = {},
): Promise<ApplicationResult<TimerActiveSession>> {
  const taskId = String(input.taskId ?? "").trim();
  if (!taskId) return applicationFailure("Task is required.");

  const startedAtIso = (options.now ?? new Date()).toISOString();

  const operationIdentity = input.mcpOperationId && input.mcpClientId
    ? { mcpOperationId: input.mcpOperationId, mcpClientId: input.mcpClientId }
    : null;

  // A retry after the domain INSERT committed must replay before validating
  // mutable task state. The operation index is the canonical proof that this
  // is the original timer start, even if the task changed after the crash.
  if (operationIdentity) {
    const replayResult = await repository.findSessionByOperation(actor, operationIdentity);
    if (!replayResult.ok) return applicationFailure("Unable to verify the timer operation right now.");
    if (replayResult.value) return applicationSuccess(toActiveSession(replayResult.value, startedAtIso));
  }

  const taskResult = await repository.getStartableTask(actor, { taskId });
  if (!taskResult.ok) return applicationFailure("Unable to verify the task right now.");
  if (!taskResult.value) return applicationFailure(TIMER_TASK_UNAVAILABLE_MESSAGE);
  if (!taskResult.value.eligible) {
    return applicationFailure(taskResult.value.reason ?? "This task cannot start a timer.");
  }

  // A fenced MCP create must reach the domain INSERT before the open-session
  // pre-check. After a crash, the operation index is the canonical replay
  // proof; the pre-check alone cannot distinguish replay from a new timer.
  if (!operationIdentity) {
    const openResult = await repository.listOpenSessions(actor);
    if (!openResult.ok) return applicationFailure("Unable to verify running timers right now.");
    if (openResult.value.length > 0) {
      return applicationFailure(TIMER_ALREADY_RUNNING_MESSAGE);
    }
  }

  const insertResult = await repository.insertOpenSession(actor, {
    taskId,
    startedAtIso,
    ...(operationIdentity ?? {}),
  });
  if (!insertResult.ok) {
    return applicationFailure(
      insertResult.error.code === "conflict"
        ? TIMER_ALREADY_RUNNING_MESSAGE
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
): Promise<ApplicationResult<TimerStopOutcome>> {
  const sessionId = String(input.sessionId ?? "").trim();
  if (!sessionId) return applicationFailure(TIMER_SESSION_ID_REQUIRED_MESSAGE);

  // Stop must target the exact session the caller observed. Falling back to a
  // "newest open" session can end a different device's newer timer.
  const foundResult = await repository.findSessionById(actor, { sessionId });
  if (!foundResult.ok) return applicationFailure("Unable to load running timers right now.");
  const session = foundResult.value;
  if (!session) return applicationFailure(TIMER_NO_OPEN_SESSION_MATCH_MESSAGE);

  if (session.endedAt !== null) {
    return applicationSuccess({
      status: "already_stopped",
      sessionId: session.id,
      taskId: session.taskId,
    });
  }

  const endedAtIso = (options.now ?? new Date()).toISOString();
  const durationSeconds = getSessionDurationSeconds(session, endedAtIso);

  const finalizeResult = await repository.finalizeOpenSession(actor, {
    sessionId: session.id,
    endedAtIso,
    durationSeconds,
  });
  if (!finalizeResult.ok) return applicationFailure("Unable to stop the timer right now.");
  if (finalizeResult.value) {
    return applicationSuccess({
      status: "stopped",
      sessionId: session.id,
      taskId: session.taskId,
    });
  }

  // A concurrent request finalized the row between our read and UPDATE. Re-read
  // the same id: an ended row is an idempotent success; a still-open row means
  // the fenced write failed for another reason.
  const rereadResult = await repository.findSessionById(actor, { sessionId });
  if (!rereadResult.ok) return applicationFailure("Unable to load running timers right now.");
  if (rereadResult.value?.endedAt) {
    return applicationSuccess({
      status: "already_stopped",
      sessionId: rereadResult.value.id,
      taskId: rereadResult.value.taskId,
    });
  }

  return applicationFailure(TIMER_SESSION_NO_LONGER_RUNNING_MESSAGE);
}
