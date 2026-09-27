import type { WorkActivityCalendar, WorkActivityDay } from "./work-activity-service";

/**
 * Pure grid geometry for the GitHub-style yearly Work Activity calendar.
 *
 * Owns no domain math — intensity, streaks, and totals come from
 * `buildWorkActivityCalendar`. This helper only places the ordered daily cells
 * into a 7-row (Sunday-first) × week-column grid with month labels, so the React
 * component stays purely presentational.
 */

export type WorkActivityGridCell = {
  date: string;
  weekday: number; // 0 = Sunday … 6 = Saturday
  weekIndex: number;
  isCurrentDay: boolean;
  day: WorkActivityDay;
};

export type WorkActivityMonthLabel = {
  weekIndex: number;
  label: string;
};

export type WorkActivityGrid = {
  cells: WorkActivityGridCell[];
  weekCount: number;
  monthLabels: WorkActivityMonthLabel[];
  startDate: string;
  endDate: string;
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function weekdayOfLocalDate(date: string): number {
  // A calendar date's weekday is timezone-independent.
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function monthOfLocalDate(date: string): number {
  return Number(date.slice(5, 7));
}

function yearOfLocalDate(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * Builds the 7-row × week-column grid geometry for the yearly calendar.
 * Sunday-first rows, week columns left→right, month labels above the columns
 * where the month changes. Future dates beyond the window are never invented.
 */
export function buildWorkActivityGrid(calendar: WorkActivityCalendar): WorkActivityGrid {
  const days = calendar.days;
  const startDate = calendar.startDate;
  const endDate = calendar.endDate;

  if (days.length === 0) {
    return { cells: [], weekCount: 0, monthLabels: [], startDate, endDate };
  }

  const firstWeekday = weekdayOfLocalDate(days[0]?.date ?? startDate);

  const cells: WorkActivityGridCell[] = days.map((day, index) => {
    const position = firstWeekday + index;
    return {
      date: day.date,
      weekday: position % 7,
      weekIndex: Math.floor(position / 7),
      isCurrentDay: day.date === endDate,
      day,
    };
  });

  const weekCount = cells.length > 0 ? (cells[cells.length - 1]?.weekIndex ?? 0) + 1 : 1;

  const monthLabels: WorkActivityMonthLabel[] = [];
  let previousMonthKey: string | null = null;
  for (const cell of cells) {
    const month = monthOfLocalDate(cell.date);
    const year = yearOfLocalDate(cell.date);
    const monthKey = `${year}-${month}`;
    if (monthKey !== previousMonthKey) {
      monthLabels.push({ weekIndex: cell.weekIndex, label: MONTH_NAMES[month - 1] ?? "" });
      previousMonthKey = monthKey;
    }
  }

  return { cells, weekCount, monthLabels, startDate, endDate };
}
