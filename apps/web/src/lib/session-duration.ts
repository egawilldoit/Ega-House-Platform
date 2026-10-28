/**
 * Pure Timer/Focus session duration math.
 *
 * Kept free of database imports so read models and components can share the
 * same overlap rule without pulling in a Supabase client.
 */

export type TaskSessionDurationRow = {
  task_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
};

export type SessionWindow = {
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

  if (sessionStartMs !== null && sessionEndMs !== null && sessionEndMs >= sessionStartMs) {
    return Math.floor((sessionEndMs - sessionStartMs) / 1000);
  }

  if (typeof session.duration_seconds === "number") {
    return Math.max(0, session.duration_seconds);
  }

  return 0;
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

export function sessionOverlapsWindow(
  session: TaskSessionDurationRow,
  window: SessionWindow,
  nowIso = new Date().toISOString(),
) {
  return getSessionDurationWithinWindowSeconds(session, window, nowIso) > 0;
}
