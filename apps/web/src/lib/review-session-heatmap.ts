import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import { getTodayIsoDate, shiftIsoDateByDays } from "@/lib/review-week";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type SessionRangeRow = Pick<Tables<"task_sessions">, "started_at" | "ended_at">;

export type DailyTrackedTime = {
  date: string;
  trackedSeconds: number;
};

export type DailyTrackedWindow = {
  startDate: string;
  endDate: string;
  startIso: string;
  endExclusiveIso: string;
};

export const DEFAULT_DAILY_TRACKED_WINDOW_DAYS = 28;

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

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

export function getDailyTrackedWindow(
  days = DEFAULT_DAILY_TRACKED_WINDOW_DAYS,
  endDate = getTodayIsoDate(),
): DailyTrackedWindow {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : DEFAULT_DAILY_TRACKED_WINDOW_DAYS;
  const startDate = shiftIsoDateByDays(endDate, -(safeDays - 1));

  return {
    startDate,
    endDate,
    startIso: `${startDate}T00:00:00.000Z`,
    endExclusiveIso: `${shiftIsoDateByDays(endDate, 1)}T00:00:00.000Z`,
  };
}

export function buildUtcDateSeries(startDate: string, endDate: string) {
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

export function aggregateDailyTrackedSeconds(
  sessions: SessionRangeRow[],
  window: DailyTrackedWindow,
  nowIso = new Date().toISOString(),
): DailyTrackedTime[] {
  const dateSeries = buildUtcDateSeries(window.startDate, window.endDate);

  if (dateSeries.length === 0) {
    return [];
  }

  const rangeStartMs = parseIso(window.startIso);
  const rangeEndExclusiveMs = parseIso(window.endExclusiveIso);
  const nowMs = parseIso(nowIso);

  if (rangeStartMs === null || rangeEndExclusiveMs === null || nowMs === null) {
    return dateSeries.map((date) => ({ date, trackedSeconds: 0 }));
  }

  const totals = new Map<string, number>();

  for (const session of sessions) {
    const rawStartMs = parseIso(session.started_at);
    const rawEndMs = parseIso(session.ended_at ?? nowIso);

    if (rawStartMs === null || rawEndMs === null || rawEndMs <= rawStartMs) {
      continue;
    }

    const overlapStartMs = Math.max(rawStartMs, rangeStartMs);
    const overlapEndMs = Math.min(rawEndMs, rangeEndExclusiveMs);

    if (overlapEndMs <= overlapStartMs) {
      continue;
    }

    let cursorMs = overlapStartMs;

    while (cursorMs < overlapEndMs) {
      const dayStartMs = startOfUtcDayMs(cursorMs);
      const dayEndMs = dayStartMs + DAY_IN_MS;
      const segmentEndMs = Math.min(overlapEndMs, dayEndMs);
      const segmentSeconds = Math.floor((segmentEndMs - cursorMs) / 1000);

      if (segmentSeconds > 0) {
        const dayKey = toIsoDate(new Date(dayStartMs));
        totals.set(dayKey, (totals.get(dayKey) ?? 0) + segmentSeconds);
      }

      cursorMs = segmentEndMs;
    }
  }

  return dateSeries.map((date) => ({ date, trackedSeconds: totals.get(date) ?? 0 }));
}

export async function getRecentDailyTrackedTime(
  supabase: SupabaseServerClient,
  {
    days = DEFAULT_DAILY_TRACKED_WINDOW_DAYS,
    endDate = getTodayIsoDate(),
    nowIso = new Date().toISOString(),
    ownerUserId,
  }: {
    days?: number;
    endDate?: string;
    nowIso?: string;
    ownerUserId?: string;
  } = {},
): Promise<DailyTrackedTime[]> {
  const window = getDailyTrackedWindow(days, endDate);
  let query = supabase
    .from("task_sessions")
    .select("started_at, ended_at")
    .lt("started_at", window.endExclusiveIso)
    .or(`ended_at.is.null,ended_at.gte.${window.startIso}`);

  if (ownerUserId) {
    query = query.eq("owner_user_id", ownerUserId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load session heatmap data: ${error.message}`);
  }

  return aggregateDailyTrackedSeconds(data ?? [], window, nowIso);
}
