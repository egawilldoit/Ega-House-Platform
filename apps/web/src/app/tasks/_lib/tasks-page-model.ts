import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  buildTaskKanbanBoard,
  buildTaskListUrl,
  isTaskDueFilter,
  isTaskSortValue,
  normalizeTaskLayout,
  type TaskDueFilter,
  type TaskLayoutMode,
  type TaskSortValue,
} from "@/lib/task-list";
import { isTaskStatus, type TaskStatus } from "@/lib/task-domain";
import { normalizeTaskViewFilter, type TaskViewFilter } from "@/lib/task-archive";
import { normalizeTaskSavedViewFilters } from "@/lib/task-saved-views";
import { getTasksWorkspaceData } from "@/lib/services/task-service";
import { getCalendarIntegrationSettings, getCalendarTaskFormDefaults } from "@/lib/services/calendar-settings-service";
import { sortFocusQueueTasks } from "@/lib/focus-queue";
import { isTaskDueSoon, isTaskOverdue } from "@/lib/task-due-date";

export type TasksSearchParams = {
  status?: string;
  project?: string;
  goal?: string;
  due?: string;
  sort?: string;
  priority?: string;
  estimateMin?: string;
  estimateMax?: string;
  dueWithin?: string;
  tasks?: string;
  archive?: string;
  layout?: string;
  view?: string;
  taskUpdateError?: string;
  taskUpdateSuccess?: string;
  taskUpdateTaskId?: string;
  statusUpdateError?: string;
  viewError?: string;
  viewSuccess?: string;
};

export type ParsedTasksFilters = {
  activeStatus: TaskStatus | null;
  activeDueFilter: TaskDueFilter;
  activeSort: TaskSortValue;
  activeLayout: TaskLayoutMode;
  activeView: TaskViewFilter;
  projectParam: string | null;
  goalParam: string | null;
  savedViewDefinitionFilters: ReturnType<typeof normalizeTaskSavedViewFilters>;
  taskUpdateError: string | null;
  taskUpdateSuccess: string | null;
  taskUpdateTaskId: string | null;
  savedViewFeedback: { error: string | null; success: string | null };
};

export function parseTasksSearchParams(searchParams: TasksSearchParams): ParsedTasksFilters {
  const statusParam = searchParams.status;
  const projectParam = searchParams.project?.trim() || null;
  const goalParam = searchParams.goal?.trim() || null;
  const dueParam = searchParams.due?.trim() || DEFAULT_TASK_DUE_FILTER;
  const sortParam = searchParams.sort?.trim() || DEFAULT_TASK_SORT;
  const activeStatus: TaskStatus | null = statusParam && isTaskStatus(statusParam) ? statusParam : null;
  const activeDueFilter: TaskDueFilter = isTaskDueFilter(dueParam) ? dueParam : DEFAULT_TASK_DUE_FILTER;
  const activeSort: TaskSortValue = isTaskSortValue(sortParam) ? sortParam : DEFAULT_TASK_SORT;
  const savedViewDefinitionFilters = normalizeTaskSavedViewFilters({
    activeTasks: searchParams.tasks === "active",
    priority: searchParams.priority,
    estimateMinMinutes: searchParams.estimateMin,
    estimateMaxMinutes: searchParams.estimateMax,
    dueWithinDays: searchParams.dueWithin,
  });
  const activeLayout: TaskLayoutMode = normalizeTaskLayout(searchParams.layout);
  const activeView: TaskViewFilter = normalizeTaskViewFilter(searchParams.archive ?? searchParams.view);
  const taskUpdateError =
    searchParams.taskUpdateError?.slice(0, 180) ?? searchParams.statusUpdateError?.slice(0, 180) ?? null;
  const taskUpdateSuccess = searchParams.taskUpdateSuccess?.slice(0, 180) ?? null;
  const taskUpdateTaskId = searchParams.taskUpdateTaskId ?? null;
  const savedViewFeedback = {
    error: searchParams.viewError?.slice(0, 180) ?? null,
    success: searchParams.viewSuccess?.slice(0, 180) ?? null,
  };
  return {
    activeStatus,
    activeDueFilter,
    activeSort,
    activeLayout,
    activeView,
    projectParam,
    goalParam,
    savedViewDefinitionFilters,
    taskUpdateError,
    taskUpdateSuccess,
    taskUpdateTaskId,
    savedViewFeedback,
  };
}

