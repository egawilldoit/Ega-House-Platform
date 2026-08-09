export function getElapsedDurationSeconds(startedAtIso: string, now = Date.now()) {
  const startedAtMs = new Date(startedAtIso).getTime();

  if (!Number.isFinite(startedAtMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((now - startedAtMs) / 1000));
}

export function formatDurationClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function formatTimerDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
