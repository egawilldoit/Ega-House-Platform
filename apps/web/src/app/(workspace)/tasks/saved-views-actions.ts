"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { GOAL_ARCHIVE_STATUS } from "@/lib/goal-archive";
import { createClient } from "@/lib/supabase/server";
import {
  getTaskSavedViewLegacyColumns,
  getTaskSavedViewDefinitionFromFilters,
  getTaskSavedViewNameError,
  normalizeTaskSavedViewFilters,
  validateTaskSavedViewScope,
  validateTaskViewScope,
} from "@/lib/task-saved-views";
import {
  parseTaskViewDefinitionJson,
  serializeTaskViewDefinition,
  TASK_VIEW_DEFINITION_MAX_CHARS,
} from "@ega/contracts/common/task-list";
import { isMissingSupabaseTable } from "@/lib/supabase-error";

const SAVED_VIEWS_UNAVAILABLE_MESSAGE =
  "Saved views are temporarily unavailable while database schema updates propagate.";

function getTasksReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  return returnTo.startsWith("/tasks") ? returnTo : "/tasks";
}

function redirectWithSavedViewFeedback(
  returnPath: string,
  message: { error?: string; success?: string },
): never {
  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.delete("viewError");
  target.searchParams.delete("viewSuccess");

  if (message.error) {
    target.searchParams.set("viewError", message.error);
  }

  if (message.success) {
    target.searchParams.set("viewSuccess", message.success);
  }

  redirect(`${target.pathname}${target.search}#saved-views`);
}

async function getVisibleTaskScope(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [projectsResult, goalsResult] = await Promise.all([
    supabase.from("projects").select("id"),
    supabase.from("goals").select("id, project_id").neq("status", GOAL_ARCHIVE_STATUS),
  ]);

  if (projectsResult.error || goalsResult.error) {
    return {
      errorMessage: "Unable to validate saved view scope right now.",
      projectIds: new Set<string>(),
      goalsById: new Map<string, { id: string; projectId: string }>(),
    };
  }

  return {
    errorMessage: null,
    projectIds: new Set((projectsResult.data ?? []).map((project) => project.id)),
    goalsById: new Map(
      (goalsResult.data ?? []).map((goal) => [
        goal.id,
        {
          id: goal.id,
          projectId: goal.project_id,
        },
      ]),
    ),
  };
}

function getSavedViewFilters(formData: FormData) {
  return normalizeTaskSavedViewFilters({
    status: String(formData.get("status") ?? ""),
    projectId: String(formData.get("project") ?? ""),
    goalId: String(formData.get("goal") ?? ""),
    dueFilter: String(formData.get("due") ?? ""),
    sortValue: String(formData.get("sort") ?? ""),
    activeTasks: String(formData.get("tasks") ?? "") === "active",
    priority: String(formData.get("priority") ?? ""),
    estimateMinMinutes: String(formData.get("estimateMin") ?? ""),
    estimateMaxMinutes: String(formData.get("estimateMax") ?? ""),
    dueWithinDays: String(formData.get("dueWithin") ?? ""),
  });
}

async function validateSavedViewWrite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
  formData: FormData,
) {
  const nameError = getTaskSavedViewNameError(name);

  if (nameError) {
    return { errorMessage: nameError, view: null };
  }

  const rawDefinition = String(formData.get("definition") ?? "").trim();
  let view = null;

  if (rawDefinition) {
    if (rawDefinition.length > TASK_VIEW_DEFINITION_MAX_CHARS) {
      return { errorMessage: "Saved view definition is too large.", view: null };
    }
    view = parseTaskViewDefinitionJson(rawDefinition);
    if (!view) {
      return { errorMessage: "Saved view definition is invalid.", view: null };
    }
  } else {
    // Compatibility path for forms posted by the pre-EGA-791 panel.
    const filters = getSavedViewFilters(formData);
    view = getTaskSavedViewDefinitionFromFilters(filters);
  }

  const scope = await getVisibleTaskScope(supabase);

  if (scope.errorMessage) {
    return { errorMessage: scope.errorMessage, view: null };
  }

  const scopeError = validateTaskViewScope(view, {
    projectIds: scope.projectIds,
    goalsById: scope.goalsById,
  });

  if (scopeError) {
    return { errorMessage: scopeError, view: null };
  }

  // Kept for callers/tests that still validate the legacy filter projection.
  const legacyScopeError = validateTaskSavedViewScope(
    normalizeTaskSavedViewFilters({
      status: getTaskSavedViewLegacyColumns(view).status,
      projectId: getTaskSavedViewLegacyColumns(view).projectId,
      goalId: getTaskSavedViewLegacyColumns(view).goalId,
      dueFilter: getTaskSavedViewLegacyColumns(view).dueFilter,
      sortValue: getTaskSavedViewLegacyColumns(view).sortValue,
    }),
    { projectIds: scope.projectIds, goalsById: scope.goalsById },
  );
  if (legacyScopeError) {
    return { errorMessage: legacyScopeError, view: null };
  }

  if (!serializeTaskViewDefinition(view) || serializeTaskViewDefinition(view).length > TASK_VIEW_DEFINITION_MAX_CHARS) {
    return { errorMessage: "Saved view definition is too large.", view: null };
  }

  return { errorMessage: null, view };
}

