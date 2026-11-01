import type { HomeActivityPulseDay } from "./home-activity-pulse";

export type HomeActivityWeek = Array<HomeActivityPulseDay | null>;

const DAYS_PER_WEEK = 7;

function weekdayOf(date: string): number {
  // A calendar date's weekday is timezone-independent when read at UTC noon.
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

/**
 * Group canonical EGA-662 activity days into Sunday-first week columns.
 *
 * The canonical daily cells arrive in ascending date order. A new column starts
 * on each Sunday and every day is placed in its own weekday row, so a
 * Mon/Wed/Fri row label lines up with the dates it shows regardless of which
 * weekday the window ends on. The first and last columns may be partial, as in
 * GitHub's calendar.
 *
 * Pure geometry only: intensity and activity state come from the canonical
 * calendar cells.
 */
export function buildCompactActivityWeeks(
  days: HomeActivityPulseDay[],
  weeks: number,
): HomeActivityWeek[] {
  if (days.length === 0) return [];

  const recent = days.slice(-weeks * DAYS_PER_WEEK);
  const columns: HomeActivityWeek[] = [];
  let column: HomeActivityWeek | null = null;

  for (const day of recent) {
    const weekday = weekdayOf(day.date);
    if (!column || weekday === 0) {
      column = new Array<HomeActivityPulseDay | null>(DAYS_PER_WEEK).fill(null);
      columns.push(column);
    }
    column[weekday] = day;
  }

  return columns;
}
