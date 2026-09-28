import { getLocalDateInTimezone, getLocalDayWindow } from "@ega/domain";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical timezone-aware session-day aggregation (EGA-662).
 *
 * Owner: every local-day session breakdown in the product (Review session
 * heatmap, Work Activity calendar). One shared pure helper — there is no
 * second yearly session-splitting algorithm.
 *
 * Policy:
 * - Day boundaries come from the EGA-661 canonical Time Context
 *   (`getLocalDayWindow` / `getLocalDateInTimezone`), never from a second
 *   timezone implementation and never from the server process timezone.
 * - A closed session is clipped to the evidence window and split across every
 *   local day it overlaps.
 * - An open session is provisional evidence for the CURRENT local day only,
 *   bounded by the injected query `now`. A stale multi-day open session must
 *   not silently paint weeks of historical activity.
 * - Every local date in [startDate, endDate] is present exactly once,
 *   including zero-activity dates.
 */

export type SessionDayWindow = {
  startDate: string;
  endDate: string;
  startIso: string;
  endExclusiveIso: string;
  timezone: string;
};

export type SessionDayEvidence = {
  date: string;
  trackedSeconds: number;
  sessionCount: number;
};

export type SessionRangeRow = {
  started_at: string;
  ended_at: string | null;
};

function parseIso(iso: string) {
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

function toUtcDateStartMs(isoDate: string) {
  return parseIso(`${isoDate}T00:00:00.000Z`);
}

function startOfUtcDayMs(ms: number) {
  const date = new Date(ms);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Consecutive local calendar dates, inclusive, as YYYY-MM-DD strings. */
export function buildLocalDateSeries(startDate: string, endDate: string): string[] {
  const startMs = toUtcDateStartMs(startDate);
  const endMs = toUtcDateStartMs(endDate);

  if (startMs === null || endMs === null || endMs < startMs) {
    return [] as string[];
  }

  const dates: string[] = [];
  for (let cursor = startMs; cursor <= endMs; cursor += DAY_IN_MS) {
    dates.push(toIsoDate(new Date(cursor)));
  }

  return dates;
}

/**
 * Aggregates session evidence per local calendar day for the given window.
 * Pure: same inputs always produce the same daily series.
 */
export function aggregateSessionEvidenceByLocalDay(
  sessions: SessionRangeRow[],
  window: SessionDayWindow,
  nowIso = new Date().toISOString(),
): SessionDayEvidence[] {
  const dateSeries = buildLocalDateSeries(window.startDate, window.endDate);

  if (dateSeries.length === 0) {
    return [];
  }

  const rangeStartMs = parseIso(window.startIso);
  const rangeEndExclusiveMs = parseIso(window.endExclusiveIso);
  const nowMs = parseIso(nowIso);

  if (rangeStartMs === null || rangeEndExclusiveMs === null || nowMs === null) {
    return dateSeries.map((date) => ({ date, trackedSeconds: 0, sessionCount: 0 }));
  }

  const tz = window.timezone ?? "UTC";
  const useLocal = tz !== "UTC";

  // Build local day boundaries for each date in the series when timezone is non-UTC.
  let localDayBounds: Map<string, { startMs: number; endMs: number }> | null = null;
  if (useLocal) {
    localDayBounds = new Map();
    for (const date of dateSeries) {
      try {
        const w = getLocalDayWindow(tz, date);
        const s = parseIso(w.startUtcIso);
        const e = parseIso(w.endUtcIso);
        if (s !== null && e !== null) localDayBounds.set(date, { startMs: s, endMs: e });
      } catch {
        const s = toUtcDateStartMs(date);
        if (s !== null) localDayBounds.set(date, { startMs: s, endMs: s + DAY_IN_MS });
      }
    }
  }

  // Open sessions contribute to the current local day only, bounded by now.
  let todayStartMs: number;
  if (useLocal) {
    try {
      const todayDate = getLocalDateInTimezone(new Date(nowMs), tz);
      const todayWindow = getLocalDayWindow(tz, todayDate);
      const parsed = parseIso(todayWindow.startUtcIso);
      todayStartMs = parsed ?? startOfUtcDayMs(nowMs);
    } catch {
      todayStartMs = startOfUtcDayMs(nowMs);
    }
  } else {
    todayStartMs = startOfUtcDayMs(nowMs);
  }

  const totals = new Map<string, { trackedSeconds: number; sessionCount: number }>();

  for (const session of sessions) {
    const rawStartMs = parseIso(session.started_at);
    const isOpen = session.ended_at === null || session.ended_at === undefined;
    const rawEndMs = parseIso(session.ended_at ?? nowIso);

    if (rawStartMs === null || rawEndMs === null || rawEndMs <= rawStartMs) {
      continue;
    }

    let overlapStartMs = Math.max(rawStartMs, rangeStartMs);
    const overlapEndMs = Math.min(rawEndMs, rangeEndExclusiveMs);

    if (isOpen) {
      overlapStartMs = Math.max(overlapStartMs, todayStartMs);
    }

    if (overlapEndMs <= overlapStartMs) {
      continue;
    }

    if (useLocal && localDayBounds) {
      for (const date of dateSeries) {
        const bounds = localDayBounds.get(date);
        if (!bounds) continue;
        const dayOverlapStart = Math.max(overlapStartMs, bounds.startMs);
        const dayOverlapEnd = Math.min(overlapEndMs, bounds.endMs);
        if (dayOverlapEnd > dayOverlapStart) {
          const segmentSeconds = Math.floor((dayOverlapEnd - dayOverlapStart) / 1000);
          if (segmentSeconds > 0) {
            const entry = totals.get(date) ?? { trackedSeconds: 0, sessionCount: 0 };
            entry.trackedSeconds += segmentSeconds;
            entry.sessionCount += 1;
            totals.set(date, entry);
          }
        }
      }
    } else {
      let cursorMs = overlapStartMs;
      while (cursorMs < overlapEndMs) {
        const dayStartMs = startOfUtcDayMs(cursorMs);
        const dayEndMs = dayStartMs + DAY_IN_MS;
        const segmentEndMs = Math.min(overlapEndMs, dayEndMs);
        const segmentSeconds = Math.floor((segmentEndMs - cursorMs) / 1000);
        if (segmentSeconds > 0) {
          const dayKey = toIsoDate(new Date(dayStartMs));
          const entry = totals.get(dayKey) ?? { trackedSeconds: 0, sessionCount: 0 };
          entry.trackedSeconds += segmentSeconds;
          entry.sessionCount += 1;
          totals.set(dayKey, entry);
        }
        cursorMs = segmentEndMs;
      }
    }
  }

  return dateSeries.map((date) => {
    const entry = totals.get(date) ?? { trackedSeconds: 0, sessionCount: 0 };
    return { date, trackedSeconds: entry.trackedSeconds, sessionCount: entry.sessionCount };
  });
}
