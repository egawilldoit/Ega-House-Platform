import { getLocalDateInTimezone, getLocalDayWindow } from "@ega/domain";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getTodayIsoDate, shiftIsoDateByDays } from "@/lib/review-week";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function isValidWindowIso(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

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
  timezone: string;
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
  timezone: string | null | undefined = "UTC",
): DailyTrackedWindow {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : DEFAULT_DAILY_TRACKED_WINDOW_DAYS;
  const startDate = shiftIsoDateByDays(endDate, -(safeDays - 1));
  const tz = typeof timezone === "string" && timezone.trim() ? timezone.trim() : "UTC";

  try {
    const startWindow = getLocalDayWindow(tz, startDate);
    const endWindow = getLocalDayWindow(tz, endDate);
    return {
      startDate,
      endDate,
      startIso: startWindow.startUtcIso,
      endExclusiveIso: endWindow.endUtcIso,
      timezone: startWindow.timezone,
    };
  } catch {
    return {
      startDate,
      endDate,
      startIso: `${startDate}T00:00:00.000Z`,
      endExclusiveIso: `${shiftIsoDateByDays(endDate, 1)}T00:00:00.000Z`,
      timezone: "UTC",
    };
  }
}

export function getDailyTrackedWindowForTimezone(
  days: number,
  endDate: string,
  timezone: string | null | undefined,
): DailyTrackedWindow {
  return getDailyTrackedWindow(days, endDate, timezone);
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

  const tz = window.timezone ?? "UTC";
  const useLocal = tz !== "UTC";

  // Build local day boundaries for each date in the series when timezone is non-UTC
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
        // fallback to UTC boundaries for that date
        const s = toUtcDateStartMs(date);
        if (s !== null) localDayBounds.set(date, { startMs: s, endMs: s + DAY_IN_MS });
      }
    }
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

    if (useLocal && localDayBounds) {
      for (const date of dateSeries) {
        const bounds = localDayBounds.get(date);
        if (!bounds) continue;
        const dayOverlapStart = Math.max(overlapStartMs, bounds.startMs);
        const dayOverlapEnd = Math.min(overlapEndMs, bounds.endMs);
        if (dayOverlapEnd > dayOverlapStart) {
          const segmentSeconds = Math.floor((dayOverlapEnd - dayOverlapStart) / 1000);
          if (segmentSeconds > 0) totals.set(date, (totals.get(date) ?? 0) + segmentSeconds);
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
          totals.set(dayKey, (totals.get(dayKey) ?? 0) + segmentSeconds);
        }
        cursorMs = segmentEndMs;
      }
    }
  }

  return dateSeries.map((date) => ({ date, trackedSeconds: totals.get(date) ?? 0 }));
}

export function aggregateDailyTrackedSecondsForWindow(
  sessions: SessionRangeRow[],
  window: { startIso: string; endIso: string },
  dates: string[],
  timezone: string,
  nowIso = new Date().toISOString(),
): Map<string, number> {
  const totals = new Map<string, number>();
  const windowStartMs = parseIso(window.startIso);
  const windowEndMs = parseIso(window.endIso);
  const nowMs = parseIso(nowIso);
  if (windowStartMs === null || windowEndMs === null || nowMs === null) return totals;

  const bounds = new Map<string, { startMs: number; endMs: number }>();
  for (const date of dates) {
    try {
      const w = getLocalDayWindow(timezone, date);
      const s = parseIso(w.startUtcIso);
      const e = parseIso(w.endUtcIso);
      if (s !== null && e !== null) bounds.set(date, { startMs: s, endMs: e });
    } catch {
      continue;
    }
  }

  for (const session of sessions) {
    const rawStartMs = parseIso(session.started_at);
    const rawEndMs = parseIso(session.ended_at ?? nowIso);
    if (rawStartMs === null || rawEndMs === null || rawEndMs <= rawStartMs) continue;
    const overlapStartMs = Math.max(rawStartMs, windowStartMs);
    const overlapEndMs = Math.min(rawEndMs, windowEndMs);
    if (overlapEndMs <= overlapStartMs) continue;
    for (const date of dates) {
      const b = bounds.get(date);
      if (!b) continue;
      const s = Math.max(overlapStartMs, b.startMs);
      const e = Math.min(overlapEndMs, b.endMs);
      if (e > s) {
        const secs = Math.floor((e - s) / 1000);
        if (secs > 0) totals.set(date, (totals.get(date) ?? 0) + secs);
      }
    }
  }
  return totals;
}

