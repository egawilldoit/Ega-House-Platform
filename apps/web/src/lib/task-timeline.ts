import { getTaskBarWindow } from "@ega/domain";

import { isDateOnlyValue, shiftDateOnlyValue } from "@/lib/task-due-date";

export const TIMELINE_ZOOM_VALUES = ["week", "month"] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOM_VALUES)[number];
export const DEFAULT_TIMELINE_ZOOM: TimelineZoom = "week";
export const TIMELINE_RANGE_DAYS = 56;
/** Hard ceiling for a requested window; keeps every timeline query bounded. */
export const TIMELINE_MAX_RANGE_DAYS = 120;
/** How far a requested window may start from the owner's canonical today. */
export const TIMELINE_MAX_ANCHOR_OFFSET_DAYS = 730;

const DAY_WIDTH: Record<TimelineZoom, number> = {
  week: 30,
  month: 14,
};

export function normalizeTimelineZoom(value: string | null | undefined): TimelineZoom {
  return value === "month" ? "month" : DEFAULT_TIMELINE_ZOOM;
}

export function getTimelineDayWidth(zoom: TimelineZoom) {
  return DAY_WIDTH[zoom];
}

export type TimelineRange = Readonly<{
  /** Inclusive first day. */
  start: string;
  /** Inclusive last day. */
  end: string;
  days: string[];
}>;

/**
 * Resolve a fixed, bounded window from the owner's local date and an optional
 * requested start. An invalid or unreasonably distant anchor falls back to the
 * canonical "two weeks back, six weeks forward" default rather than scanning
 * the whole task table.
 */
export function resolveTimelineRange(
  today: string,
  requestedStart?: string | null,
  rangeDays = TIMELINE_RANGE_DAYS,
): TimelineRange {
  const safeToday = isDateOnlyValue(today) ? today : shiftDateOnlyValue("1970-01-01", 0);
  const boundedDays = Math.min(Math.max(1, Math.trunc(rangeDays)), TIMELINE_MAX_RANGE_DAYS);
  const defaultStart = shiftDateOnlyValue(safeToday, -14);
  const trimmedStart = String(requestedStart ?? "").trim();
  const candidate =
    isDateOnlyValue(trimmedStart) &&
    Math.abs(dayDistance(safeToday, trimmedStart)) <= TIMELINE_MAX_ANCHOR_OFFSET_DAYS
      ? trimmedStart
      : defaultStart;

  const days: string[] = [];
  for (let index = 0; index < boundedDays; index += 1) {
    days.push(shiftDateOnlyValue(candidate, index));
  }

  return { start: candidate, end: days[days.length - 1] ?? candidate, days };
}

export function dayDistance(from: string, to: string) {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) return Number.POSITIVE_INFINITY;
  return Math.round((toTime - fromTime) / 86_400_000);
}

export type TimelineTaskInput = Readonly<{
  id: string;
  title: string;
  status: string;
  priority?: string;
  start_date?: string | null;
  due_date?: string | null;
  projectName?: string | null;
  /** Optimistic-concurrency version carried by move/resize commits. */
  updatedAt?: string;
}>;

export type TimelineDependencyInput = Readonly<{
  taskId: string;
  blockedByTaskId: string;
}>;

export type TimelineBar = Readonly<{
  startDate: string;
  dueDate: string;
  /** Inclusive offset from the range start, clamped to the visible window. */
  startOffset: number;
  /** Inclusive offset from the range start, clamped to the visible window. */
  endOffset: number;
  spanDays: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}>;

export type TimelineRow = Readonly<{
  task: TimelineTaskInput;
  bar: TimelineBar | null;
}>;

export type TimelineArrow = Readonly<{
  fromTaskId: string;
  toTaskId: string;
  fromRow: number;
  toRow: number;
  fromOffset: number;
  toOffset: number;
}>;

export type TimelineModel = Readonly<{
  rows: TimelineRow[];
  scheduledRows: TimelineRow[];
  unscheduledRows: TimelineRow[];
  arrows: TimelineArrow[];
  hiddenDependencyCountByTask: Record<string, number>;
  /** Text/list equivalent of the dependency arrows. */
  dependencyLines: string[];
}>;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Project tasks and owner-scoped dependency edges into renderable rows.
 *
 * A row only gets a bar when both dates are real and ordered. Tasks with a
 * missing date stay in the unscheduled list with their known date text; no bar
 * is fabricated. Dependencies whose predecessor is not part of the visible
 * scheduled set become a hidden count, never a guessed arrow or a fetch.
 */