export async function getTasksPageModel(searchParams: TasksSearchParams) {
  const parsed = parseTasksSearchParams(searchParams);
  const [workspaceData, calendarSettingsResult] = await Promise.all([
    getTasksWorkspaceData({
      activeStatus: parsed.activeStatus,
      requestedProjectId: parsed.projectParam,
      requestedGoalId: parsed.goalParam,
      activeDueFilter: parsed.activeDueFilter,
      activeSort: parsed.activeSort,
      activeView: parsed.activeView,
      activeTasksOnly: parsed.savedViewDefinitionFilters.activeTasks,
      activePriorityValues: parsed.savedViewDefinitionFilters.priorityValues,
      activeEstimateMinMinutes: parsed.savedViewDefinitionFilters.estimateMinMinutes,
      activeEstimateMaxMinutes: parsed.savedViewDefinitionFilters.estimateMaxMinutes,
      activeDueWithinDays: parsed.savedViewDefinitionFilters.dueWithinDays,
    }),
    getCalendarIntegrationSettings(),
  ]);
  const calendarFormDefaults = getCalendarTaskFormDefaults(calendarSettingsResult.data);
  const { projects, goals, tasks, taskTotalDurations, summary, savedViews, savedViewsUnavailable, activeProjectId, activeGoalId } =
    workspaceData;
  const resolvedSavedViewFeedback = {
    error:
      parsed.savedViewFeedback.error ??
      (savedViewsUnavailable ? "Saved views are temporarily unavailable while database schema updates propagate." : null),
    success: parsed.savedViewFeedback.success,
  };
  const returnPath = buildTaskListUrl("/tasks", {
    status: parsed.activeStatus,
    priority: parsed.savedViewDefinitionFilters.priorityValues.join(","),
    estimateMin: parsed.savedViewDefinitionFilters.estimateMinMinutes,
    estimateMax: parsed.savedViewDefinitionFilters.estimateMaxMinutes,
    dueWithin: parsed.savedViewDefinitionFilters.dueWithinDays,
    activeTasks: parsed.savedViewDefinitionFilters.activeTasks,
    project: activeProjectId,
    goal: activeGoalId,
    due: parsed.activeDueFilter,
    sort: parsed.activeSort,
    view: parsed.activeView,
    layout: parsed.activeLayout,
  });

  const taskUrlFilters = {
    status: parsed.activeStatus,
    priority: parsed.savedViewDefinitionFilters.priorityValues.join(","),
    estimateMin: parsed.savedViewDefinitionFilters.estimateMinMinutes,
    estimateMax: parsed.savedViewDefinitionFilters.estimateMaxMinutes,
    dueWithin: parsed.savedViewDefinitionFilters.dueWithinDays,
    activeTasks: parsed.savedViewDefinitionFilters.activeTasks,
    project: activeProjectId,
    goal: activeGoalId,
    due: parsed.activeDueFilter,
    sort: parsed.activeSort,
  };
  const focusQueue = sortFocusQueueTasks(tasks);
  const kanbanBoard = buildTaskKanbanBoard(tasks, parsed.activeStatus);
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const blockedCount = tasks.filter((t) => t.status === "blocked").length;
  const overdueCount = tasks.filter((t) => isTaskOverdue(t.due_date, t.status)).length;
  const dueSoonCount = tasks.filter((t) => isTaskDueSoon(t.due_date, t.status)).length;

  return {
    parsed,
    projects,
    goals,
    tasks,
    taskTotalDurations,
    summary,
    savedViews,
    resolvedSavedViewFeedback,
    calendarFormDefaults,
    activeProjectId,
    activeGoalId,
    returnPath,
    taskUrlFilters,
    focusQueue,
    kanbanBoard,
    inProgressCount,
    blockedCount,
    overdueCount,
    dueSoonCount,
  };
}

export type TasksPageModel = Awaited<ReturnType<typeof getTasksPageModel>>;
