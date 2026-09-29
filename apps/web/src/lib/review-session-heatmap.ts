import { getLocalDateInTimezone, getLocalDayWindow } from "@ega/domain";
import { createAuthenticatedActor, getTimeContextTimezone } from "@ega/application";
import { SupabaseTimeContextRepository } from "@ega/data-access";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { getTodayIsoDate, shiftIsoDateByDays } from "@/lib/review-week";
import {
  aggregateSessionEvidenceByLocalDay,
  buildLocalDateSeries,
  type SessionDayWindow,
} from "@/lib/session-day-aggregation";

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

export type DailyTrackedWindow = SessionDayWindow;

export const DEFAULT_DAILY_TRACKED_WINDOW_DAYS = 28;

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

/**
 * Consecutive local calendar dates for a window. Retained under the legacy
 * name for existing callers/tests; delegates to the shared series builder.
 */
export function buildUtcDateSeries(startDate: string, endDate: string) {
  return buildLocalDateSeries(startDate, endDate);
}

/**
 * Daily tracked seconds per local day. Delegates to the canonical shared
 * session-day aggregation (EGA-662) — one implementation for every surface.
 */
export function aggregateDailyTrackedSeconds(
  sessions: SessionRangeRow[],
  window: DailyTrackedWindow,
  nowIso = new Date().toISOString(),
): DailyTrackedTime[] {
  return aggregateSessionEvidenceByLocalDay(sessions, window, nowIso).map(
    ({ date, trackedSeconds }) => ({ date, trackedSeconds }),
  );
}

/**
 * Map-form variant retained for existing callers. Also delegates to the
 * shared aggregation so no second splitting algorithm exists.
 */
export function aggregateDailyTrackedSecondsForWindow(
  sessions: SessionRangeRow[],
  window: { startIso: string; endIso: string },
  dates: string[],
  timezone: string,
  nowIso = new Date().toISOString(),
): Map<string, number> {
  if (dates.length === 0) return new Map();
  const startWindow = getLocalDayWindow(timezone, dates[0] ?? "");
  const endWindow = getLocalDayWindow(timezone, dates[dates.length - 1] ?? "");
  const evidence = aggregateSessionEvidenceByLocalDay(
    sessions,
    {
      startDate: dates[0] ?? "",
      endDate: dates[dates.length - 1] ?? "",
      startIso: window.startIso || startWindow.startUtcIso,
      endExclusiveIso: window.endIso || endWindow.endUtcIso,
      timezone,
    },
    nowIso,
  );
  return new Map(evidence.map(({ date, trackedSeconds }) => [date, trackedSeconds]));
}

async function resolveHeatmapTimezone(
  supabase: SupabaseServerClient,
  ownerUserId: string | undefined,
): Promise<string> {
  if (!ownerUserId) return "UTC";
  try {
    const actor = createAuthenticatedActor(ownerUserId);
    const repository = new SupabaseTimeContextRepository(
      supabase as unknown as import("@supabase/supabase-js").SupabaseClient,
    );
    const result = await getTimeContextTimezone(actor, repository);
    const tz = result.ok ? result.data : null;
    if (typeof tz === "string" && tz.trim()) return tz.trim();
  } catch {
    // Explicit degraded fallback when Time Context cannot be resolved.
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
