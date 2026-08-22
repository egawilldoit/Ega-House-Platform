export type SessionDurationRow = Readonly<{
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
}>;

export type DayWindow = Readonly<{ startIso: string; endIso: string }>;

function toMs(iso: string): number | null {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getLocalDayWindow(now: Date): DayWindow {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return { startIso: dayStart.toISOString(), endIso: now.toISOString() };
}

export function getSessionDurationSeconds(
  session: SessionDurationRow,
  nowIso: string,
): number {
  const startMs = toMs(session.startedAt);
  const endMs = session.endedAt ? toMs(session.endedAt) : toMs(nowIso);

  if (startMs !== null && endMs !== null && endMs >= startMs) {
    return Math.floor((endMs - startMs) / 1000);
  }

  return typeof session.durationSeconds === "number" ? Math.max(0, session.durationSeconds) : 0;
}

export function getSessionOverlapSeconds(
  session: SessionDurationRow,
  window: DayWindow,
  nowIso: string,
): number {
  const startMs = toMs(session.startedAt);
  const endMs = session.endedAt ? toMs(session.endedAt) : toMs(nowIso);
  const windowStartMs = toMs(window.startIso);
  const windowEndMs = toMs(window.endIso);

  if (
    startMs === null ||
    endMs === null ||
    windowStartMs === null ||
    windowEndMs === null
  ) {
    return 0;
  }

  const overlapStart = Math.max(startMs, windowStartMs);
  const overlapEnd = Math.min(endMs, windowEndMs);

  return overlapEnd <= overlapStart ? 0 : Math.floor((overlapEnd - overlapStart) / 1000);
}

export function formatDurationLabel(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
