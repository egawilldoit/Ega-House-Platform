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
import { isMissingSupabaseTable } from "@/lib/supabase-error";

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
};

export type ValidatedTaskInlineUpdateInput = {
  taskId: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
};

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
      "id, title, description, status, priority, due_date, estimate_minutes, updated_at, project_id, goal_id, focus_rank, projects(name), goals(title)",
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

  if (tasksResult.error) {
    throw new Error(`Failed to load tasks: ${tasksResult.error.message}`);
  }

  const tasks = applyTaskListQuery(tasksResult.data ?? [], {
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
    const scopeError = getTaskInsertScopeError(row, taskScope.scope);
    if (scopeError) {
      return { errorMessage: scopeError };
    }
  }

  const { data, error } = await supabase.from("tasks").insert(taskRows).select("id");

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

  return {
    errorMessage: null,
    data: {
      taskId,
      status,
      priority,
      dueDate: dueDateResult.value,
      estimateMinutes: estimateResult.value,
    } satisfies ValidatedTaskInlineUpdateInput,
  };
}

export async function updateTaskInline(
  input: ValidatedTaskInlineUpdateInput,
  options?: { supabase?: SupabaseServerClient; updatedAtIso?: string },
) {
  const supabase = await resolveSupabaseClient(options?.supabase);
  const updatedAtIso = options?.updatedAtIso ?? new Date().toISOString();
  const { error } = await supabase
    .from("tasks")
    .update({
      status: input.status,
      priority: input.priority,
      due_date: input.dueDate,
      estimate_minutes: input.estimateMinutes,
      updated_at: updatedAtIso,
    })
    .eq("id", input.taskId);

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

  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, title, description, status, priority, due_date, estimate_minutes, updated_at, project_id, goal_id, focus_rank, projects(name), goals(title)",
    )
    .eq("id", normalizedTaskId)
    .maybeSingle();

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
