import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { normalizeTaskDueDateInput } from "@/lib/task-due-date";
import { normalizeTaskEstimateInput } from "@/lib/task-estimate";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  isTaskPriority,
  isTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/task-domain";
import {
  applyTaskListQuery,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import { getTaskTotalDurationMap } from "@/lib/task-session";
import {
  isMissingSupabaseTable,
  isMissingTasksBlockedReasonColumn,
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
    project_id: string;
    goal_id: string | null;
    focus_rank: number | null;
    projects: { name: string } | null;
    goals: { title: string } | null;
  }>;
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
  const [projectsResult, goalsResult, savedViewsResult] = await Promise.all([
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase
      .from("goals")
      .select("id, title, project_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("task_saved_views")
      .select("id, name, status, project_id, goal_id, due_filter, sort_value, updated_at")
      .order("updated_at", { ascending: false }),
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

  const tasksQuery = supabase
    .from("tasks")
    .select(
      "id, title, description, blocked_reason, status, priority, due_date, estimate_minutes, updated_at, project_id, goal_id, focus_rank, projects(name), goals(title)",
    )
    .order("updated_at", { ascending: false });

  if (filters.activeStatus) {
    tasksQuery.eq("status", filters.activeStatus);
  }

  if (activeProjectId) {
    tasksQuery.eq("project_id", activeProjectId);
  }

  if (activeGoalId) {
    tasksQuery.eq("goal_id", activeGoalId);
  }

  const tasksResult = await tasksQuery;
  let rawTasks = tasksResult.data ?? [];

  if (tasksResult.error) {
    if (!isTasksBlockedReasonMissing(tasksResult.error)) {
      throw new Error(`Failed to load tasks: ${tasksResult.error.message}`);
    }

    const fallbackQuery = supabase
      .from("tasks")
      .select(
        "id, title, description, status, priority, due_date, estimate_minutes, updated_at, project_id, goal_id, focus_rank, projects(name), goals(title)",
      )
      .order("updated_at", { ascending: false });

    if (filters.activeStatus) {
      fallbackQuery.eq("status", filters.activeStatus);
    }

    if (activeProjectId) {
      fallbackQuery.eq("project_id", activeProjectId);
    }

    if (activeGoalId) {
      fallbackQuery.eq("goal_id", activeGoalId);
    }

    const fallbackResult = await fallbackQuery;
    if (fallbackResult.error) {
      throw new Error(`Failed to load tasks: ${fallbackResult.error.message}`);
    }

    rawTasks = (fallbackResult.data ?? []).map((task) => ({
      ...task,
      blocked_reason: null,
    }));
  }

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
  let { error } = await supabase
    .from("tasks")
    .update({
      status: input.status,
      priority: input.priority,
      due_date: input.dueDate,
      estimate_minutes: input.estimateMinutes,
      blocked_reason: input.blockedReason,
      updated_at: updatedAtIso,
    })
    .eq("id", input.taskId);

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackResult = await supabase
      .from("tasks")
      .update({
        status: input.status,
        priority: input.priority,
        due_date: input.dueDate,
        estimate_minutes: input.estimateMinutes,
        updated_at: updatedAtIso,
      })
      .eq("id", input.taskId);
    error = fallbackResult.error;
  }

  if (error) {
    return { errorMessage: "Unable to update task right now." };
  }

  return { errorMessage: null };
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
      "id, title, description, blocked_reason, status, priority, due_date, estimate_minutes, updated_at, project_id, goal_id, focus_rank, projects(name), goals(title)",
    )
    .eq("id", normalizedTaskId)
    .maybeSingle();

  if (error && isTasksBlockedReasonMissing(error)) {
    const fallbackResult = await supabase
      .from("tasks")
      .select(
        "id, title, description, status, priority, due_date, estimate_minutes, updated_at, project_id, goal_id, focus_rank, projects(name), goals(title)",
      )
      .eq("id", normalizedTaskId)
      .maybeSingle();

    if (!fallbackResult.error) {
      data = fallbackResult.data
        ? {
            ...fallbackResult.data,
            blocked_reason: null,
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
