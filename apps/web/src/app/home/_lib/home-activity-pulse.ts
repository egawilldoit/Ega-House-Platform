import { getLocalDateInTimezone } from "@ega/domain";
import { SupabaseTimeContextRepository } from "@ega/data-access";
import { createAuthenticatedActor } from "@ega/application/auth/actor";

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { getWorkAnalyticsSessionsForWindow } from "@/lib/services/work-analytics-data-adapter";
import {
  aggregateDailyTrackedSeconds,
  getDailyTrackedWindow,
} from "@/lib/review-session-heatmap";
import { shiftIsoDateByDays } from "@/lib/review-week";

/**
 * Home Activity Pulse — server-composed summary seam (EGA-662 binding point).
 *
 * Home renders a compact activity pulse (streak, active days, tracked time,
 * and a small intensity grid) sourced ONLY from the canonical Work Activity
 * read model. Home never queries sessions, tasks, or streaks itself: the whole
 * data path lives in `loadActivityPulse()` below, which is the single place
 * to rebind when EGA-662 lands.
 *
 * EGA-662 integration point: replace the body of `loadActivityPulse()` with a
 * call to the canonical `buildWorkActivityCalendar(...)` summary (daily cells,
 * active-day count, totals, current/longest streak). `toHomeActivityPulse()`
 * is already shaped to map that summary into `HomeActivityPulse`; the Home UI
 * and model must not change at integration time.
 *
 * Until EGA-662 exists, `loadActivityPulse()` uses the canonical base sources
 * the EGA-662 contract designates: the bounded owner-scoped session window
 * (`getWorkAnalyticsSessionsForWindow`), the canonical timezone-aware daily
 * aggregation (`aggregateDailyTrackedSeconds`), and the EGA-662 WorkActivityDay
 * semantics (isActive rule + stable intensity thresholds) documented in the
 * EGA-662 issue. No second analytics engine is introduced here.
 */

export type HomeActivityPulseDay = {
  date: string;
  intensity: 0 | 1 | 2 | 3 | 4;
};

export type HomeActivityPulse = {
  timezone: string;
  startDate: string;
  endDate: string;
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  trackedSeconds: number;
  completedTasks: number;
  sessionCount: number;
  days: HomeActivityPulseDay[];
};

export type HomeActivityPulseResult = {
  data: HomeActivityPulse | null;
  errorMessage: string | null;
};

/** Rolling year window in local days (EGA-662: ~365 days ending today). */
const ACTIVITY_WINDOW_DAYS = 365;

/**
 * EGA-662 stable intensity thresholds (from the EGA-662 issue):
 * - 0: no tracked time and no completed Tasks
 * - 1: Task-only activity or tracked time < 30 min
 * - 2: 30 min to < 2 h
 * - 3: 2 h to < 4 h
 * - 4: 4 h or more
 * Completed Tasks never boost an already time-based level.
 */
export function resolveActivityIntensityLevel(
  trackedSeconds: number,
  completedTaskCount: number,
): 0 | 1 | 2 | 3 | 4 {
  if (trackedSeconds <= 0) {
    return completedTaskCount > 0 ? 1 : 0;
  }
  if (trackedSeconds < 30 * 60) return 1;
  if (trackedSeconds < 2 * 60 * 60) return 2;
  if (trackedSeconds < 4 * 60 * 60) return 3;
  return 4;
}

