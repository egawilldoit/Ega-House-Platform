import { getLocalDateInTimezone } from "@ega/domain";

import {
  getSessionDurationWithinWindowSeconds,
  getTaskSessionDurationSeconds,
  sessionOverlapsWindow,
  type SessionWindow,
  type TaskSessionDurationRow,
} from "@/lib/session-duration";
import { isTaskCompletedStatus } from "@/lib/task-domain";

export type ProjectComingUpTask = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  planned_for_date: string | null;
  scheduled_start_at: string | null;
  archived_at: string | null;
};

export type ProjectComingUpSource = "due" | "planned" | "scheduled";

export type ProjectComingUpItem<T extends ProjectComingUpTask> = {
  task: T;
  /** Account-local YYYY-MM-DD that drives the ordering. */
  date: string;
  source: ProjectComingUpSource;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateOnly(value: string | null | undefined): value is string {
  if (!value || !DATE_ONLY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type DateCandidate = {
  date: string;
  source: ProjectComingUpSource;
  order: number;
  sortKey: string;
};

function resolveCandidates<T extends ProjectComingUpTask>(
  task: T,
  timezone: string,
): DateCandidate[] {
  const candidates: DateCandidate[] = [];

  if (isDateOnly(task.due_date)) {
    candidates.push({
      date: task.due_date,
      source: "due",
      order: 2,
      sortKey: `${task.due_date}T00:00:00.000Z`,
    });
  }

  if (isDateOnly(task.planned_for_date)) {
    candidates.push({
      date: task.planned_for_date,
      source: "planned",
      order: 1,
      sortKey: `${task.planned_for_date}T00:00:00.000Z`,
    });
  }

  if (task.scheduled_start_at) {
    const scheduledMs = Date.parse(task.scheduled_start_at);
    if (Number.isFinite(scheduledMs)) {
      const date = getLocalDateInTimezone(new Date(scheduledMs), timezone);
      candidates.push({
        date,
        source: "scheduled",
        order: 0,
        sortKey: new Date(scheduledMs).toISOString(),
      });
    }
  }

  return candidates;
}

/**
 * Next due/planned/scheduled Tasks for a project.
 *
 * - Completed Tasks and archived Tasks are excluded.
 * - Only the earliest still-relevant (today or later) date on a Task counts, so
 *   an overdue due date does not hide a Task scheduled for today.
 * - Scheduled timestamps resolve to the owner's local calendar date via the
 *   canonical Time Context timezone.
 * - Ties prefer the more precise scheduled instant, then planned, then due.
 */
export function selectProjectComingUpTasks<T extends ProjectComingUpTask>(
  tasks: readonly T[],
  options: {
    today: string;
    timezone: string;
    limit?: number;
  },
): ProjectComingUpItem<T>[] {
  const limit = Math.max(0, options.limit ?? 6);
  if (limit === 0) return [];

  const items: Array<ProjectComingUpItem<T> & { order: number; sortKey: string }> = [];

  for (const task of tasks) {
    if (task.archived_at !== null || isTaskCompletedStatus(task.status)) continue;

    const candidates = resolveCandidates(task, options.timezone).filter(
      (candidate) => candidate.date >= options.today,
    );
    if (candidates.length === 0) continue;

    candidates.sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      if (left.order !== right.order) return left.order - right.order;
      return left.sortKey.localeCompare(right.sortKey);
    });

    const chosen = candidates[0];
    items.push({
      task,
      date: chosen.date,
      source: chosen.source,
      order: chosen.order,
      sortKey: chosen.sortKey,
    });
  }

  items.sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.order !== right.order) return left.order - right.order;
    if (left.sortKey !== right.sortKey) return left.sortKey.localeCompare(right.sortKey);
    return left.task.title.localeCompare(right.task.title);
  });

  return items.slice(0, limit).map((item) => ({
    task: item.task,
    date: item.date,
    source: item.source,
  }));
}

export type ProjectTimeSummary = {
  weekTrackedSeconds: number;
  weekSessionCount: number;
  totalTrackedSeconds: number;
  estimatedMinutes: number;
  estimatedTaskCount: number;
};

export type ProjectEstimateTask = {
  estimate_minutes: number | null;
};

/**
 * Project-level time summary from the same session rows returned for the
 * project read. Lifetime tracked time is retained for archived Tasks; the
 * estimate total covers every Task that carries an estimate.
 */
export function buildProjectTimeSummary(
  tasks: readonly ProjectEstimateTask[],
  sessions: readonly TaskSessionDurationRow[],
  weekWindow: SessionWindow,
  nowIso: string,
): ProjectTimeSummary {
  let estimatedMinutes = 0;
  let estimatedTaskCount = 0;

  for (const task of tasks) {
    if (typeof task.estimate_minutes === "number" && task.estimate_minutes > 0) {
      estimatedMinutes += task.estimate_minutes;
      estimatedTaskCount += 1;
    }
  }

  let weekTrackedSeconds = 0;
  let weekSessionCount = 0;
  let totalTrackedSeconds = 0;

  for (const session of sessions) {
    totalTrackedSeconds += getTaskSessionDurationSeconds(session, nowIso);
    weekTrackedSeconds += getSessionDurationWithinWindowSeconds(session, weekWindow, nowIso);
    if (sessionOverlapsWindow(session, weekWindow, nowIso)) {
      weekSessionCount += 1;
    }
  }

  return {
    weekTrackedSeconds,
    weekSessionCount,
    totalTrackedSeconds,
    estimatedMinutes,
    estimatedTaskCount,
  };
}

const STATUS_BAR_COLORS: Record<string, string> = {
  todo: "var(--status-pending)",
  in_progress: "var(--status-info)",
  review: "var(--status-review)",
  done: "var(--status-healthy)",
  blocked: "var(--status-overdue)",
};

export function getProjectStatusBarColor(status: string) {
  return STATUS_BAR_COLORS[status] ?? "var(--ega-text-tertiary)";
}
