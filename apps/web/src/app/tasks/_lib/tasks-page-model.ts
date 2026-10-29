import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_LAYOUT,
  DEFAULT_TASK_SORT,
  buildTaskKanbanBoard,
  buildTaskListUrl,
  isTaskDueFilter,
  isTaskLayout,
  isTaskSortValue,
  normalizeTaskBoardOrder,
  normalizeTaskDensity,
  parseTaskListView,
  sortTasksForBoard,
  type TaskBoardOrder,
  type TaskDensity,
  type TaskDueFilter,
  type TaskLayoutMode,
  type TaskSortValue,
  type TaskViewDefinition,
} from "@/lib/task-list";
import { isTaskStatus, type TaskStatus } from "@/lib/task-domain";
import { normalizeTaskViewFilter, type TaskViewFilter as TaskArchiveViewFilter } from "@/lib/task-archive";
import {
  getTaskSavedViewFiltersFromDefinition,
  normalizeTaskSavedViewFilters,
} from "@/lib/task-saved-views";
import { groupTaskViewRecords } from "@ega/application/tasks/view";
import { getTaskDrawerDetail } from "@/lib/services/task-service";
import { getSubtaskCountsForTasks, listTaskSubtasks } from "@/lib/services/subtask-service";
import { getTaskActivity } from "@/lib/services/task-activity-service";
import { getTaskCommentThread } from "@/lib/services/task-comment-service";
import { isFavorite } from "@/lib/services/favorite-service";
import { getTasksWorkspaceData } from "@/lib/services/task-service";
import { getTaskTimelineData } from "@/lib/services/task-timeline-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import {
  getTodayLocalIsoDate,
  isTaskDueSoon,
  isTaskOverdue,
} from "@/lib/task-due-date";
import { normalizeTimelineZoom, resolveTimelineRange } from "@/lib/task-timeline";

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
  density?: string;
  boardOrder?: string;
  view?: string;
  /** Table column layout (EGA-792). */
  cols?: string;
  widths?: string;
  /** Canonical toolbar parameters (EGA-791). */
  q?: string;
  group?: string;
  dir?: string;
  filter?: string | string[];
  taskUpdateError?: string;
  taskUpdateSuccess?: string;
  taskUpdateTaskId?: string;
  statusUpdateError?: string;
  viewError?: string;
  viewSuccess?: string;
  /** Selected task for the detail drawer (?task=<id>). */
  task?: string;
  /** `?taskMode=full` renders the detail full page instead of a side panel. */
  taskMode?: string;
  /** Timeline window anchor (YYYY-MM-DD) and week/month zoom. */
  tlStart?: string;
  tlZoom?: string;
};

export type ParsedTasksFilters = {
  activeStatus: TaskStatus | null;
  activeDueFilter: TaskDueFilter;
  activeSort: TaskSortValue;
  activeLayout: TaskLayoutMode;
  activeDensity: TaskDensity;
  activeBoardOrder: TaskBoardOrder | null;
  activeView: TaskArchiveViewFilter;
  projectParam: string | null;
  goalParam: string | null;
  savedViewDefinitionFilters: ReturnType<typeof normalizeTaskSavedViewFilters>;
  /** Canonical filter/group/sort/search definition shared with saved views. */
  view: TaskViewDefinition;
  taskUpdateError: string | null;
  taskUpdateSuccess: string | null;
  taskUpdateTaskId: string | null;
  savedViewFeedback: { error: string | null; success: string | null };
};

export type TaskPageDefaults = {
  /** Owner's durable layout for a Tasks view with no explicit `layout` param. */
  defaultLayout?: TaskLayoutMode;
};