function resolveStreaks(days: Array<{ isActive: boolean }>): {
  currentStreak: number;
  longestStreak: number;
} {
  let longestStreak = 0;
  let run = 0;
  for (const day of days) {
    if (day.isActive) {
      run += 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
  }

  // Current streak: count back from today when today is active, otherwise from
  // yesterday so an early-morning visit before any work does not read as a
  // broken streak (EGA-662 streak semantics).
  let currentStreak = 0;
  const startIndex = days.length > 0 && days[days.length - 1]?.isActive ? days.length - 1 : days.length - 2;
  for (let i = startIndex; i >= 0; i -= 1) {
    if (days[i]?.isActive) currentStreak += 1;
    else break;
  }

  return { currentStreak, longestStreak };
}

/**
 * Map the canonical Work Activity daily series into the compact Home DTO.
 * Kept separate from the data load so the EGA-662 rebind only touches the
 * loader.
 */
export function toHomeActivityPulse(input: {
  timezone: string;
  startDate: string;
  endDate: string;
  daily: Array<{ date: string; trackedSeconds: number; completedTaskCount: number }>;
  sessionCount: number;
}): HomeActivityPulse {
  const days: HomeActivityPulseDay[] = input.daily.map(({ date, trackedSeconds, completedTaskCount }) => ({
    date,
    intensity: resolveActivityIntensityLevel(trackedSeconds, completedTaskCount),
  }));

  const activeDays = input.daily.filter(
    ({ trackedSeconds, completedTaskCount }) => trackedSeconds > 0 || completedTaskCount > 0,
  ).length;
  const trackedSeconds = input.daily.reduce((sum, day) => sum + day.trackedSeconds, 0);
  const completedTasks = input.daily.reduce((sum, day) => sum + day.completedTaskCount, 0);
  const { currentStreak, longestStreak } = resolveStreaks(
    input.daily.map(({ trackedSeconds, completedTaskCount }) => ({
      isActive: trackedSeconds > 0 || completedTaskCount > 0,
    })),
  );

  return {
    timezone: input.timezone,
    startDate: input.startDate,
    endDate: input.endDate,
    currentStreak,
    longestStreak,
    activeDays,
    trackedSeconds,
    completedTasks,
    sessionCount: input.sessionCount,
    days,
  };
}

/**
 * Load the compact Home activity pulse from canonical sources.
 * Returns null on any data-access failure so the section can degrade quietly
 * without blanking the primary Now experience.
 */
async function loadActivityPulse(): Promise<HomeActivityPulse | null> {
  const user = await requireAuthenticatedUser();
  const supabase = await createClient();

  // Canonical account timezone via the same repository the Operator snapshot uses.
  const timeContextRepo = new SupabaseTimeContextRepository(
    supabase as unknown as import("@supabase/supabase-js").SupabaseClient,
  );
  const tzResult = await timeContextRepo.getTimezone(createAuthenticatedActor(user.id));
  const timezone = tzResult.ok && tzResult.value ? tzResult.value : "UTC";

  const now = new Date();
  const today = getLocalDateInTimezone(now, timezone);
  const startDate = shiftIsoDateByDays(today, -(ACTIVITY_WINDOW_DAYS - 1));
  const window = getDailyTrackedWindow(ACTIVITY_WINDOW_DAYS, today, timezone);

  const sessionsResult = await getWorkAnalyticsSessionsForWindow({
    ownerUserId: user.id,
    window: { startIso: window.startIso, endIso: window.endExclusiveIso },
  });
  if (sessionsResult.errorMessage || !sessionsResult.data) return null;

  const dailyTracked = aggregateDailyTrackedSeconds(
    sessionsResult.data.map((session) => ({
      started_at: session.started_at,
      ended_at: session.ended_at,
    })),
    window,
    now.toISOString(),
  );

  // Bounded completion evidence for the same window. EGA-662 replaces this with
  // durable completion events; until then this is the canonical Tasks read.
  const { data: completedRows, error: completedError } = await supabase
    .from("tasks")
    .select("completed_at")
    .eq("owner_user_id", user.id)
    .not("completed_at", "is", null)
    .gte("completed_at", window.startIso)
    .lt("completed_at", window.endExclusiveIso);
  if (completedError || !completedRows) return null;

  const completedByDay = new Map<string, number>();
  for (const row of completedRows) {
    if (!row.completed_at) continue;
    const localDate = getLocalDateInTimezone(new Date(row.completed_at), timezone);
    completedByDay.set(localDate, (completedByDay.get(localDate) ?? 0) + 1);
  }

  return toHomeActivityPulse({
    timezone,
    startDate,
    endDate: today,
    daily: dailyTracked.map(({ date, trackedSeconds }) => ({
      date,
      trackedSeconds,
      completedTaskCount: completedByDay.get(date) ?? 0,
    })),
    sessionCount: sessionsResult.data.length,
  });
}

/**
 * Public seam for the Home Activity section. Never throws: any failure maps to
 * `data: null` so the section can show a compact unavailable note while the
 * primary Now experience stays intact.
 */
export async function getHomeActivityPulseData(): Promise<HomeActivityPulseResult> {
  try {
    const data = await loadActivityPulse();
    return data
      ? { data, errorMessage: null }
      : { data: null, errorMessage: "Activity pulse unavailable right now." };
  } catch {
    return { data: null, errorMessage: "Activity pulse unavailable right now." };
  }
}
