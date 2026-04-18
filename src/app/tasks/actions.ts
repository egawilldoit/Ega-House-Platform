"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/supabase/database.types";
import {
  TASK_PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  isTaskPriority,
  isTaskStatus,
} from "@/lib/task-domain";

export type CreateTaskFormState = {
  error: string | null;
  success?: string | null;
  values: {
    title: string;
    projectId: string;
    goalId: string;
    description: string;
    status: string;
    priority: string;
    returnTo: string;
  };
};

export type CreateTasksBulkFormState = {
  error: string | null;
  success: string | null;
  createdCount: number;
  skippedLines: Array<{ value: string; reason: string }>;
  values: {
    titles: string;
    projectId: string;
    goalId: string;
    description: string;
    status: string;
    priority: string;
    returnTo: string;
  };
};

type BulkTaskComposerRowInput = {
  lineNumber?: number;
  title?: string;
  projectId?: string;
  goalId?: string;
  description?: string;
  status?: string;
  priority?: string;
};

function createErrorState(
  error: string,
  values: CreateTaskFormState["values"],
): CreateTaskFormState {
  return { error, success: null, values };
}

function createBulkErrorState(
  error: string,
  values: CreateTasksBulkFormState["values"],
  skippedLines: CreateTasksBulkFormState["skippedLines"] = [],
): CreateTasksBulkFormState {
  return {
    error,
    success: null,
    createdCount: 0,
    skippedLines,
    values,
  };
}

function getTasksReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  return returnTo.startsWith("/tasks") ? returnTo : "/tasks";
}

function getTasksPathname(returnPath: string) {
  return new URL(returnPath, "https://egawilldoit.online").pathname;
}

function revalidateTaskSurfaces(returnTo: string) {
  revalidatePath("/tasks");
  revalidatePath("/tasks/projects");
  revalidatePath(getTasksPathname(returnTo));
  revalidatePath("/timer");
}

function redirectWithTasksError(
  returnPath: string,
  errorMessage: string,
  taskId?: string,
) {
  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("taskUpdateError", errorMessage);

  if (taskId) {
    target.searchParams.set("taskUpdateTaskId", taskId);
  }

  redirect(`${target.pathname}${target.search}${taskId ? `#task-${taskId}` : ""}`);
}

async function getVisibleTaskScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const [projectsResult, goalsResult] = await Promise.all([
    supabase.from("projects").select("id"),
    supabase.from("goals").select("id, project_id"),
  ]);

  if (projectsResult.error || goalsResult.error) {
    return {
      errorMessage: "Unable to validate task scope right now.",
      projectIds: new Set<string>(),
      goalsById: new Map<string, { id: string; project_id: string }>(),
    };
  }

  return {
    errorMessage: null,
    projectIds: new Set((projectsResult.data ?? []).map((project) => project.id)),
    goalsById: new Map(
      (goalsResult.data ?? []).map((goal) => [goal.id, goal]),
    ),
  };
}

function getTaskRowScopeError(
  row: TablesInsert<"tasks">,
  projectIds: Set<string>,
  goalsById: Map<string, { id: string; project_id: string }>,
) {
  if (!projectIds.has(row.project_id)) {
    return "Selected project is unavailable.";
  }

  if (!row.goal_id) {
    return null;
  }

  const goal = goalsById.get(row.goal_id);

  if (!goal) {
    return "Selected goal is unavailable.";
  }

  if (goal.project_id !== row.project_id) {
    return "Selected goal does not belong to the chosen project.";
  }

  return null;
}

async function insertTasks(taskRows: TablesInsert<"tasks">[]) {
  const supabase = await createClient();

  if (taskRows.length === 0) {
    return { errorMessage: "No tasks were provided." };
  }

  const taskScope = await getVisibleTaskScope(supabase);

  if (taskScope.errorMessage) {
    return { errorMessage: taskScope.errorMessage };
  }

  for (const row of taskRows) {
    const scopeError = getTaskRowScopeError(
      row,
      taskScope.projectIds,
      taskScope.goalsById,
    );

    if (scopeError) {
      return { errorMessage: scopeError };
    }
  }

  const { error } = await supabase.from("tasks").insert(taskRows);

  if (error) {
    return { errorMessage: "Unable to create task right now." };
  }

  return { errorMessage: null };
}

