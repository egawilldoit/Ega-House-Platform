type OpenSession = {
  id: string;
  started_at: string;
};

type CloseSessionUpdate = {
  id: string;
  endedAtIso: string;
  durationSeconds: number;
};

export type SessionConflictResolution = {
  canonicalSessionId: string;
  sessionsToClose: CloseSessionUpdate[];
};

function toMs(value: string) {
  return new Date(value).getTime();
}

function getSafeDurationSeconds(startedAtIso: string, endedAtIso: string) {
  return Math.max(0, Math.floor((toMs(endedAtIso) - toMs(startedAtIso)) / 1000));
}

export function resolveSessionConflict(
  openSessions: OpenSession[],
  nowIso: string,
): SessionConflictResolution | null {
  if (openSessions.length <= 1) {
    return null;
  }

  const sorted = [...openSessions].sort(
    (left, right) =>
      toMs(right.started_at) - toMs(left.started_at) ||
      right.id.localeCompare(left.id),
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
