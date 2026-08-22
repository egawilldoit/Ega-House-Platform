/**
 * Elapsed seconds for a server-authoritative session at instant `nowMs`.
 *
 * Pure projection of the canonical server timestamp: recomputed on every
 * call, never accumulated from local ticks. Returns null when the server
 * timestamp is missing or unparsable so callers can fall back to the
 * server-provided label instead of inventing a value.
 */
export function projectElapsedSeconds(startedAtIso: string, nowMs: number): number | null {
  const startedMs = Date.parse(startedAtIso);
  if (Number.isNaN(startedMs)) {
    return null;
  }

  const elapsedSeconds = Math.floor((nowMs - startedMs) / 1000);
  return elapsedSeconds > 0 ? elapsedSeconds : 0;
}

export function formatElapsedClock(totalSeconds: number): string {
  const safeSeconds = totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const minutePart = String(minutes).padStart(2, '0');
  const secondPart = String(seconds).padStart(2, '0');

  return hours > 0 ? `${hours}:${minutePart}:${secondPart}` : `${minutePart}:${secondPart}`;
}