export function buildTimelineModel(
  tasks: ReadonlyArray<TimelineTaskInput>,
  dependencies: ReadonlyArray<TimelineDependencyInput>,
  range: TimelineRange,
): TimelineModel {
  const scheduleRows: TimelineRow[] = [];
  const unscheduledRows: TimelineRow[] = [];

  for (const task of tasks) {
    const window = getTaskBarWindow(task.start_date, task.due_date);
    if (!window) {
      unscheduledRows.push({ task, bar: null });
      continue;
    }

    const rawStart = dayDistance(range.start, window.startDate);
    const rawEnd = dayDistance(range.start, window.dueDate);
    const startOffset = clamp(rawStart, 0, Math.max(0, range.days.length - 1));
    const endOffset = clamp(rawEnd, 0, Math.max(0, range.days.length - 1));

    if (endOffset < 0 || startOffset > range.days.length - 1) {
      // The query only returns intersecting rows; keep this guard so a caller
      // with a stale range cannot produce a zero-width, misleading bar.
      unscheduledRows.push({ task, bar: null });
      continue;
    }

    scheduleRows.push({
      task,
      bar: {
        startDate: window.startDate,
        dueDate: window.dueDate,
        startOffset,
        endOffset,
        spanDays: Math.max(1, endOffset - startOffset + 1),
        clippedStart: rawStart < 0,
        clippedEnd: rawEnd > range.days.length - 1,
      },
    });
  }

  scheduleRows.sort((left, right) => {
    const leftStart = left.bar?.startDate ?? "";
    const rightStart = right.bar?.startDate ?? "";
    if (leftStart !== rightStart) return leftStart < rightStart ? -1 : 1;
    return left.task.title.localeCompare(right.task.title);
  });
  unscheduledRows.sort((left, right) => left.task.title.localeCompare(right.task.title));

  const rowIndexByTaskId = new Map(
    scheduleRows.map((row, index) => [row.task.id, index] as const),
  );
  const titleByTaskId = new Map(tasks.map((task) => [task.id, task.title] as const));
  const hiddenDependencyCountByTask: Record<string, number> = {};
  const arrows: TimelineArrow[] = [];
  const dependencyLines: string[] = [];

  for (const dependency of dependencies) {
    const dependentRowIndex = rowIndexByTaskId.get(dependency.taskId);
    const predecessorRowIndex = rowIndexByTaskId.get(dependency.blockedByTaskId);
    const dependent = titleByTaskId.get(dependency.taskId);
    const predecessor = titleByTaskId.get(dependency.blockedByTaskId);

    if (dependentRowIndex === undefined) {
      // The dependent is unscheduled: the dependency is still real, but it has
      // no bar to attach an arrow to.
      const label = predecessor ?? "a task outside this view";
      dependencyLines.push(`${dependent ?? "An unscheduled task"} is blocked by ${label}.`);
      if (predecessor === undefined) {
        hiddenDependencyCountByTask[dependency.taskId] =
          (hiddenDependencyCountByTask[dependency.taskId] ?? 0) + 1;
      }
      continue;
    }

    if (predecessorRowIndex === undefined || !predecessor) {
      hiddenDependencyCountByTask[dependency.taskId] =
        (hiddenDependencyCountByTask[dependency.taskId] ?? 0) + 1;
      dependencyLines.push(
        `${dependent ?? "Task"} is blocked by a task outside this view.`,
      );
      continue;
    }

    const dependentBar = scheduleRows[dependentRowIndex]?.bar;
    const predecessorBar = scheduleRows[predecessorRowIndex]?.bar;
    if (!dependentBar || !predecessorBar) continue;

    arrows.push({
      fromTaskId: dependency.blockedByTaskId,
      toTaskId: dependency.taskId,
      fromRow: predecessorRowIndex,
      toRow: dependentRowIndex,
      fromOffset: predecessorBar.endOffset,
      toOffset: dependentBar.startOffset,
    });
    dependencyLines.push(`${dependent} is blocked by ${predecessor}.`);
  }

  return {
    rows: scheduleRows,
    scheduledRows: scheduleRows,
    unscheduledRows,
    arrows,
    hiddenDependencyCountByTask,
    dependencyLines,
  };
}