function parseBulkRowsPayload(rawRows: string): BulkTaskComposerRowInput[] {
  if (!rawRows.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawRows);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toTaskInsertRow(row: BulkTaskComposerRowInput) {
  return {
    title: String(row.title ?? "").trim(),
    project_id: String(row.projectId ?? "").trim(),
    goal_id: String(row.goalId ?? "").trim() || null,
    description: String(row.description ?? "").trim() || null,
    status: String(row.status ?? "").trim(),
    priority: String(row.priority ?? "").trim(),
  } satisfies TablesInsert<"tasks">;
}

export async function createTaskAction(
  _previous: CreateTaskFormState,
  formData: FormData,
): Promise<CreateTaskFormState> {
  const title = String(formData.get("title") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const goalId = String(formData.get("goalId") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const status = String(formData.get("status") ?? "todo").trim();
  const priority = String(formData.get("priority") ?? "medium").trim();
  const returnTo = getTasksReturnPath(formData.get("returnTo"));

  const values = {
    title,
    projectId,
    goalId,
    description,
    status,
    priority,
    returnTo,
  };

  if (!title) {
    return createErrorState("Task title is required.", values);
  }

  if (!projectId) {
    return createErrorState("Project is required.", values);
  }

  if (!isTaskStatus(status)) {
    return createErrorState(
      `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.`,
      values,
    );
  }

  if (!isTaskPriority(priority)) {
    return createErrorState(
      `Priority must be one of: ${TASK_PRIORITY_VALUES.join(", ")}.`,
      values,
    );
  }

  const { errorMessage } = await insertTasks([{
    title,
    project_id: projectId,
    goal_id: goalId || null,
    description: description || null,
    status,
    priority,
  }]);

  if (errorMessage) {
    return createErrorState(errorMessage, values);
  }

  revalidateTaskSurfaces(returnTo);

  return {
    error: null,
    success: "Task created.",
    values: {
      title: "",
      projectId,
      goalId: "",
      description: "",
      status: "todo",
      priority: "medium",
      returnTo,
    },
  };
}

export async function createTasksBulkAction(
  _previous: CreateTasksBulkFormState,
  formData: FormData,
): Promise<CreateTasksBulkFormState> {
  const titles = String(formData.get("titles") ?? "");
  const rows = parseBulkRowsPayload(String(formData.get("rows") ?? ""));
  const returnTo = getTasksReturnPath(formData.get("returnTo"));

  const values = {
    titles,
    projectId: "",
    goalId: "",
    description: "",
    status: "todo",
    priority: "medium",
    returnTo,
  };

  if (rows.length === 0) {
    return createBulkErrorState("Add at least one task card before creating tasks.", values);
  }

  const supabase = await createClient();
  const taskScope = await getVisibleTaskScope(supabase);

  if (taskScope.errorMessage) {
    return createBulkErrorState(taskScope.errorMessage, values);
  }

  const validRows: TablesInsert<"tasks">[] = [];
  const skippedLines: Array<{ value: string; reason: string }> = [];

  for (const row of rows) {
    const lineLabel = row.lineNumber ? `Line ${row.lineNumber}` : "Row";
    const taskRow = toTaskInsertRow(row);

    if (!taskRow.title) {
      skippedLines.push({ value: lineLabel, reason: "Task title is required." });
      continue;
    }

    if (!taskRow.project_id) {
      skippedLines.push({ value: taskRow.title, reason: "Project is required." });
      continue;
    }

    if (!isTaskStatus(taskRow.status)) {
      skippedLines.push({
        value: taskRow.title,
        reason: `Status must be one of: ${TASK_STATUS_VALUES.join(", ")}.`,
      });
      continue;
    }

    if (!isTaskPriority(taskRow.priority)) {
      skippedLines.push({
        value: taskRow.title,
        reason: `Priority must be one of: ${TASK_PRIORITY_VALUES.join(", ")}.`,
      });
      continue;
    }

    const scopeError = getTaskRowScopeError(
      taskRow,
      taskScope.projectIds,
      taskScope.goalsById,
    );

    if (scopeError) {
      skippedLines.push({ value: taskRow.title, reason: scopeError });
      continue;
    }

    validRows.push(taskRow);
  }

  if (validRows.length === 0) {
    return createBulkErrorState(
      "No valid task rows are ready to create.",
      values,
      skippedLines,
    );
  }

  const { error } = await supabase.from("tasks").insert(validRows);

  if (error) {
    return createBulkErrorState("Unable to create task right now.", values, skippedLines);
  }

  revalidateTaskSurfaces(returnTo);

  return {
    error: null,
    success: `${validRows.length} task${validRows.length === 1 ? "" : "s"} created.`,
    createdCount: validRows.length,
    skippedLines,
    values: {
      titles: "",
      projectId: "",
      goalId: "",
      description: "",
      status: "todo",
      priority: "medium",
      returnTo,
    },
  };
}

export async function updateTaskInlineAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const taskId = String(formData.get("taskId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const priority = String(formData.get("priority") ?? "").trim();

  if (!taskId || !isTaskStatus(status) || !isTaskPriority(priority)) {
    redirectWithTasksError(returnPath, "Task update request is invalid.", taskId);
  }

  const updatedAt = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      status,
      priority,
      updated_at: updatedAt,
    })
    .eq("id", taskId);

  if (error) {
    redirectWithTasksError(returnPath, "Unable to update task right now.", taskId);
  }

  revalidateTaskSurfaces(returnPath);
  redirect(`${returnPath}#task-${taskId}`);
}