export function parseTasksSearchParams(
  searchParams: TasksSearchParams,
  defaults: TaskPageDefaults = {},
): ParsedTasksFilters {
  const defaultLayout = defaults.defaultLayout ?? DEFAULT_TASK_LAYOUT;
  const projectParam = searchParams.project?.trim() || null;
  const goalParam = searchParams.goal?.trim() || null;
  const view = parseTaskListView(searchParams);
  const projected = getTaskSavedViewFiltersFromDefinition(view);
  const savedViewDefinitionFilters = normalizeTaskSavedViewFilters({
    activeTasks: view.activeOnly,
    priority: projected.priorityValues,
    estimateMinMinutes: projected.estimateMinMinutes,
    estimateMaxMinutes: projected.estimateMaxMinutes,
    dueWithinDays: projected.dueWithinDays,
    status: projected.status,
    projectId: projected.projectId,
    goalId: projected.goalId,
    dueFilter: projected.dueFilter,
    sortValue: projected.sortValue,
  });
  const statusFilter = view.filters.find(
    (filter) =>
      filter.field === "status" &&
      (filter.operator === "is" || filter.operator === "is_any_of") &&
      filter.values.length === 1,
  );
  const activeStatus: TaskStatus | null =
    statusFilter && isTaskStatus(statusFilter.values[0]) ? (statusFilter.values[0] as TaskStatus) : null;
  const activeDueFilter: TaskDueFilter =
    isTaskDueFilter(projected.dueFilter ?? "") ? (projected.dueFilter as TaskDueFilter) : DEFAULT_TASK_DUE_FILTER;
  const activeSort: TaskSortValue =
    isTaskSortValue(projected.sortValue ?? "") ? (projected.sortValue as TaskSortValue) : DEFAULT_TASK_SORT;
  const activeLayout: TaskLayoutMode = isTaskLayout(searchParams.layout)
    ? searchParams.layout
    : defaultLayout;
  const activeDensity: TaskDensity = normalizeTaskDensity(searchParams.density);
  const activeBoardOrder = normalizeTaskBoardOrder(searchParams.boardOrder);
  const activeView: TaskArchiveViewFilter = normalizeTaskViewFilter(searchParams.archive ?? searchParams.view);
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
    activeDensity,
    activeView,
    activeBoardOrder,
    projectParam,
    goalParam,
    savedViewDefinitionFilters,
    view,
    taskUpdateError,
    taskUpdateSuccess,
    taskUpdateTaskId,
    savedViewFeedback,
  };
}

