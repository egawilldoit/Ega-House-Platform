import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import {
  ACTIVITY_PULSE_SESSION_SELECT,
  getWorkAnalyticsSessionsForWindow,
  getWorkAnalyticsTaskCounts,
} from "@/lib/services/work-analytics-data-adapter";
import {
  calculateWorkAnalyticsDailySeries,
  calculateWorkAnalyticsInsights,
  type WorkAnalyticsDaily,
} from "@/lib/services/work-analytics-service";
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
 * - intensity per day: `resolveHomeActivityIntensityLevel` below — a local
 *   mirror of the canonical EGA-662 absolute-threshold scale
 * - completion totals: `getWorkAnalyticsTaskCounts` (canonical counts read)
 *
 * EGA-662 integration point: replace the body of `loadActivityPulse()` with a
 * call to the canonical `buildWorkActivityCalendar(...)` summary (daily cells,
 * active-day count, totals, current streak) and swap the local
 * `resolveHomeActivityIntensityLevel` mirror for an import of the canonical
 * `resolveWorkActivityIntensityLevel` from `work-activity-service`. The
 * constants and mapping below must stay semantically identical to EGA-662's
 * `WORK_ACTIVITY_INTENSITY_THRESHOLDS` until that import lands. The Home UI
 * and model must not change at integration time.
 */

export type HomeActivityPulseDay = {
  date: string;
  intensity: 0 | 1 | 2 | 3 | 4;
};

export type HomeActivityPulse = {
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
 * Absolute intensity thresholds (seconds) — the canonical EGA-662 Work
 * Activity scale (`WORK_ACTIVITY_INTENSITY_THRESHOLDS`), mirrored here until
 * EGA-662 lands at base. Unlike the Review heatmap's ratio-of-max scale,
 * these never change color when a new maximum day appears:
 *
 * - Level 0: no tracked time and no completed Tasks
 * - Level 1: Task-only activity, or tracked time below 30 minutes
 * - Level 2: 30 minutes up to (but not including) 2 hours
 * - Level 3: 2 hours up to (but not including) 4 hours
 * - Level 4: 4 hours or more
 *
 * Completed Tasks make a zero-timer day active at Level 1 but never boost an
 * already time-based level.
 */
export const HOME_ACTIVITY_INTENSITY_THRESHOLDS = {
  level1Seconds: 30 * 60,
  level2Seconds: 2 * 60 * 60,
  level3Seconds: 4 * 60 * 60,
} as const;

/**
 * Canonical EGA-662 intensity semantics, replicated at the Home seam.
 * EGA-662 integration: replace this mirror with an import of
 * `resolveWorkActivityIntensityLevel` from `work-activity-service`.
 */
function resolveHomeActivityIntensityLevel(day: {
  trackedSeconds: number;
  completedTaskCount: number;
}): 0 | 1 | 2 | 3 | 4 {
  if (day.trackedSeconds <= 0 && day.completedTaskCount <= 0) {
    return 0;
  }
  if (day.trackedSeconds < HOME_ACTIVITY_INTENSITY_THRESHOLDS.level1Seconds) {
    return 1;
  }
  if (day.trackedSeconds < HOME_ACTIVITY_INTENSITY_THRESHOLDS.level2Seconds) {
    return 2;
  }
  if (day.trackedSeconds < HOME_ACTIVITY_INTENSITY_THRESHOLDS.level3Seconds) {
    return 3;
  }
  return 4;
}

/**
 * Map the canonical Work Activity outputs into the compact Home DTO.
 * Kept separate from the data load so the EGA-662 rebind only touches the
 * loader. Only display sums are computed here; every semantic comes from the
 * canonical inputs.
 */
export function toHomeActivityPulse(input: {
  startDate: string;
  endDate: string;
  daily: WorkAnalyticsDaily[];
  currentStreak: number;
  activeDays: number;
  completedTasks: number;
}): HomeActivityPulse {
  const days: HomeActivityPulseDay[] = input.daily.map((day) => ({
    date: day.date,
    intensity: resolveHomeActivityIntensityLevel({
      trackedSeconds: day.workedMinutes * 60,
      completedTaskCount: day.completedTaskCount ?? 0,
    }),
  }));

  const trackedSeconds = input.daily.reduce((sum, day) => sum + day.workedMinutes * 60, 0);
  const sessionCount = input.daily.reduce((sum, day) => sum + day.sessionCount, 0);

  return {
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

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const startDate = shiftIsoDateByDays(today, -(ACTIVITY_WINDOW_DAYS - 1));
  const startIso = `${startDate}T00:00:00.000Z`;
  const endIso = now.toISOString();
  const window = { startIso, endIso };

  // One bounded owner-scoped session read for the whole pulse, compacted to
  // the timing columns the pulse grid and summary render — the canonical
  // daily-series/insights owners never read the nested task relations. The
  // canonical daily-series owner buckets it into days; Home never buckets
  // itself. Interim full-year window: at EGA-662 integration this read (and
  // the completion-count read below) rebinds to the compact
  // `buildWorkActivityCalendar` summary (see PR body).
  const sessionsResult = await getWorkAnalyticsSessionsForWindow({
    ownerUserId: user.id,
    window,
    select: ACTIVITY_PULSE_SESSION_SELECT,
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