export async function createTaskSavedViewAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const name = String(formData.get("name") ?? "").trim();
  const supabase = await createClient();
  const validation = await validateSavedViewWrite(supabase, name, formData);

  if (validation.errorMessage || !validation.view) {
    redirectWithSavedViewFeedback(returnPath, {
      error: validation.errorMessage ?? "Unable to save the current filters right now.",
    });
  }

  const columns = getTaskSavedViewLegacyColumns(validation.view);
  const { error } = await supabase.from("task_saved_views").insert({
    name,
    status: columns.status,
    project_id: columns.projectId,
    goal_id: columns.goalId,
    due_filter: columns.dueFilter,
    sort_value: columns.sortValue,
    definition_json: validation.view,
  });

  if (error) {
    redirectWithSavedViewFeedback(returnPath, {
      error: isMissingSupabaseTable(error, "public.task_saved_views")
        ? SAVED_VIEWS_UNAVAILABLE_MESSAGE
        : error.code === "23505"
          ? "A saved view with that name already exists."
          : "Unable to save the current filters right now.",
    });
  }

  revalidatePath("/tasks");
  redirectWithSavedViewFeedback(returnPath, { success: "Saved view created." });
}

export async function updateTaskSavedViewAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const viewId = String(formData.get("viewId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!viewId) {
    redirectWithSavedViewFeedback(returnPath, { error: "Saved view update request is invalid." });
  }

  const supabase = await createClient();
  const validation = await validateSavedViewWrite(supabase, name, formData);

  if (validation.errorMessage || !validation.view) {
    redirectWithSavedViewFeedback(returnPath, {
      error: validation.errorMessage ?? "Unable to update the saved view right now.",
    });
  }

  const columns = getTaskSavedViewLegacyColumns(validation.view);
  const { error } = await supabase
    .from("task_saved_views")
    .update({
      name,
      status: columns.status,
      project_id: columns.projectId,
      goal_id: columns.goalId,
      due_filter: columns.dueFilter,
      sort_value: columns.sortValue,
      definition_json: validation.view,
      updated_at: new Date().toISOString(),
    })
    .eq("id", viewId);

  if (error) {
    redirectWithSavedViewFeedback(returnPath, {
      error: isMissingSupabaseTable(error, "public.task_saved_views")
        ? SAVED_VIEWS_UNAVAILABLE_MESSAGE
        : error.code === "23505"
          ? "A saved view with that name already exists."
          : "Unable to update the saved view right now.",
    });
  }

  revalidatePath("/tasks");
  redirectWithSavedViewFeedback(returnPath, { success: "Saved view updated." });
}

export async function deleteTaskSavedViewAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const viewId = String(formData.get("viewId") ?? "").trim();

  if (!viewId) {
    redirectWithSavedViewFeedback(returnPath, { error: "Saved view delete request is invalid." });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("task_saved_views").delete().eq("id", viewId);

  if (error) {
    redirectWithSavedViewFeedback(returnPath, {
      error: isMissingSupabaseTable(error, "public.task_saved_views")
        ? SAVED_VIEWS_UNAVAILABLE_MESSAGE
        : "Unable to delete the saved view right now.",
    });
  }

  revalidatePath("/tasks");
  redirectWithSavedViewFeedback(returnPath, { success: "Saved view deleted." });
}
