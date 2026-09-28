import { getLocalDateInTimezone, getLocalDayWindow, splitIntervalByLocalDay } from "@ega/domain";

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
  if (dateSeries.length === 0) return [];

  const rangeStartMs = parseIso(window.startIso);
  const rangeEndExclusiveMs = parseIso(window.endExclusiveIso);
  const nowMs = parseIso(nowIso);
  if (rangeStartMs === null || rangeEndExclusiveMs === null || nowMs === null) {
    return dateSeries.map((date) => ({ date, trackedSeconds: 0, sessionCount: 0 }));
  }

  const timezone = window.timezone || "UTC";
  let todayStartMs: number;
  try {
    const todayDate = getLocalDateInTimezone(new Date(nowMs), timezone);
    todayStartMs = Date.parse(getLocalDayWindow(timezone, todayDate).startUtcIso);
  } catch {
    todayStartMs = startOfUtcDayMs(nowMs);
  }

  const allowedDates = new Set(dateSeries);
  const totals = new Map<string, { trackedSeconds: number; sessionCount: number }>();

  for (const item of sessions) {
    const rawStartMs = parseIso(item.started_at);
    const isOpen = item.ended_at == null;
    const rawEndMs = parseIso(item.ended_at ?? nowIso);
    if (rawStartMs === null || rawEndMs === null || rawEndMs <= rawStartMs) continue;

    let overlapStartMs = Math.max(rawStartMs, rangeStartMs);
    const overlapEndMs = Math.min(rawEndMs, rangeEndExclusiveMs);
    // An open session contributes only to the current local day. This prevents
    // a stale open session from painting historical days.
    if (isOpen) overlapStartMs = Math.max(overlapStartMs, todayStartMs);
    if (overlapEndMs <= overlapStartMs) continue;

    // EGA-661 owns timezone/day-boundary semantics. This module owns only
    // session evidence policy (window clipping, stale-open handling, counting).
    for (const part of splitIntervalByLocalDay(timezone, overlapStartMs, overlapEndMs)) {
      if (!allowedDates.has(part.dayKey)) continue;
      const entry = totals.get(part.dayKey) ?? { trackedSeconds: 0, sessionCount: 0 };
      entry.trackedSeconds += part.seconds;
      entry.sessionCount += 1;
      totals.set(part.dayKey, entry);
    }
  }

  return dateSeries.map((date) => {
    const entry = totals.get(date) ?? { trackedSeconds: 0, sessionCount: 0 };
    return { date, trackedSeconds: entry.trackedSeconds, sessionCount: entry.sessionCount };
  });
}
