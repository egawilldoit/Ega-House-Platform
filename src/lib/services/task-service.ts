import { createClient } from "@/lib/supabase/server";
import type { TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import { normalizeTaskDueDateInput } from "@/lib/task-due-date";
import { normalizeTaskEstimateInput } from "@/lib/task-estimate";
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
  isMissingSupabaseTable,
  isMissingTasksBlockedReasonColumn,
  isMissingTasksCompletedAtColumn,
} from "@/lib/supabase-error";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

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
    updated_at: string;
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
};

export type ValidatedTaskInlineUpdateInput = {
  taskId: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  blockedReason: string | null;
  description?: string | null;
};

export function normalizeTaskBlockedReasonInput(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
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

export async function getTasksWorkspaceData(
  filters: TasksWorkspaceFilters,
  options?: { supabase?: SupabaseServerClient },
): Promise<TasksWorkspaceData> {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const [projectsResult, goalsResult, savedViewsResult, taskSummaryResult] = await Promise.all([
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase
      .from("goals")
      .select("id, title, project_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("task_saved_views")
      .select("id, name, status, project_id, goal_id, due_filter, sort_value, updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("tasks").select("archived_at"),
  ]);

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

  const taskTotalDurations = await getTaskTotalDurationMap(
    supabase,
    tasks.map((task) => task.id),
  );

  return {
    projects: projectsResult.data,
    goals: visibleGoals,
    tasks,
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
      : (savedViewsResult.data ?? []).map((view) => ({
          id: view.id,
          name: view.name,
          status: view.status,
          project_id: view.project_id,
          goal_id: view.goal_id,
          due_filter: view.due_filter ?? "all",
          sort_value: view.sort_value ?? "updated_desc",
          updated_at: view.updated_at,
        })),
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
  },
  options?: { supabase?: SupabaseServerClient },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const createResult = await createTasks([input.task], { supabase });

  if (createResult.errorMessage) {
    return {
      errorMessage: createResult.errorMessage,
      createdTaskId: null,
      workedTimeLogged: false,
    };
  }

  const createdTaskId = createResult.createdTaskIds?.[0] ?? null;
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

export function validateTaskInlineUpdateInput(input: ValidateTaskInlineUpdateInput) {
  const taskId = input.taskId.trim();
  const status = input.status.trim();
  const priority = input.priority.trim();
  const dueDateResult = normalizeTaskDueDateInput(input.dueDate);
  const estimateResult = normalizeTaskEstimateInput(input.estimateMinutes);
  const blockedReason = normalizeTaskBlockedReasonInput(input.blockedReason);

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
      "id, title, description, blocked_reason, status, priority, due_date, estimate_minutes, updated_at, completed_at, project_id, goal_id, focus_rank, archived_at, archived_by, projects(name), goals(title)",
    )
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackResult = await supabase
      .from("tasks")
      .select(
        "id, title, description, status, priority, due_date, estimate_minutes, updated_at, completed_at, project_id, goal_id, focus_rank, archived_at, archived_by, projects(name), goals(title)",
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

  return {
    errorMessage: null,
    data: data as TaskRecord | null,
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