async function resolveHeatmapTimezone(
  supabase: SupabaseServerClient,
  ownerUserId: string | undefined,
): Promise<string> {
  if (!ownerUserId) return "UTC";
  try {
    const result = await (supabase as unknown as {
      from(t: string): {
        select(c: string): { eq(a: string, b: string): { maybeSingle(): Promise<{ data: unknown; error: unknown }> } };
      };
    })
      .from("user_time_context")
      .select("iana_timezone")
      .eq("user_id", ownerUserId)
      .maybeSingle();
    const tz = (result.data as { iana_timezone?: string | null } | null)?.iana_timezone;
    if (typeof tz === "string" && tz.trim()) return tz.trim();
  } catch {
    // ignore and fallback to UTC
  }
  return "UTC";
}

export async function getRecentDailyTrackedTime(
  supabase: SupabaseServerClient,
  {
    days = DEFAULT_DAILY_TRACKED_WINDOW_DAYS,
    endDate,
    nowIso = new Date().toISOString(),
    ownerUserId,
    timezone,
    window,
  }: {
    days?: number;
    endDate?: string;
    nowIso?: string;
    ownerUserId?: string;
    timezone?: string | null;
    window?: DailyTrackedWindow | { startIso: string; endExclusiveIso: string; startDate: string; endDate: string; timezone?: string };
  } = {},
): Promise<DailyTrackedTime[]> {
  let resolvedWindow: DailyTrackedWindow;

  if (window) {
    if (!isValidWindowIso(window.startIso) || !isValidWindowIso(window.endExclusiveIso)) {
      throw new Error("Invalid window for session heatmap.");
    }
    const startDate = (window as DailyTrackedWindow).startDate ?? window.startIso.slice(0, 10);
    const endDateIso = (window as DailyTrackedWindow).endDate ?? window.endExclusiveIso.slice(0, 10);
    resolvedWindow = {
      startDate,
      endDate: endDateIso,
      startIso: window.startIso,
      endExclusiveIso: window.endExclusiveIso,
      timezone: (window as DailyTrackedWindow).timezone ?? timezone ?? "UTC",
    };
  } else {
    let tz = timezone ?? null;
    let resolvedEndDate = endDate ?? null;

    if (!tz && ownerUserId) {
      tz = await resolveHeatmapTimezone(supabase, ownerUserId);
    }
    const effectiveTz = tz ?? "UTC";

    if (!resolvedEndDate) {
      try {
        const nowDate = new Date(nowIso);
        resolvedEndDate = Number.isFinite(nowDate.getTime())
          ? getLocalDateInTimezone(nowDate, effectiveTz)
          : getTodayIsoDate();
      } catch {
        resolvedEndDate = getTodayIsoDate();
      }
    }
    resolvedWindow = getDailyTrackedWindow(days, resolvedEndDate, effectiveTz);
  }

  if (!isValidWindowIso(resolvedWindow.startIso) || !isValidWindowIso(resolvedWindow.endExclusiveIso)) {
    throw new Error("Invalid window for session heatmap.");
  }

  let query = supabase
    .from("task_sessions")
    .select("started_at, ended_at")
    .lt("started_at", resolvedWindow.endExclusiveIso)
    .or(`ended_at.is.null,ended_at.gte.${resolvedWindow.startIso}`);

  if (ownerUserId) {
    query = query.eq("owner_user_id", ownerUserId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load session heatmap data: ${error.message}`);
  }

  return aggregateDailyTrackedSeconds(data ?? [], resolvedWindow, nowIso);
}
