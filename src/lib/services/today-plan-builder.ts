import { getTaskDueDateState } from "@/lib/task-due-date";
import { isTaskCompletedStatus, isTaskStatus, type TaskStatus } from "@/lib/task-domain";
import type { ActiveTimerSession, TimerSummary } from "@/lib/services/timer-service";
import type { NormalizedTaskRow } from "@/lib/services/task-read-service";

const SUGGESTION_LIMIT = 6;
const FOCUS_QUEUE_LIMIT = 7;
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type TodayPlannerTask = {
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: TaskStatus;
  priority: string;
  dueDate: string | null;
  estimateMinutes: number | null;
  focusRank: number | null;
  plannedForDate: string | null;
  updatedAt: string;
  completedAt: string | null;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
  hasActiveTimer: boolean;
  isDueToday: boolean;
  isPlannedForToday: boolean;
  dueBucket: "none" | "overdue" | "today" | "soon" | "scheduled";
};

export type TodayPlannerData = {
  date: string;
  startHere: TodayPlannerTask | null;
  focusQueue: TodayPlannerTask[];
  plannedToday: TodayPlannerTask[];
  planned: TodayPlannerTask[];
  inProgress: TodayPlannerTask[];
  blocked: TodayPlannerTask[];
  completed: TodayPlannerTask[];
  suggestions: {
    pinned: TodayPlannerTask[];
    inProgress: TodayPlannerTask[];
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
  activeTimer: ActiveTimerSession | null;
};

export type BuildTodayPlanInput = {
  today: string;
  selectedRows: NormalizedTaskRow[];
  pinnedSuggestionRows: NormalizedTaskRow[];
  inProgressSuggestionRows: NormalizedTaskRow[];
  activeTimer: ActiveTimerSession | null;
  timerSummary: TimerSummary | null;
};

function mapTaskRow(
  row: NormalizedTaskRow,
  activeTaskId: string | null,
  today: string,
): TodayPlannerTask | null {
  if (!isTaskStatus(row.status) && !isTaskCompletedStatus(row.status)) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    blockedReason: row.blocked_reason ?? null,
    status: isTaskStatus(row.status) ? row.status : "done",
    priority: row.priority,
    dueDate: row.due_date,
    estimateMinutes: row.estimate_minutes,
    focusRank: row.focus_rank,
    plannedForDate: row.planned_for_date,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    projectName: row.projects?.name ?? "Unknown project",
    projectSlug: row.projects?.slug ?? null,
    goalTitle: row.goals?.title ?? null,
    hasActiveTimer: row.id === activeTaskId,
    isDueToday: row.due_date === today,
    isPlannedForToday: row.planned_for_date === today,
    dueBucket: getTaskDueDateState(row.due_date, row.status, today),
  };
}

