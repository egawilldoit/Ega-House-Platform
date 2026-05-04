import { createClient } from "@/lib/supabase/server";
import type { Json, TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import {
  getTodayLocalIsoDate,
  normalizeTaskDueDateInput,
  shiftDateOnlyValue,
} from "@/lib/task-due-date";
import { normalizeTaskEstimateInput } from "@/lib/task-estimate";
import {
  isTaskRecurrenceRule,
  normalizeTaskRecurrenceScheduleInput,
  type TaskRecurrenceRule,
} from "@/lib/task-recurrence";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  isTaskCompletedStatus,
  isTaskPriority,
  isTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/task-domain";
import type { ManualWorkedTimePayload } from "@/lib/manual-worked-time";
import {
  applyTaskListQuery,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import type { TaskViewFilter } from "@/lib/task-archive";
import { getTaskTotalDurationMap } from "@/lib/task-session";
import { stopActiveTimerSessionsForTask } from "@/lib/services/timer-service";
import { getActiveTasksForOwner } from "@/lib/services/task-read-service";
import {
  isMissingTasksArchivedAtColumn,
  isMissingSupabaseColumn,
  isMissingSupabaseTable,
  isMissingTasksBlockedReasonColumn,
  isMissingTasksCompletedAtColumn,
} from "@/lib/supabase-error";
import {
  BLOCKED_SAVED_VIEW_DEFINITION,
  BLOCKED_SAVED_VIEW_ID,
  DEEP_WORK_SAVED_VIEW_DEFINITION,
  DEEP_WORK_SAVED_VIEW_ID,
  DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
  DUE_THIS_WEEK_SAVED_VIEW_ID,
  QUICK_WINS_SAVED_VIEW_DEFINITION,
  QUICK_WINS_SAVED_VIEW_ID,
  getTaskSavedViewDefinitionFromFilters,
  getTaskSavedViewFiltersFromDefinition,
  normalizeTaskSavedViewFilters,
  normalizeTaskSavedViewDefinition,
} from "@/lib/task-saved-views";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type TaskSavedViewSelectRow = {
  id: string;
  name: string;
  status: string | null;
  project_id: string | null;
  goal_id: string | null;
  due_filter: string | null;
  sort_value: string | null;
  definition_json?: Json | null;
  updated_at: string;
};

export const TASK_REMINDER_CHANNEL_VALUES = ["email"] as const;
export const TASK_REMINDER_STATUS_VALUES = [
  "pending",
  "processing",
  "sent",
  "failed",
  "cancelled",
] as const;

export type TaskReminderChannel = (typeof TASK_REMINDER_CHANNEL_VALUES)[number];
export type TaskReminderStatus = (typeof TASK_REMINDER_STATUS_VALUES)[number];

export type TaskReminderRecord = {
  id: string;
  task_id: string;
  remind_at: string;
  channel: TaskReminderChannel;
  status: TaskReminderStatus;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskRecurrenceRecord = {
  id: string;
  task_id: string;
  rule: TaskRecurrenceRule;
  anchor_date: string;
  timezone: string;
  next_occurrence_date: string;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskScopeSnapshot = {
  projectIds: Set<string>;
  goalsById: Map<string, { id: string; project_id: string }>;
};

export type TasksWorkspaceFilters = {
  activeStatus: TaskStatus | null;
  requestedProjectId: string | null;
  requestedGoalId: string | null;
  activeDueFilter: TaskDueFilter;
  activeSort: TaskSortValue;
  activeView: TaskViewFilter;
  activeTasksOnly?: boolean;
  activePriorityValues?: ReadonlyArray<TaskPriority>;
  activeEstimateMinMinutes?: number | null;
  activeEstimateMaxMinutes?: number | null;
  activeDueWithinDays?: number | null;
};

export type TasksWorkspaceData = {
  projects: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; title: string; project_id: string }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    blocked_reason: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    planned_for_date: string | null;
    estimate_minutes: number | null;
    updated_at: string;
    completed_at: string | null;
    project_id: string;
    goal_id: string | null;
    focus_rank: number | null;
    archived_at: string | null;
    archived_by: string | null;
    projects: { name: string } | null;
    goals: { title: string } | null;
    task_reminders: TaskReminderRecord[];
    task_recurrences: TaskRecurrenceRecord[];
  }>;
  summary: {
    total: number;
    active: number;
    archived: number;
  };
  taskTotalDurations: Record<string, number>;
  savedViews: Array<{
    id: string;
    name: string;
    status: string | null;
    project_id: string | null;
    goal_id: string | null;
    due_filter: string;
    sort_value: string;
    definition_json: Json | null;
    updated_at: string;
    is_default?: boolean;
  }>;
  savedViewsUnavailable: boolean;
  activeProjectId: string | null;
  activeGoalId: string | null;
};

export type TaskRecord = TasksWorkspaceData["tasks"][number];

export type ValidateTaskInlineUpdateInput = {
  taskId: string;
  status: string;
  priority: string;
  dueDate: unknown;
  estimateMinutes: unknown;
  blockedReason: unknown;
  recurrenceRule?: unknown;
  recurrenceAnchorDate?: unknown;
  recurrenceTimezone?: unknown;
};

export type ValidatedTaskInlineUpdateInput = {
  taskId: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  blockedReason: string | null;
  description?: string | null;
  recurrenceRule?: TaskRecurrenceRule | null;
  recurrenceAnchorDate?: string | null;
  recurrenceTimezone?: string | null;
};

const SYSTEM_TASK_SAVED_VIEWS = [
  {
    id: DEEP_WORK_SAVED_VIEW_ID,
    name: "Deep Work",
    definition_json: DEEP_WORK_SAVED_VIEW_DEFINITION,
  },
  {
    id: QUICK_WINS_SAVED_VIEW_ID,
    name: "Quick Wins",
    definition_json: QUICK_WINS_SAVED_VIEW_DEFINITION,
  },
  {
    id: BLOCKED_SAVED_VIEW_ID,
    name: "Blocked",
    definition_json: BLOCKED_SAVED_VIEW_DEFINITION,
  },
  {
    id: DUE_THIS_WEEK_SAVED_VIEW_ID,
    name: "Due This Week",
    definition_json: DUE_THIS_WEEK_SAVED_VIEW_DEFINITION,
  },
] as const;

export function normalizeTaskBlockedReasonInput(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function isTaskReminderChannel(value: string): value is TaskReminderChannel {
  return TASK_REMINDER_CHANNEL_VALUES.includes(value as TaskReminderChannel);
}

export function isTaskReminderStatus(value: string): value is TaskReminderStatus {
  return TASK_REMINDER_STATUS_VALUES.includes(value as TaskReminderStatus);
}

function getTaskBlockedReasonValidationError(
  status: TaskStatus,
  blockedReason: string | null,
) {
  if (status === "blocked" && !blockedReason) {
    return "Blocked reason is required when status is Blocked.";
  }

  return null;
}

type CreateTaskScopeErrorResult = {
  errorMessage: string;
};

type CreateTaskScopeSuccessResult = {
  errorMessage: null;
  scope: TaskScopeSnapshot;
};

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) {
    return supabase;
  }

  return createClient();
}

async function getAuthenticatedUserId(supabase: SupabaseServerClient) {
  if (!("auth" in supabase) || typeof supabase.auth?.getUser !== "function") {
    return null;
  }

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return data.user?.id ?? null;
}

function isTasksBlockedReasonMissing(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null,
) {
  return isMissingTasksBlockedReasonColumn(error);
}

function isTasksArchivedAtMissing(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null,
) {
  return isMissingTasksArchivedAtColumn(error);
}

function isTaskSavedViewDefinitionJsonMissing(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null,
) {
  return isMissingSupabaseColumn(error, "public.task_saved_views", "definition_json");
}

async function getVisibleTaskScope(
  supabase: SupabaseServerClient,
): Promise<CreateTaskScopeErrorResult | CreateTaskScopeSuccessResult> {
  const [projectsResult, goalsResult] = await Promise.all([
    supabase.from("projects").select("id"),
    supabase.from("goals").select("id, project_id"),
  ]);

  if (projectsResult.error || goalsResult.error) {
    return {
      errorMessage: "Unable to validate task scope right now.",
    };
  }

  return {
    errorMessage: null,
    scope: {
      projectIds: new Set((projectsResult.data ?? []).map((project) => project.id)),
      goalsById: new Map((goalsResult.data ?? []).map((goal) => [goal.id, goal])),
    },
  };
}

export function getTaskInsertScopeError(
  row: TablesInsert<"tasks">,
  scope: TaskScopeSnapshot,
) {
  if (!scope.projectIds.has(row.project_id)) {
    return "Selected project is unavailable.";
  }

  if (!row.goal_id) {
    return null;
  }

  const goal = scope.goalsById.get(row.goal_id);

  if (!goal) {
    return "Selected goal is unavailable.";
  }

  if (goal.project_id !== row.project_id) {
    return "Selected goal does not belong to the chosen project.";
  }

  return null;
}

export async function getTaskScopeSnapshot(options?: { supabase?: SupabaseServerClient }) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const scopeResult = await getVisibleTaskScope(supabase);

  if (scopeResult.errorMessage !== null) {
    return {
      errorMessage: scopeResult.errorMessage,
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: scopeResult.scope,
  };
}

function normalizeTaskReminderCreateInput(input: {
  taskId: string;
  remindAt: unknown;
  channel?: unknown;
  status?: unknown;
  now?: Date;
}) {
  const taskId = input.taskId.trim();
  const channel = String(input.channel ?? "email").trim() || "email";
  const status = String(input.status ?? "pending").trim() || "pending";
  const rawRemindAt = String(input.remindAt ?? "").trim();
  const remindAtDate = new Date(rawRemindAt);
  const now = input.now ?? new Date();

  if (!taskId) {
    return { errorMessage: "Task is required." };
  }

  if (!rawRemindAt || Number.isNaN(remindAtDate.getTime())) {
    return { errorMessage: "Reminder time is required." };
  }

  if (!isTaskReminderChannel(channel)) {
    return { errorMessage: "Reminder channel is not supported." };
  }

  if (!isTaskReminderStatus(status) || status !== "pending") {
    return { errorMessage: "Reminder status is not supported." };
  }

  if (remindAtDate.getTime() <= now.getTime()) {
    return { errorMessage: "Reminder time must be in the future." };
  }

  return {
    errorMessage: null,
    data: {
      taskId,
      remindAtIso: remindAtDate.toISOString(),
      channel,
      status,
    },
  };
}

function normalizeTaskReminderCancelInput(input: {
  taskId: string;
  reminderId: string;
  status?: unknown;
}) {
  const taskId = input.taskId.trim();
  const reminderId = input.reminderId.trim();
  const status = String(input.status ?? "cancelled").trim() || "cancelled";

  if (!taskId || !reminderId) {
    return { errorMessage: "Reminder cancel request is invalid." };
  }

  if (!isTaskReminderStatus(status) || status !== "cancelled") {
    return { errorMessage: "Reminder status is not supported." };
  }

  return {
    errorMessage: null,
    data: {
      taskId,
      reminderId,
      status,
    },
  };
}

function normalizeTaskReminderRow(row: {
  id: string;
  task_id: string;
  remind_at: string;
  channel: string;
  status: string;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}): TaskReminderRecord {
  return {
    ...row,
    channel: isTaskReminderChannel(row.channel) ? row.channel : "email",
    status: isTaskReminderStatus(row.status) ? row.status : "failed",
  };
}

function normalizeTaskRecurrenceRow(row: {
  id: string;
  task_id: string;
  rule: string;
  anchor_date: string;
  timezone: string;
  next_occurrence_date: string;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}): TaskRecurrenceRecord | null {
  if (!isTaskRecurrenceRule(row.rule)) {
    return null;
  }

  return {
    ...row,
    rule: row.rule,
  };
}

export async function getTaskRemindersForTasks(
  supabase: SupabaseServerClient,
  taskIds: string[],
) {
  const uniqueTaskIds = [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
  const remindersByTaskId: Record<string, TaskReminderRecord[]> = {};

  if (uniqueTaskIds.length === 0) {
    return remindersByTaskId;
  }

  const { data, error } = await supabase
    .from("task_reminders")
    .select(
      "id, task_id, remind_at, channel, status, sent_at, failure_reason, created_at, updated_at",
    )
    .in("task_id", uniqueTaskIds)
    .order("remind_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load task reminders: ${error.message}`);
  }

  for (const reminder of data ?? []) {
    const normalizedReminder = normalizeTaskReminderRow(reminder);
    remindersByTaskId[normalizedReminder.task_id] ??= [];
    remindersByTaskId[normalizedReminder.task_id]?.push(normalizedReminder);
  }

  return remindersByTaskId;
}

export async function getTaskRecurrencesForTasks(
  supabase: SupabaseServerClient,
  taskIds: string[],
) {
  const uniqueTaskIds = [...new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
  const recurrencesByTaskId: Record<string, TaskRecurrenceRecord[]> = {};

  if (uniqueTaskIds.length === 0) {
    return recurrencesByTaskId;
  }

  const { data, error } = await supabase
    .from("task_recurrences")
    .select(
      "id, task_id, rule, anchor_date, timezone, next_occurrence_date, last_generated_at, created_at, updated_at",
    )
    .in("task_id", uniqueTaskIds);

  if (error) {
    throw new Error(`Failed to load task recurrences: ${error.message}`);
  }

  for (const recurrence of data ?? []) {
    const normalizedRecurrence = normalizeTaskRecurrenceRow(recurrence);
    if (!normalizedRecurrence) {
      continue;
    }
    recurrencesByTaskId[normalizedRecurrence.task_id] ??= [];
    recurrencesByTaskId[normalizedRecurrence.task_id]?.push(normalizedRecurrence);
  }

  return recurrencesByTaskId;
}

export async function setTaskRecurrence(
  input: {
    taskId: string;
    recurrenceRule: unknown;
    recurrenceAnchorDate?: unknown;
    recurrenceTimezone?: unknown;
  },
  options?: {
    supabase?: SupabaseServerClient;
    updatedAtIso?: string;
    fallbackAnchorDate?: string;
  },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const taskId = input.taskId.trim();
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const scheduleResult = normalizeTaskRecurrenceScheduleInput({
    rule: input.recurrenceRule,
    anchorDate: input.recurrenceAnchorDate,
    timezone: input.recurrenceTimezone,
    fallbackAnchorDate: options?.fallbackAnchorDate ?? getTodayLocalIsoDate(),
  });

  if (!taskId) {
    return { errorMessage: "Task is required." };
  }

  if (scheduleResult.errorMessage) {
    return { errorMessage: scheduleResult.errorMessage };
  }

  const taskResult = await getVisibleTaskById(supabase, taskId);
  if (taskResult.errorMessage) {
    return { errorMessage: taskResult.errorMessage };
  }

  if (!scheduleResult.schedule) {
    const { error } = await supabase.from("task_recurrences").delete().eq("task_id", taskId);
    return {
      errorMessage: error ? "Unable to clear recurring preset right now." : null,
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from("task_recurrences")
    .select("id")
    .eq("task_id", taskId)
    .maybeSingle();

  if (existingError) {
    return { errorMessage: "Unable to load recurring preset right now." };
  }

  if (existing) {
    const { error } = await supabase
      .from("task_recurrences")
      .update({
        rule: scheduleResult.schedule.rule,
        anchor_date: scheduleResult.schedule.anchorDate,
        timezone: scheduleResult.schedule.timezone,
        next_occurrence_date: scheduleResult.schedule.nextOccurrenceDate,
        last_generated_at: null,
        updated_at: updatedAtIso,
      })
      .eq("task_id", taskId);

    return {
      errorMessage: error ? "Unable to update recurring preset right now." : null,
    };
  }

  const { error } = await supabase.from("task_recurrences").insert({
    task_id: taskId,
    rule: scheduleResult.schedule.rule,
    anchor_date: scheduleResult.schedule.anchorDate,
    timezone: scheduleResult.schedule.timezone,
    next_occurrence_date: scheduleResult.schedule.nextOccurrenceDate,
    last_generated_at: null,
  });

  return {
    errorMessage: error ? "Unable to save recurring preset right now." : null,
  };
}

async function getVisibleTaskById(supabase: SupabaseServerClient, taskId: string) {
  const userId = await getAuthenticatedUserId(supabase);
  let query = supabase
    .from("tasks")
    .select(userId ? "id, owner_user_id" : "id")
    .eq("id", taskId);

  if (userId) {
    query = query.eq("owner_user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to load task right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Task was not found or is no longer available.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data,
  };
}

export async function getTasksWorkspaceData(
  filters: TasksWorkspaceFilters,
  options?: { supabase?: SupabaseServerClient; todayIsoDate?: string },
): Promise<TasksWorkspaceData> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const todayIsoDate = options?.todayIsoDate ?? getTodayLocalIsoDate();
  const dueWithinEndIsoDate = filters.activeDueWithinDays
    ? shiftDateOnlyValue(todayIsoDate, filters.activeDueWithinDays)
    : null;
  const savedViewSelectWithDefinition =
    "id, name, status, project_id, goal_id, due_filter, sort_value, definition_json, updated_at";
  const savedViewSelectLegacy =
    "id, name, status, project_id, goal_id, due_filter, sort_value, updated_at";
  const [projectsResult, goalsResult, initialSavedViewsResult, taskSummaryResult] = await Promise.all([
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase
      .from("goals")
      .select("id, title, project_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("task_saved_views")
      .select(savedViewSelectWithDefinition)
      .order("updated_at", { ascending: false }),
    supabase.from("tasks").select("archived_at"),
  ]);
  let savedViewsResult: {
    data: TaskSavedViewSelectRow[] | null;
    error: typeof initialSavedViewsResult.error;
  } = initialSavedViewsResult;

  if (isTaskSavedViewDefinitionJsonMissing(initialSavedViewsResult.error)) {
    savedViewsResult = await supabase
      .from("task_saved_views")
      .select(savedViewSelectLegacy)
      .order("updated_at", { ascending: false });
  }

  if (projectsResult.error) {
    throw new Error(`Failed to load projects: ${projectsResult.error.message}`);
  }

  if (goalsResult.error) {
    throw new Error(`Failed to load goals: ${goalsResult.error.message}`);
  }

  const savedViewsUnavailable = isMissingSupabaseTable(
    savedViewsResult.error,
    "public.task_saved_views",
  );

  if (savedViewsResult.error && !savedViewsUnavailable) {
    throw new Error(`Failed to load saved views: ${savedViewsResult.error.message}`);
  }

  const taskSummaryUnavailable = isTasksArchivedAtMissing(taskSummaryResult.error);
  if (taskSummaryResult.error && !taskSummaryUnavailable) {
    throw new Error(`Failed to load task summary: ${taskSummaryResult.error.message}`);
  }

  const activeProjectId =
    filters.requestedProjectId &&
    projectsResult.data.some((project) => project.id === filters.requestedProjectId)
      ? filters.requestedProjectId
      : null;
  const visibleGoals = activeProjectId
    ? goalsResult.data.filter((goal) => goal.project_id === activeProjectId)
    : goalsResult.data;
  const activeGoalId =
    filters.requestedGoalId && visibleGoals.some((goal) => goal.id === filters.requestedGoalId)
      ? filters.requestedGoalId
      : null;

  const tasksResult = await getActiveTasksForOwner({
    supabase,
    archiveFilter: filters.activeView === "all" ? "all" : filters.activeView,
    applyQuery(query) {
      if (filters.activeTasksOnly) {
        query = query.neq("status", "done");
      }

      if (filters.activePriorityValues?.length) {
        query = query.in("priority", [...filters.activePriorityValues]);
      }

      if (filters.activeEstimateMinMinutes) {
        query = query.gte("estimate_minutes", filters.activeEstimateMinMinutes);
      }

      if (filters.activeEstimateMaxMinutes) {
        query = query.lte("estimate_minutes", filters.activeEstimateMaxMinutes);
      }

      if (dueWithinEndIsoDate) {
        query = query.gte("due_date", todayIsoDate).lte("due_date", dueWithinEndIsoDate);
      }

      if (filters.activeStatus) {
        query = query.eq("status", filters.activeStatus);
      }

      if (activeProjectId) {
        query = query.eq("project_id", activeProjectId);
      }

      if (activeGoalId) {
        query = query.eq("goal_id", activeGoalId);
      }

      return query;
    },
  });

  if (tasksResult.errorMessage) {
    throw new Error(`Failed to load tasks: ${tasksResult.errorMessage}`);
  }

  const rawTasks = tasksResult.data;

  const tasks = applyTaskListQuery(rawTasks, {
    dueFilter: filters.activeDueFilter,
    sortValue: filters.activeSort,
  });

  const taskIds = tasks.map((task) => task.id);
  const [taskTotalDurations, taskRemindersByTaskId, taskRecurrencesByTaskId] = await Promise.all([
    getTaskTotalDurationMap(supabase, taskIds),
    getTaskRemindersForTasks(supabase, taskIds),
    getTaskRecurrencesForTasks(supabase, taskIds),
  ]);
  const tasksWithReminders = tasks.map((task) => ({
    ...task,
    task_reminders: taskRemindersByTaskId[task.id] ?? [],
    task_recurrences: taskRecurrencesByTaskId[task.id] ?? [],
  }));

  return {
    projects: projectsResult.data,
    goals: visibleGoals,
    tasks: tasksWithReminders,
    taskTotalDurations,
    summary: {
      total: taskSummaryUnavailable ? tasks.length : (taskSummaryResult.data ?? []).length,
      active: taskSummaryUnavailable
        ? tasks.length
        : (taskSummaryResult.data ?? []).filter((task) => !task.archived_at).length,
      archived: taskSummaryUnavailable
        ? 0
        : (taskSummaryResult.data ?? []).filter((task) => task.archived_at).length,
    },
    savedViews: savedViewsUnavailable
      ? []
      : [
          ...SYSTEM_TASK_SAVED_VIEWS.map((view, index) => ({
            id: view.id,
            name: view.name,
            status: null,
            project_id: null,
            goal_id: null,
            due_filter: "all",
            sort_value: "updated_desc",
            definition_json: view.definition_json,
            updated_at: `2026-04-30T00:00:0${index}.000Z`,
            is_default: true,
          })),
          ...(savedViewsResult.data ?? []).map((view) => {
            const definition = normalizeTaskSavedViewDefinition(
              "definition_json" in view ? view.definition_json : null,
            );
            const definitionFilters = getTaskSavedViewFiltersFromDefinition(definition);
            const legacyFilters = normalizeTaskSavedViewFilters({
              status: definitionFilters.status ?? view.status,
              projectId: view.project_id,
              goalId: view.goal_id,
              dueFilter: view.due_filter ?? "all",
              sortValue: view.sort_value ?? "updated_desc",
              activeTasks: definitionFilters.activeTasks,
              priority: definitionFilters.priorityValues,
              estimateMinMinutes: definitionFilters.estimateMinMinutes,
              estimateMaxMinutes: definitionFilters.estimateMaxMinutes,
              dueWithinDays: definitionFilters.dueWithinDays,
            });

            return {
              id: view.id,
              name: view.name,
              status: legacyFilters.status,
              project_id: legacyFilters.projectId,
              goal_id: legacyFilters.goalId,
              due_filter: legacyFilters.dueFilter,
              sort_value: legacyFilters.sortValue,
              definition_json:
                definition ?? getTaskSavedViewDefinitionFromFilters(legacyFilters),
              updated_at: view.updated_at,
            };
          }),
        ],
    savedViewsUnavailable,
    activeProjectId,
    activeGoalId,
  };
}

export async function createTasks(
  taskRows: TablesInsert<"tasks">[],
  options?: { supabase?: SupabaseServerClient },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);

  if (taskRows.length === 0) {
    return { errorMessage: "No tasks were provided." };
  }

  const taskScope = await getVisibleTaskScope(supabase);

  if (taskScope.errorMessage !== null) {
    return { errorMessage: taskScope.errorMessage };
  }

  for (const row of taskRows) {
    const statusValue = String(row.status ?? "todo").trim();
    const blockedReason = normalizeTaskBlockedReasonInput(row.blocked_reason);

    if (statusValue === "blocked" && !blockedReason) {
      return { errorMessage: "Blocked reason is required when status is Blocked." };
    }

    row.blocked_reason = statusValue === "blocked" ? blockedReason : null;
    if (statusValue === "done" && !row.completed_at) {
      row.completed_at = new Date().toISOString();
    }
    const scopeError = getTaskInsertScopeError(row, taskScope.scope);
    if (scopeError) {
      return { errorMessage: scopeError };
    }
  }

  let { data, error } = await supabase.from("tasks").insert(taskRows).select("id");

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackRows = taskRows.map((row) => {
      const nextRow = { ...row };
      delete (nextRow as { blocked_reason?: unknown }).blocked_reason;
      return nextRow;
    });
    const fallbackResult = await supabase.from("tasks").insert(fallbackRows).select("id");
    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    return { errorMessage: "Unable to create task right now." };
  }

  return {
    errorMessage: null,
    createdTaskIds: (data ?? []).map((row) => row.id),
  };
}

export async function createTaskWithOptionalWorkedTime(
  input: {
    task: TablesInsert<"tasks">;
    workedTime?: ManualWorkedTimePayload | null;
    recurrenceRule?: unknown;
    recurrenceAnchorDate?: unknown;
    recurrenceTimezone?: unknown;
  },
  options?: { supabase?: SupabaseServerClient },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const fallbackAnchorDate = input.task.due_date ?? getTodayLocalIsoDate();
  const recurrenceResult =
    input.recurrenceRule === undefined
      ? { errorMessage: null, schedule: undefined }
      : normalizeTaskRecurrenceScheduleInput({
          rule: input.recurrenceRule,
          anchorDate: input.recurrenceAnchorDate,
          timezone: input.recurrenceTimezone,
          fallbackAnchorDate,
        });

  if (recurrenceResult.errorMessage) {
    return {
      errorMessage: recurrenceResult.errorMessage,
      createdTaskId: null,
      workedTimeLogged: false,
    };
  }

  const createResult = await createTasks([input.task], { supabase });

  if (createResult.errorMessage) {
    return {
      errorMessage: createResult.errorMessage,
      createdTaskId: null,
      workedTimeLogged: false,
    };
  }

  const createdTaskId = createResult.createdTaskIds?.[0] ?? null;
  if (createdTaskId && recurrenceResult.schedule) {
    const setRecurrenceResult = await setTaskRecurrence(
      {
        taskId: createdTaskId,
        recurrenceRule: recurrenceResult.schedule.rule,
        recurrenceAnchorDate: recurrenceResult.schedule.anchorDate,
        recurrenceTimezone: recurrenceResult.schedule.timezone,
      },
      { supabase, fallbackAnchorDate },
    );

    if (setRecurrenceResult.errorMessage) {
      return {
        errorMessage: setRecurrenceResult.errorMessage,
        createdTaskId,
        workedTimeLogged: false,
      };
    }
  }

  if (!input.workedTime) {
    return {
      errorMessage: null,
      createdTaskId,
      workedTimeLogged: false,
    };
  }

  if (!createdTaskId) {
    return {
      errorMessage: "Task created, but worked time could not be logged.",
      createdTaskId: null,
      workedTimeLogged: false,
    };
  }

  const { error } = await supabase.from("task_sessions").insert({
    task_id: createdTaskId,
    started_at: input.workedTime.started_at,
    ended_at: input.workedTime.ended_at,
    duration_seconds: input.workedTime.duration_seconds,
  });

  if (error) {
    return {
      errorMessage: "Task created, but worked time could not be logged.",
      createdTaskId,
      workedTimeLogged: false,
    };
  }

  return {
    errorMessage: null,
    createdTaskId,
    workedTimeLogged: true,
  };
}

export async function createTaskEmailReminder(
  input: {
    taskId: string;
    remindAt: unknown;
    channel?: unknown;
    status?: unknown;
  },
  options?: { supabase?: SupabaseServerClient; now?: Date },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const validationResult = normalizeTaskReminderCreateInput({
    ...input,
    now: options?.now,
  });

  if (validationResult.errorMessage || !validationResult.data) {
    return {
      errorMessage: validationResult.errorMessage ?? "Reminder request is invalid.",
      data: null,
    };
  }

  const taskResult = await getVisibleTaskById(supabase, validationResult.data.taskId);
  if (taskResult.errorMessage) {
    return {
      errorMessage: taskResult.errorMessage,
      data: null,
    };
  }

  const { data, error } = await supabase
    .from("task_reminders")
    .insert({
      task_id: validationResult.data.taskId,
      remind_at: validationResult.data.remindAtIso,
      channel: validationResult.data.channel,
      status: validationResult.data.status,
    })
    .select(
      "id, task_id, remind_at, channel, status, sent_at, failure_reason, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to create reminder right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Reminder could not be created.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: normalizeTaskReminderRow(data),
  };
}

export async function cancelTaskReminder(
  input: {
    taskId: string;
    reminderId: string;
    status?: unknown;
  },
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const validationResult = normalizeTaskReminderCancelInput(input);

  if (validationResult.errorMessage || !validationResult.data) {
    return {
      errorMessage: validationResult.errorMessage ?? "Reminder cancel request is invalid.",
      data: null,
    };
  }

  const taskResult = await getVisibleTaskById(supabase, validationResult.data.taskId);
  if (taskResult.errorMessage) {
    return {
      errorMessage: taskResult.errorMessage,
      data: null,
    };
  }

  const { data, error } = await supabase
    .from("task_reminders")
    .update({
      status: validationResult.data.status,
      updated_at: updatedAtIso,
    })
    .eq("id", validationResult.data.reminderId)
    .eq("task_id", validationResult.data.taskId)
    .eq("status", "pending")
    .select(
      "id, task_id, remind_at, channel, status, sent_at, failure_reason, created_at, updated_at",
    )
    .maybeSingle();

  if (error) {
    return {
      errorMessage: "Unable to cancel reminder right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: "Pending reminder was not found or is no longer cancellable.",
      data: null,
    };
  }

  return {
    errorMessage: null,
    data: normalizeTaskReminderRow(data),
  };
}

export function validateTaskInlineUpdateInput(input: ValidateTaskInlineUpdateInput) {
  const taskId = input.taskId.trim();
  const status = input.status.trim();
  const priority = input.priority.trim();
  const dueDateResult = normalizeTaskDueDateInput(input.dueDate);
  const estimateResult = normalizeTaskEstimateInput(input.estimateMinutes);
  const blockedReason = normalizeTaskBlockedReasonInput(input.blockedReason);
  const recurrenceRuleResult =
    input.recurrenceRule === undefined
      ? { errorMessage: null, schedule: undefined }
      : normalizeTaskRecurrenceScheduleInput({
          rule: input.recurrenceRule,
          anchorDate: input.recurrenceAnchorDate,
          timezone: input.recurrenceTimezone,
          fallbackAnchorDate: dueDateResult.value ?? getTodayLocalIsoDate(),
        });

  if (!taskId) {
    return {
      errorMessage: "Task update request is invalid.",
    };
  }

  if (!isTaskStatus(status)) {
    return {
      errorMessage: `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.`,
    };
  }

  if (!isTaskPriority(priority)) {
    return {
      errorMessage: `Priority must be one of: ${TASK_PRIORITY_VALUES.join(", ")}.`,
    };
  }

  if (dueDateResult.error) {
    return {
      errorMessage: dueDateResult.error,
    };
  }

  if (estimateResult.error) {
    return {
      errorMessage: estimateResult.error,
    };
  }

  if (recurrenceRuleResult.errorMessage) {
    return {
      errorMessage: recurrenceRuleResult.errorMessage,
    };
  }

  const blockedReasonError = getTaskBlockedReasonValidationError(status, blockedReason);
  if (blockedReasonError) {
    return {
      errorMessage: blockedReasonError,
    };
  }

  const normalizedBlockedReason = status === "blocked" ? blockedReason : null;

  return {
    errorMessage: null,
    data: {
      taskId,
      status,
      priority,
      dueDate: dueDateResult.value,
      estimateMinutes: estimateResult.value,
      blockedReason: normalizedBlockedReason,
      ...(input.recurrenceRule === undefined
        ? {}
        : {
            recurrenceRule: recurrenceRuleResult.schedule?.rule ?? null,
            recurrenceAnchorDate: recurrenceRuleResult.schedule?.anchorDate ?? null,
            recurrenceTimezone: recurrenceRuleResult.schedule?.timezone ?? null,
          }),
    } satisfies ValidatedTaskInlineUpdateInput,
  };
}

export async function updateTaskInline(
  input: ValidatedTaskInlineUpdateInput,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();

  let { data: currentTask, error: currentTaskError } = await supabase
    .from("tasks")
    .select("id, status, completed_at, archived_at")
    .eq("id", input.taskId)
    .maybeSingle();
  let completedAtUnavailable = false;

  if (currentTaskError && isMissingTasksCompletedAtColumn(currentTaskError)) {
    const fallbackResult = await supabase
      .from("tasks")
      .select("id, status, archived_at")
      .eq("id", input.taskId)
      .maybeSingle();

    currentTask = fallbackResult.data
      ? { ...fallbackResult.data, completed_at: null }
      : null;
    currentTaskError = fallbackResult.error;
    completedAtUnavailable = true;
  }

  if (currentTaskError) {
    return { errorMessage: "Unable to load task right now." };
  }

  if (!currentTask) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  if (input.status === "done" && !isTaskCompletedStatus(currentTask.status)) {
    const stopResult = await stopActiveTimerSessionsForTask(input.taskId, {
      supabase,
      nowIso: updatedAtIso,
    });

    if (stopResult.errorMessage) {
      return { errorMessage: stopResult.errorMessage };
    }
  }

  const updatePayload: TablesUpdate<"tasks"> = {
    status: input.status,
    priority: input.priority,
    due_date: input.dueDate,
    estimate_minutes: input.estimateMinutes,
    blocked_reason: input.blockedReason,
    updated_at: updatedAtIso,
  };

  if (input.description !== undefined) {
    updatePayload.description = input.description;
  }

  if (!completedAtUnavailable) {
    updatePayload.completed_at =
      input.status === "done"
        ? isTaskCompletedStatus(currentTask.status) && currentTask.completed_at
          ? currentTask.completed_at
          : updatedAtIso
        : null;
  }

  let { data: updatedTask, error } = await supabase
    .from("tasks")
    .update(updatePayload)
    .eq("id", input.taskId)
    .select("id")
    .maybeSingle();

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.blocked_reason;
    const fallbackResult = await supabase
      .from("tasks")
      .update(fallbackPayload)
      .eq("id", input.taskId)
      .select("id")
      .maybeSingle();
    updatedTask = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error && isMissingTasksCompletedAtColumn(error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.completed_at;
    const fallbackResult = await supabase
      .from("tasks")
      .update(fallbackPayload)
      .eq("id", input.taskId)
      .select("id")
      .maybeSingle();
    updatedTask = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) {
    return { errorMessage: "Unable to update task right now." };
  }

  if (!updatedTask) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  if (input.recurrenceRule !== undefined) {
    const recurrenceResult = await setTaskRecurrence(
      {
        taskId: input.taskId,
        recurrenceRule: input.recurrenceRule,
        recurrenceAnchorDate: input.recurrenceAnchorDate,
        recurrenceTimezone: input.recurrenceTimezone,
      },
      {
        supabase,
        updatedAtIso,
        fallbackAnchorDate: input.dueDate ?? getTodayLocalIsoDate(),
      },
    );

    if (recurrenceResult.errorMessage) {
      return { errorMessage: recurrenceResult.errorMessage };
    }
  }

  return { errorMessage: null };
}

export async function updateTaskArchiveState(
  taskId: string,
  archived: boolean,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedTaskId = taskId.trim();
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();

  if (!normalizedTaskId) {
    return { errorMessage: "Task archive request is invalid." };
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id, archived_at")
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (taskError && isTasksArchivedAtMissing(taskError)) {
    return { errorMessage: "Unable to archive task right now." };
  }

  if (taskError) {
    return { errorMessage: "Unable to load task right now." };
  }

  if (!task) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  if (archived) {
    const activeSessionResult = await supabase
      .from("task_sessions")
      .select("id")
      .eq("task_id", normalizedTaskId)
      .is("ended_at", null)
      .limit(1);

    if (activeSessionResult.error) {
      return { errorMessage: "Unable to validate timer sessions for this task right now." };
    }

    if ((activeSessionResult.data ?? []).length > 0) {
      return { errorMessage: "Stop the active timer before archiving this task." };
    }
  }

  const userResult = archived ? await supabase.auth.getUser() : null;
  const archivedBy = archived && !userResult?.error ? userResult?.data.user?.id ?? null : null;

  const { error } = await supabase
    .from("tasks")
    .update({
      archived_at: archived ? updatedAtIso : null,
      archived_by: archivedBy,
      focus_rank: archived ? null : undefined,
      updated_at: updatedAtIso,
    })
    .eq("id", normalizedTaskId);

  if (error) {
    return { errorMessage: "Unable to update task archive right now." };
  }

  return { errorMessage: null };
}

export async function archiveTask(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  return updateTaskArchiveState(taskId, true, options);
}

export async function unarchiveTask(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  return updateTaskArchiveState(taskId, false, options);
}

export async function getTaskById(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    return {
      errorMessage: "Task id is required.",
      data: null,
    };
  }

  let { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description, blocked_reason, status, priority, due_date, planned_for_date, estimate_minutes, updated_at, completed_at, project_id, goal_id, focus_rank, archived_at, archived_by, projects(name), goals(title)",
    )
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackResult = await supabase
      .from("tasks")
      .select(
        "id, title, description, status, priority, due_date, planned_for_date, estimate_minutes, updated_at, completed_at, project_id, goal_id, focus_rank, archived_at, archived_by, projects(name), goals(title)",
      )
      .eq("id", normalizedTaskId)
      .maybeSingle();

    if (!fallbackResult.error) {
      data = fallbackResult.data
        ? {
            ...fallbackResult.data,
            blocked_reason: null,
            completed_at: fallbackResult.data.completed_at ?? null,
          }
        : null;
      error = null;
    }
  }

  if (error) {
    return {
      errorMessage: "Unable to load task right now.",
      data: null,
    };
  }

  if (!data) {
    return {
      errorMessage: null,
      data: null,
    };
  }

  const recurrencesByTaskId = await getTaskRecurrencesForTasks(supabase, [normalizedTaskId]);

  return {
    errorMessage: null,
    data: {
      ...data,
      task_reminders: [],
      task_recurrences: recurrencesByTaskId[normalizedTaskId] ?? [],
    } as TaskRecord,
  };
}

export async function deleteTaskSafely(
  taskId: string,
  options?: { supabase?: SupabaseServerClient },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    return { errorMessage: "Task id is required." };
  }

  const taskResult = await supabase
    .from("tasks")
    .select("id")
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (taskResult.error) {
    return { errorMessage: "Unable to load task right now." };
  }

  if (!taskResult.data) {
    return { errorMessage: "Task was not found or is no longer available." };
  }

  const activeSessionResult = await supabase
    .from("task_sessions")
    .select("id")
    .eq("task_id", normalizedTaskId)
    .is("ended_at", null)
    .limit(1);

  if (activeSessionResult.error) {
    return { errorMessage: "Unable to validate timer sessions for this task right now." };
  }

  if ((activeSessionResult.data ?? []).length > 0) {
    return { errorMessage: "Stop the active timer on this task before deleting it." };
  }

  const sessionCountResult = await supabase
    .from("task_sessions")
    .select("id", { count: "exact", head: true })
    .eq("task_id", normalizedTaskId);

  if (sessionCountResult.error) {
    return { errorMessage: "Unable to validate task history right now." };
  }

  if ((sessionCountResult.count ?? 0) > 0) {
    return { errorMessage: "Task has tracked timer history and cannot be deleted safely." };
  }

  const { error: deleteError } = await supabase
    .from("tasks")
    .delete()
    .eq("id", normalizedTaskId);

  if (deleteError) {
    return { errorMessage: "Unable to delete task right now." };
  }

  return { errorMessage: null };
}
