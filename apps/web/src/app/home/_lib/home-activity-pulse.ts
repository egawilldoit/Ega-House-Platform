import { SupabaseTimeContextRepository } from "@ega/data-access";
import { createAuthenticatedActor } from "@ega/application/auth/actor";

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import {
  getWorkAnalyticsSessionsForWindow,
  getWorkAnalyticsTaskCounts,
} from "@/lib/services/work-analytics-data-adapter";
import {
  calculateWorkAnalyticsDailySeries,
  calculateWorkAnalyticsInsights,
  type WorkAnalyticsDaily,
} from "@/lib/services/work-analytics-service";
import { getSessionHeatmapIntensityLevel } from "@/components/review/session-heatmap";
import { shiftIsoDateByDays } from "@/lib/review-week";

/**
 * Home Activity Pulse — server-composed summary seam (EGA-662 binding point).
 *
 * Home renders a compact activity pulse (streak, active days, tracked time,
 * and a small intensity grid) sourced ONLY from the canonical Work Activity
 * owners. Home never recomputes streak, active-day, intensity, Timer
 * bucketing, or Task completion history:
 *
 * - daily bucketing + per-day session/completion counts:
 *   `calculateWorkAnalyticsDailySeries` (canonical execution-evidence owner)
 * - current streak + active-day count: `calculateWorkAnalyticsInsights`
 * - intensity per day: `getSessionHeatmapIntensityLevel` (canonical scale)
 * - completion totals: `getWorkAnalyticsTaskCounts` (canonical counts read)
 *
 * EGA-662 integration point: replace the body of `loadActivityPulse()` with a
 * call to the canonical `buildWorkActivityCalendar(...)` summary (daily cells,
 * active-day count, totals, current streak). `toHomeActivityPulse()` is
 * already shaped to map that summary into `HomeActivityPulse`; the Home UI
 * and model must not change at integration time.
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
 * Map the canonical Work Activity outputs into the compact Home DTO.
 * Kept separate from the data load so the EGA-662 rebind only touches the
 * loader. Only display sums are computed here; every semantic comes from the
 * canonical inputs.
 */
export function toHomeActivityPulse(input: {
  timezone: string;
  startDate: string;
  endDate: string;
  daily: WorkAnalyticsDaily[];
  currentStreak: number;
  activeDays: number;
  completedTasks: number;
}): HomeActivityPulse {
  const maxTrackedSeconds = input.daily.reduce(
    (max, day) => Math.max(max, day.workedMinutes * 60),
    0,
  );

  const days: HomeActivityPulseDay[] = input.daily.map((day) => ({
    date: day.date,
    intensity: getSessionHeatmapIntensityLevel(day.workedMinutes * 60, maxTrackedSeconds),
  }));

  const trackedSeconds = input.daily.reduce((sum, day) => sum + day.workedMinutes * 60, 0);
  const sessionCount = input.daily.reduce((sum, day) => sum + day.sessionCount, 0);

  return {
    timezone: input.timezone,
    startDate: input.startDate,
    endDate: input.endDate,
    currentStreak: input.currentStreak,
    activeDays: input.activeDays,
    trackedSeconds,
    completedTasks: input.completedTasks,
    sessionCount,
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
  const today = now.toISOString().slice(0, 10);
  const startDate = shiftIsoDateByDays(today, -(ACTIVITY_WINDOW_DAYS - 1));
  const startIso = `${startDate}T00:00:00.000Z`;
  const endIso = now.toISOString();
  const window = { startIso, endIso };

  // One bounded owner-scoped session read for the whole pulse. The canonical
  // daily-series owner buckets it into days; Home never buckets itself.
  const sessionsResult = await getWorkAnalyticsSessionsForWindow({
    ownerUserId: user.id,
    window,
  });
  if (sessionsResult.errorMessage || !sessionsResult.data) return null;

  const options = { nowIso: endIso, includeOpenSessions: true };
  const dailySeries = calculateWorkAnalyticsDailySeries(
    sessionsResult.data,
    startDate,
    today,
    options,
  );
  const insights = calculateWorkAnalyticsInsights(sessionsResult.data, window, options);

  // Canonical completion counts for the same window (the same bounded read
  // the Work Analytics page issues); Home never queries completion history.
  const taskCountsResult = await getWorkAnalyticsTaskCounts({ ownerUserId: user.id, window });
  if (taskCountsResult.errorMessage || !taskCountsResult.data) return null;

  return toHomeActivityPulse({
    timezone,
    startDate,
    endDate: today,
    daily: dailySeries,
    currentStreak: insights.currentStreak,
    activeDays: insights.daysWorkedCount,
    completedTasks: taskCountsResult.data.completedCount,
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
