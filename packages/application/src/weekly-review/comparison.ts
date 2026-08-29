import { getWeekWindow } from "@ega/domain";

import type { WeeklyReviewWeekWindow } from "./read-model";
import type { ExecutionEvidenceWindow } from "../shared/execution-evidence";

export type WeeklyReviewMetricComparison = Readonly<{
  current: number;
  previous: number | null;
  delta: number | null;
  percentChange: number | null;
}>;

export type WeeklyReviewComparisonMetrics = Readonly<{
  trackedSeconds: WeeklyReviewMetricComparison;
  sessionCount: WeeklyReviewMetricComparison;
  tasksCreated: WeeklyReviewMetricComparison;
  goalsTouched: WeeklyReviewMetricComparison;
  completedTasks: WeeklyReviewMetricComparison;
}>;

export type WeeklyReviewComparison = Readonly<{
  currentWindow: WeeklyReviewWeekWindow;
  previousWindow: WeeklyReviewWeekWindow;
  metrics: WeeklyReviewComparisonMetrics;
}>;

export function createMetricComparison(
  current: number,
  previous: number | null,
): WeeklyReviewMetricComparison {
  if (previous === null || previous === undefined) {
    return { current, previous: null, delta: null, percentChange: null };
  }
  const delta = current - previous;
  const percentChange = previous === 0 ? null : (delta / previous) * 100;
  return { current, previous, delta, percentChange };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}

function addDaysToIsoDate(dateStr: string, days: number): string {
  const [yStr, mStr, dStr] = dateStr.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  const baseMs = Date.UTC(year, month - 1, day);
  const nextMs = baseMs + days * 86_400_000;
  const next = new Date(nextMs);
  return `${pad4(next.getUTCFullYear())}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function getPreviousWeekWindow(
  currentWindow: WeeklyReviewWeekWindow,
): WeeklyReviewWeekWindow {
  const prevDate = addDaysToIsoDate(currentWindow.weekStart, -7);
  const raw = getWeekWindow(currentWindow.timezone, prevDate);
  return {
    weekOf: prevDate,
    weekStart: raw.weekStart,
    weekEnd: raw.weekEnd,
    weekStartUtc: raw.weekStartUtcIso,
    weekEndExclusiveUtc: raw.weekEndExclusiveUtcIso,
    timezone: currentWindow.timezone,
    requestedTimezone: currentWindow.requestedTimezone,
    fallback: currentWindow.fallback,
  };
}

export function getPreviousExecutionWindow(
  previousWindow: WeeklyReviewWeekWindow,
): ExecutionEvidenceWindow {
  return {
    startIso: previousWindow.weekStartUtc,
    endIso: previousWindow.weekEndExclusiveUtc,
  };
}

export function buildWeeklyReviewComparison(input: {
  currentWindow: WeeklyReviewWeekWindow;
  previousWindow: WeeklyReviewWeekWindow;
  current: {
    trackedSeconds: number;
    sessionCount: number;
    tasksCreated: number;
    goalsTouched: number;
    completedTasks: number;
  };
  previous: {
    trackedSeconds: number;
    sessionCount: number;
    tasksCreated: number;
    goalsTouched: number;
    completedTasks: number;
  } | null;
}): WeeklyReviewComparison {
  const previous = input.previous;
  return {
    currentWindow: input.currentWindow,
    previousWindow: input.previousWindow,
    metrics: {
      trackedSeconds: createMetricComparison(input.current.trackedSeconds, previous ? previous.trackedSeconds : null),
      sessionCount: createMetricComparison(input.current.sessionCount, previous ? previous.sessionCount : null),
      tasksCreated: createMetricComparison(input.current.tasksCreated, previous ? previous.tasksCreated : null),
      goalsTouched: createMetricComparison(input.current.goalsTouched, previous ? previous.goalsTouched : null),
      completedTasks: createMetricComparison(input.current.completedTasks, previous ? previous.completedTasks : null),
    },
  };
}
