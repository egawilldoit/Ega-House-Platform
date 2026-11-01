import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { buildWorkActivityReadModel } from "@/lib/services/work-activity-read-model";
import type { WorkActivityCalendar } from "@/lib/services/work-activity-service";

/**
 * Home Activity Pulse — server-composed compact projection of the canonical
 * EGA-662 Work Activity read model.
 *
 * Home renders only a compact pulse (streak, active days, tracked time and a
 * small intensity strip). Every semantic — local-day bucketing, session and
 * completion evidence, intensity levels, streak and active-day counts — comes
 * from `buildWorkActivityReadModel` / `buildWorkActivityCalendar`. Home owns no
 * timezone, bucketing, intensity, streak or completion-history logic of its own;
 * the mapper below performs display sums only.
 *
 * The full yearly heatmap remains owned by `/work-analytics`.
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

/**
 * Map the canonical EGA-662 calendar into the compact Home DTO. This is a pure
 * display projection: `intensityLevel`, `isActive`, `currentStreak`,
 * `activeDayCount` and the totals are read from the canonical calendar. The
 * only value summed here is the session count across already-bucketed days.
 */
export function toHomeActivityPulse(calendar: WorkActivityCalendar): HomeActivityPulse {
  return {
    startDate: calendar.startDate,
    endDate: calendar.endDate,
    currentStreak: calendar.currentStreak,
    activeDays: calendar.activeDayCount,
    trackedSeconds: calendar.totalTrackedSeconds,
    completedTasks: calendar.totalCompletedTasks,
    sessionCount: calendar.days.reduce((sum, day) => sum + day.sessionCount, 0),
    days: calendar.days.map((day) => ({
      date: day.date,
      intensity: day.intensityLevel,
    })),
  };
}

/**
 * Load the compact Home activity pulse from the canonical EGA-662 read model.
 * Returns null on any failure so the section can degrade quietly without
 * blanking the primary Now experience.
 */
async function loadActivityPulse(): Promise<HomeActivityPulse | null> {
  const user = await requireAuthenticatedUser();
  const result = await buildWorkActivityReadModel({ ownerUserId: user.id });
  if (result.errorMessage || !result.data) return null;
  return toHomeActivityPulse(result.data.calendar);
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