function sortTodayTasks(left: TodayPlannerTask, right: TodayPlannerTask) {
  if (left.hasActiveTimer !== right.hasActiveTimer) {
    return left.hasActiveTimer ? -1 : 1;
  }

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

function sortSuggestionTasks(left: TodayPlannerTask, right: TodayPlannerTask) {
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

function sortRecommendedTasks(left: TodayPlannerTask, right: TodayPlannerTask) {
  if (left.hasActiveTimer !== right.hasActiveTimer) {
    return left.hasActiveTimer ? -1 : 1;
  }

  if (left.isPlannedForToday !== right.isPlannedForToday) {
    return left.isPlannedForToday ? -1 : 1;
  }

  const leftPriority = PRIORITY_RANK[left.priority] ?? PRIORITY_RANK.medium;
  const rightPriority = PRIORITY_RANK[right.priority] ?? PRIORITY_RANK.medium;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  if (left.focusRank !== null && right.focusRank !== null && left.focusRank !== right.focusRank) {
    return left.focusRank - right.focusRank;
  }

  if ((left.focusRank !== null) !== (right.focusRank !== null)) {
    return left.focusRank !== null ? -1 : 1;
  }

  if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
    return left.dueDate.localeCompare(right.dueDate);
  }

  if ((left.dueDate !== null) !== (right.dueDate !== null)) {
    return left.dueDate !== null ? -1 : 1;
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function getUniqueTasksByRank(tasks: TodayPlannerTask[]) {
  const tasksById = new Map<string, TodayPlannerTask>();

  for (const task of tasks.sort(sortRecommendedTasks)) {
    if (!tasksById.has(task.id)) {
      tasksById.set(task.id, task);
    }
  }

  return [...tasksById.values()];
}

export function buildTodayPlan(input: BuildTodayPlanInput): TodayPlannerData {
  const activeTaskId = input.activeTimer?.taskId ?? null;
  const selectedTasksById = new Map<string, TodayPlannerTask>();
  for (const row of input.selectedRows) {
    const task = mapTaskRow(row, activeTaskId, input.today);
    if (task && !selectedTasksById.has(task.id)) {
      selectedTasksById.set(task.id, task);
    }
  }
  const selectedTasks = [...selectedTasksById.values()];
  const planned = selectedTasks.filter((task) => task.status === "todo").sort(sortTodayTasks);
  const inProgress = selectedTasks
    .filter((task) => task.status === "in_progress")
    .sort(sortTodayTasks);
  const blocked = selectedTasks.filter((task) => task.status === "blocked").sort(sortTodayTasks);
  const completed = selectedTasks.filter((task) => isTaskCompletedStatus(task.status)).sort(sortTodayTasks);
  const selectedTaskIds = new Set(selectedTasks.map((task) => task.id));
  const toSuggestionSlice = (rows: NormalizedTaskRow[]) =>
    rows
      .map((row) => mapTaskRow(row, activeTaskId, input.today))
      .filter((task): task is TodayPlannerTask => task !== null)
      .filter((task) => !selectedTaskIds.has(task.id) && !isTaskCompletedStatus(task.status))
      .sort(sortSuggestionTasks)
      .slice(0, SUGGESTION_LIMIT);
  const suggestions = {
    pinned: toSuggestionSlice(input.pinnedSuggestionRows),
    inProgress: toSuggestionSlice(input.inProgressSuggestionRows),
  };
  const focusQueue = getUniqueTasksByRank([
    ...selectedTasks,
    ...suggestions.pinned,
    ...suggestions.inProgress,
  ])
    .filter((task) => !isTaskCompletedStatus(task.status) && task.status !== "blocked")
    .slice(0, FOCUS_QUEUE_LIMIT);
  const startHere = focusQueue[0] ?? null;
  const plannedToday = selectedTasks
    .filter((task) => task.isPlannedForToday)
    .sort(sortRecommendedTasks);
  const clearableCompletedCount = completed.filter((task) => task.isPlannedForToday).length;
  const overdueCount = selectedTasks.filter((task) => task.dueBucket === "overdue").length;
  const dueTodayCount = selectedTasks.filter((task) => task.dueBucket === "today").length;
  const totalEstimateMinutes = selectedTasks.reduce(
    (sum, task) => sum + (task.estimateMinutes ?? 0),
    0,
  );

  return {
    date: input.today,
    startHere,
    focusQueue,
    plannedToday,
    planned,
    inProgress,
    blocked,
    completed,
    suggestions,
    summary: {
      plannedCount: planned.length,
      inProgressCount: inProgress.length,
      blockedCount: blocked.length,
      completedCount: completed.length,
      selectedCount: selectedTasks.length,
      clearableCompletedCount,
      overdueCount,
      dueTodayCount,
      totalEstimateMinutes,
      trackedTodaySeconds: input.timerSummary?.trackedTodaySeconds ?? 0,
      trackedTodayLabel: input.timerSummary?.trackedTodayLabel ?? "0m",
    },
    activeTimer: input.activeTimer,
  };
}