export async function getTasksPageModel(
  searchParams: TasksSearchParams,
  defaults: TaskPageDefaults = {},
) {
  const parsed = parseTasksSearchParams(searchParams, defaults);
  // Due-within-N-days windows use the owner's canonical local date from Time
  // Context so the Tasks workspace agrees with Today/Timer on the calendar day.
  const accountLocalDate = (await getWebTimeContext().catch(() => null))?.localDate;
  const ownerToday = accountLocalDate ?? getTodayLocalIsoDate();
  const timelineZoom = normalizeTimelineZoom(searchParams.tlZoom);
  const timelineRange = resolveTimelineRange(ownerToday, searchParams.tlStart);
  const workspaceData = await getTasksWorkspaceData(
    {
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
      view: parsed.view,
    },
    { todayIsoDate: accountLocalDate ?? undefined },
  );
  const {
    projects,
    goals,
    tasks,
    taskTotalDurations,
    summary,
    savedViews,
    activeProjectId,
    activeGoalId,
    view: workspaceView,
    filteredTotal: workspaceFilteredTotal,
    loadedCount: workspaceLoadedCount,
    truncated: workspaceTruncated,
  } = workspaceData;
  // Older/partial workspace fixtures and adapters may not echo the canonical
  // view; the parsed URL definition is the safe fallback.
  const view = workspaceView ?? parsed.view;
  const filteredTotal = workspaceFilteredTotal ?? tasks.length;
  const loadedCount = workspaceLoadedCount ?? tasks.length;
  const truncated = workspaceTruncated ?? false;
  const returnPath = buildTaskListUrl("/tasks", {
    filters: view.filters,
    group: view.groupBy,
    q: view.search,
    sortKey: view.sort.key,
    sortDirection: view.sort.direction,
    activeTasks: view.activeOnly,
    view: parsed.activeView,
    layout: parsed.activeLayout,
    density: parsed.activeDensity,
    boardOrder: parsed.activeBoardOrder,
    timelineStart: parsed.activeLayout === "timeline" ? timelineRange.start : null,
    timelineZoom: parsed.activeLayout === "timeline" ? timelineZoom : null,
    columns: view.columns,
  });

  const taskUrlFilters = {
    filters: view.filters,
    group: view.groupBy,
    q: view.search,
    sortKey: view.sort.key,
    sortDirection: view.sort.direction,
    activeTasks: view.activeOnly,
    density: parsed.activeDensity === "compact" ? "compact" : null,
    boardOrder: parsed.activeBoardOrder,
    columns: view.columns,
  };
  const today = accountLocalDate ?? getTodayLocalIsoDate();
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const groups = groupTaskViewRecords(
    tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      projectId: task.project_id,
      projectName: task.projects?.name ?? null,
      goalId: task.goal_id,
      goalTitle: task.goals?.title ?? null,
      dueDate: task.due_date,
      plannedForDate: task.planned_for_date,
      estimateMinutes: task.estimate_minutes,
      boardRank: task.board_rank,
      focusRank: task.focus_rank,
      createdAt: task.created_at ?? null,
      updatedAt: task.updated_at,
    })),
    view.groupBy,
    { today },
  ).map((group) => ({
    key: group.key,
    label: group.label,
    count: group.count,
    tasks: group.items
      .map((record) => tasksById.get(record.id))
      .filter((task): task is (typeof tasks)[number] => Boolean(task)),
  }));
  const kanbanBoard = buildTaskKanbanBoard(
    sortTasksForBoard(tasks, parsed.activeBoardOrder),
    parsed.activeStatus,
  );
  const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
  const blockedCount = tasks.filter((t) => t.status === "blocked").length;
  const overdueCount = tasks.filter((t) =>
    isTaskOverdue(t.due_date, t.status, accountLocalDate ?? undefined),
  ).length;
  const dueSoonCount = tasks.filter((t) =>
    isTaskDueSoon(t.due_date, t.status, accountLocalDate ?? undefined),
  ).length;

  // The selected task may be outside the current list filters (archived tab,
  // project filter, timeline window), so always load the drawer projection by
  // id. A missing or other-owner id yields null and the drawer shows an
  // unavailable state. The projection also carries dependency detail.
  const selectedTaskId = searchParams.task?.trim() || null;
  const selectedTaskMode = searchParams.taskMode === "full" ? "full" : "panel";
  const drawerResult = selectedTaskId
    ? await getTaskDrawerDetail(selectedTaskId)
    : ({ kind: "unavailable" as const } as const);
  const selectedTask = drawerResult.kind === "found" ? drawerResult.task : null;
  const selectedTaskError = drawerResult.kind === "error";
  const timeline =
    parsed.activeLayout === "timeline"
      ? await getTaskTimelineData({ range: timelineRange })
      : null;
  const selectedTaskSubtasks = selectedTaskId
    ? (await listTaskSubtasks(selectedTaskId)).data ?? []
    : [];
  const subtaskCounts = await getSubtaskCountsForTasks(tasks.map((task) => task.id));
  const selectedTaskActivityPage = selectedTaskId
    ? await getTaskActivity(selectedTaskId, { limit: 8 })
    : { items: [], hasMore: false };
  const selectedTaskActivity = selectedTaskActivityPage.items;
  const selectedTaskActivityHasMore = selectedTaskActivityPage.hasMore;
  const selectedTaskComments = selectedTaskId
    ? await getTaskCommentThread(selectedTaskId)
    : {
        comments: [],
        mentionCandidates: [],
        errorMessage: null,
      };
  const selectedTaskIsFavourite = selectedTaskId
    ? await isFavorite("task", selectedTaskId)
    : false;

  return {
    selectedTaskId,
    selectedTaskMode,
    selectedTask,
    selectedTaskError,
    selectedTaskSubtasks,
    subtaskCounts,
    selectedTaskActivity,
    selectedTaskActivityHasMore,
    selectedTaskComments,
    selectedTaskCommentMentions: selectedTaskComments.mentionCandidates,
    selectedTaskCommentError: selectedTaskComments.errorMessage,
    selectedTaskIsFavourite,
    parsed,
    projects,
    goals,
    tasks,
    taskTotalDurations,
    summary,
    savedViews,
    activeProjectId,
    activeGoalId,
    returnPath,
    taskUrlFilters,
    kanbanBoard,
    inProgressCount,
    blockedCount,
    overdueCount,
    dueSoonCount,
    groups,
    filteredTotal,
    loadedCount,
    truncated,
    timeline,
    timelineRange,
    timelineZoom,
    ownerToday,
  };
}

export type TasksPageModel = Awaited<ReturnType<typeof getTasksPageModel>>;
