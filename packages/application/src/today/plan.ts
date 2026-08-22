import {
  isTaskCompletedStatus,
  isTaskPriority,
  isTaskStatus,
  type TaskPriority,
} from "@ega/domain";

import { formatDurationLabel } from "../shared/duration";
import type {
  TodayActiveTimer,
  TodaySourceTask,
} from "./ports";

export const TODAY_SUGGESTION_LIMIT = 6;
const OVERDUE_BUCKET = "overdue";
export type DueBucket = "none" | "overdue" | "today" | "soon" | "scheduled";

export type TodayPlanTask = Readonly<{
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: ReturnType<typeof normalizeStatus>;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  updatedAt: string;
  focusRank: number | null;
  plannedForDate: string | null;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
  hasActiveTimer: boolean;
  isDueToday: boolean;
  isPlannedForToday: boolean;
  dueBucket: DueBucket;
}>;

function normalizeStatus(status: string): "todo" | "in_progress" | "blocked" | "done" {
  return isTaskStatus(status) ? status : "done";
}

function normalizePriority(priority: string): TaskPriority {
  return isTaskPriority(priority) ? priority : "medium";
}

export function getDueBucket(
  dueDate: string | null,
  status: string,
  today: string,
): DueBucket {
  if (!dueDate) return "none";

  const complete = isTaskCompletedStatus(status);
  if (!complete && dueDate < today) return OVERDUE_BUCKET as DueBucket;
  if (!complete && dueDate === today) return "today";
  if (complete) return "scheduled";

  const soonEnd = shiftDate(today, 7);
  return dueDate >= today && dueDate <= soonEnd ? "soon" : "scheduled";
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function toPlanTask(
  row: TodaySourceTask,
  activeTaskId: string | null,
  today: string,
): TodayPlanTask {
  const status = normalizeStatus(row.status);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    blockedReason: row.blockedReason,
    status,
    priority: normalizePriority(row.priority),
    dueDate: row.dueDate,
    estimateMinutes: row.estimateMinutes,
    updatedAt: row.updatedAt,
    focusRank: row.focusRank,
    plannedForDate: row.plannedForDate,
    projectName: row.projectName ?? "Unknown project",
    projectSlug: row.projectSlug ?? null,
    goalTitle: row.goalTitle ?? null,
    hasActiveTimer: activeTaskId !== null && row.id === activeTaskId,
    isDueToday: row.dueDate === today,
    isPlannedForToday: row.plannedForDate === today,
    dueBucket: getDueBucket(row.dueDate, status, today),
  };
}

function compareByFocusThenDue(left: TodayPlanTask, right: TodayPlanTask): number {
  if (left.focusRank !== null && right.focusRank !== null && left.focusRank !== right.focusRank) {
    return left.focusRank - right.focusRank;
  }
  if ((left.focusRank !== null) !== (right.focusRank !== null)) {
    return left.focusRank !== null ? -1 : 1;
  }
  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate);
  }
  return right.updatedAt.localeCompare(left.updatedAt);
}

function compareSectionTasks(left: TodayPlanTask, right: TodayPlanTask): number {
  if (left.hasActiveTimer !== right.hasActiveTimer) {
    return left.hasActiveTimer ? -1 : 1;
  }
  return compareByFocusThenDue(left, right);
}

export type TodayPlan = Readonly<{
  date: string;
  sections: {
    planned: TodayPlanTask[];
    inProgress: TodayPlanTask[];
    blocked: TodayPlanTask[];
    completed: TodayPlanTask[];
  };
  suggestions: {
    pinned: TodayPlanTask[];
    inProgress: TodayPlanTask[];
  };
  summary: {
    plannedCount: number;
    inProgressCount: number;
    blockedCount: number;
    completedCount: number;
    selectedCount: number;
    clearableCompletedCount: number;
    overdueCount: number;
    dueTodayCount: number;
    totalEstimateMinutes: number;
    trackedTodaySeconds: number;
    trackedTodayLabel: string;
  };
  activeTimer: TodayActiveTimer | null;
}>;

export type BuildTodayPlanInput = Readonly<{
  today: string;
  selectedRows: TodaySourceTask[];
  pinnedRows: TodaySourceTask[];
  inProgressRows: TodaySourceTask[];
  activeTimer: TodayActiveTimer | null;
  trackedTodaySeconds: number;
}>;

function dedupeById(tasks: TodayPlanTask[]): Map<string, TodayPlanTask> {
  const byId = new Map<string, TodayPlanTask>();
  for (const task of tasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  return byId;
}

export function buildTodayPlan(input: BuildTodayPlanInput): TodayPlan {
  const activeTaskId = input.activeTimer?.taskId ?? null;
  const selected = [...dedupeById(input.selectedRows.map((row) => toPlanTask(row, activeTaskId, input.today))).values()];

  const planned = selected.filter((task) => task.status === "todo").sort(compareSectionTasks);
  const inProgress = selected.filter((task) => task.status === "in_progress").sort(compareSectionTasks);
  const blocked = selected.filter((task) => task.status === "blocked").sort(compareSectionTasks);
  const completed = selected
    .filter((task) => isTaskCompletedStatus(task.status))
    .sort(compareSectionTasks);

  const selectedIds = new Set(selected.map((task) => task.id));
  const buildSuggestions = (rows: TodaySourceTask[]) =>
    rows
      .map((row) => toPlanTask(row, activeTaskId, input.today))
      .filter((task) => !selectedIds.has(task.id) && !isTaskCompletedStatus(task.status))
      .sort(compareByFocusThenDue)
      .slice(0, TODAY_SUGGESTION_LIMIT);
  const overdueCount = selected.filter((task) => task.dueBucket === "overdue").length;
  const dueTodayCount = selected.filter((task) => task.dueBucket === "today").length;

  return {
    date: input.today,
    sections: {
      planned,
      inProgress,
      blocked,
      completed,
    },
    suggestions: {
      pinned: buildSuggestions(input.pinnedRows),
      inProgress: buildSuggestions(input.inProgressRows),
    },
    summary: {
      plannedCount: planned.length,
      inProgressCount: inProgress.length,
      blockedCount: blocked.length,
      completedCount: completed.length,
      selectedCount: selected.length,
      clearableCompletedCount: completed.filter((task) => task.isPlannedForToday).length,
      overdueCount,
      dueTodayCount,
      totalEstimateMinutes: selected.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0),
      trackedTodaySeconds: input.trackedTodaySeconds,
      trackedTodayLabel: formatDurationLabel(input.trackedTodaySeconds),
    },
    activeTimer: input.activeTimer,
  };
}
