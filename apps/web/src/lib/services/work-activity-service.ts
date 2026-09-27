import { getLocalDateInTimezone, getLocalDayWindow } from "@ega/domain";
import {
  aggregateSessionEvidenceByLocalDay,
  type SessionRangeRow,
} from "@/lib/session-day-aggregation";
import { shiftIsoDateByDays } from "@/lib/review-week";

/**
 * Work Activity calendar — canonical pure seam (EGA-662).
 *
 * One deterministic calculation for the GitHub-style yearly working-days
 * view. All local-day boundaries come from the EGA-661 canonical Time
 * Context (`@ega/domain` time-context); this module owns no timezone
 * policy of its own.
 *
 * Evidence model (no fake productivity score):
 * - trackedSeconds / sessionCount come from Timer/focus sessions.
 * - completedTaskCount comes from durable Task completion events
 *   (`task_status_events` with `to_status = 'done'`), never from the mutable
 *   current `tasks.completed_at`.
 * - A day is active when `trackedSeconds > 0 || completedTaskCount > 0`.
 * - Tracked time and completed Tasks are exposed as separate facts; they are
 *   never combined into a weighted score.
 */

/** Default rolling-year length in local calendar days, ending on today. */
export const WORK_ACTIVITY_YEAR_WINDOW_DAYS = 365;

/**
 * Stable absolute intensity thresholds (seconds). Unlike a relative-max
 * scale, these never change color when a new maximum day appears.
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
export const WORK_ACTIVITY_INTENSITY_THRESHOLDS = {
  level1Seconds: 30 * 60,
  level2Seconds: 2 * 60 * 60,
  level3Seconds: 4 * 60 * 60,
} as const;

export type WorkActivityIntensityLevel = 0 | 1 | 2 | 3 | 4;

export type WorkActivityDay = {
  date: string;
  trackedSeconds: number;
  sessionCount: number;
  completedTaskCount: number;
  isActive: boolean;
  intensityLevel: WorkActivityIntensityLevel;
};

export type WorkActivityBestDay = {
  date: string;
  trackedSeconds: number;
};

export type WorkActivityCalendar = {
  timezone: string;
  startDate: string;
  endDate: string;
  startUtcIso: string;
  endUtcIso: string;
  days: WorkActivityDay[];
  activeDayCount: number;
  totalTrackedSeconds: number;
  totalCompletedTasks: number;
  currentStreak: number;
  longestStreak: number;
  bestTrackedDay: WorkActivityBestDay | null;
};

export type WorkActivitySessionEvidence = SessionRangeRow;

export type WorkActivityCompletionEvent = {
  occurredAt: string;
};

/**
 * Resolves the rolling yearly window: `WORK_ACTIVITY_YEAR_WINDOW_DAYS` local
 * calendar days ending on the owner's current local date.
 */
export function resolveWorkActivityYearWindow(
  timezone: string,
  now: Date = new Date(),
): { startDate: string; endDate: string } {
  const endDate = getLocalDateInTimezone(now, timezone);
  const startDate = shiftIsoDateByDays(endDate, -(WORK_ACTIVITY_YEAR_WINDOW_DAYS - 1));
  return { startDate, endDate };
}

export function resolveWorkActivityIntensityLevel(day: {
  trackedSeconds: number;
  completedTaskCount: number;
}): WorkActivityIntensityLevel {
  if (day.trackedSeconds <= 0 && day.completedTaskCount <= 0) {
    return 0;
  }
  if (day.trackedSeconds < WORK_ACTIVITY_INTENSITY_THRESHOLDS.level1Seconds) {
    return 1;
  }
  if (day.trackedSeconds < WORK_ACTIVITY_INTENSITY_THRESHOLDS.level2Seconds) {
    return 2;
  }
  if (day.trackedSeconds < WORK_ACTIVITY_INTENSITY_THRESHOLDS.level3Seconds) {
    return 3;
  }
  return 4;
}

function bucketCompletionsByLocalDate(
  completionEvents: WorkActivityCompletionEvent[],
  timezone: string,
): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const event of completionEvents) {
    const occurredMs = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredMs)) continue;
    try {
      const localDate = getLocalDateInTimezone(new Date(occurredMs), timezone);
      buckets.set(localDate, (buckets.get(localDate) ?? 0) + 1);
    } catch {
      // Malformed instant for this timezone: skip rather than invent a bucket.
    }
  }
  return buckets;
}

function computeStreaks(days: WorkActivityDay[]): { currentStreak: number; longestStreak: number } {
  let longestStreak = 0;
  let run = 0;
  for (const day of days) {
    if (day.isActive) {
      run += 1;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
  }

  // Current streak: count backward from today when today is active, otherwise
  // from yesterday — opening EGA early on an inactive current day must not
  // make the streak disappear.
  let currentStreak = 0;
  let index = days.length - 1;
  if (index >= 0 && !days[index]?.isActive) {
    index -= 1;
  }
  while (index >= 0 && days[index]?.isActive) {
    currentStreak += 1;
    index -= 1;
  }

  return { currentStreak, longestStreak };
}

/**
 * Builds the deterministic Work Activity calendar for a local-day window.
 * Pure: identical inputs always produce an identical calendar.
 */
export function buildWorkActivityCalendar({
  sessions,
  completionEvents,
  timezone,
  startDate,
  endDate,
  nowIso,
}: {
  sessions: WorkActivitySessionEvidence[];
  completionEvents: WorkActivityCompletionEvent[];
  timezone: string;
  startDate: string;
  endDate: string;
  nowIso: string;
}): WorkActivityCalendar {
  const startWindow = getLocalDayWindow(timezone, startDate);
  const endWindow = getLocalDayWindow(timezone, endDate);
  const startUtcIso = startWindow.startUtcIso;
  const endUtcIso = endWindow.endUtcIso;

  const sessionEvidence = aggregateSessionEvidenceByLocalDay(
    sessions,
    { startDate, endDate, startIso: startUtcIso, endExclusiveIso: endUtcIso, timezone },
    nowIso,
  );

  const completionsByDate = bucketCompletionsByLocalDate(completionEvents, timezone);

  const days: WorkActivityDay[] = sessionEvidence.map(({ date, trackedSeconds, sessionCount }) => {
    const completedTaskCount = completionsByDate.get(date) ?? 0;
    const isActive = trackedSeconds > 0 || completedTaskCount > 0;
    return {
      date,
      trackedSeconds,
      sessionCount,
      completedTaskCount,
      isActive,
      intensityLevel: resolveWorkActivityIntensityLevel({ trackedSeconds, completedTaskCount }),
    };
  });

  const activeDayCount = days.filter((day) => day.isActive).length;
  const totalTrackedSeconds = days.reduce((sum, day) => sum + day.trackedSeconds, 0);
  const totalCompletedTasks = days.reduce((sum, day) => sum + day.completedTaskCount, 0);
  const { currentStreak, longestStreak } = computeStreaks(days);

  let bestTrackedDay: WorkActivityBestDay | null = null;
  for (const day of days) {
    if (day.trackedSeconds > 0 && (!bestTrackedDay || day.trackedSeconds > bestTrackedDay.trackedSeconds)) {
      bestTrackedDay = { date: day.date, trackedSeconds: day.trackedSeconds };
    }
  }

  return {
    timezone,
    startDate,
    endDate,
    startUtcIso,
    endUtcIso,
    days,
    activeDayCount,
    totalTrackedSeconds,
    totalCompletedTasks,
    currentStreak,
    longestStreak,
    bestTrackedDay,
  };
}
