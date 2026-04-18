"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  getTaskSavedViewNameError,
  normalizeTaskSavedViewFilters,
  validateTaskSavedViewScope,
} from "@/lib/task-saved-views";

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
    supabase.from("goals").select("id, project_id"),
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
  });
}

async function validateSavedViewWrite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
  formData: FormData,
) {
  const nameError = getTaskSavedViewNameError(name);

  if (nameError) {
    return { errorMessage: nameError, filters: null };
  }

  const filters = getSavedViewFilters(formData);
  const scope = await getVisibleTaskScope(supabase);

  if (scope.errorMessage) {
    return { errorMessage: scope.errorMessage, filters: null };
  }

  const scopeError = validateTaskSavedViewScope(filters, {
    projectIds: scope.projectIds,
    goalsById: scope.goalsById,
  });

  if (scopeError) {
    return { errorMessage: scopeError, filters: null };
  }

  return { errorMessage: null, filters };
}

export async function createTaskSavedViewAction(formData: FormData) {
  const returnPath = getTasksReturnPath(formData.get("returnTo"));
  const name = String(formData.get("name") ?? "").trim();
  const supabase = await createClient();
  const validation = await validateSavedViewWrite(supabase, name, formData);

  if (validation.errorMessage || !validation.filters) {
    redirectWithSavedViewFeedback(returnPath, {
      error: validation.errorMessage ?? "Unable to save the current filters right now.",
    });
  }

  const { error } = await supabase.from("task_saved_views").insert({
    name,
    status: validation.filters.status,
    project_id: validation.filters.projectId,
    goal_id: validation.filters.goalId,
    due_filter: validation.filters.dueFilter,
    sort_value: validation.filters.sortValue,
  });

  if (error) {
    redirectWithSavedViewFeedback(returnPath, {
      error:
        error.code === "23505"
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

  if (validation.errorMessage || !validation.filters) {
    redirectWithSavedViewFeedback(returnPath, {
      error: validation.errorMessage ?? "Unable to update the saved view right now.",
    });
  }

  const { error } = await supabase
    .from("task_saved_views")
    .update({
      name,
      status: validation.filters.status,
      project_id: validation.filters.projectId,
      goal_id: validation.filters.goalId,
      due_filter: validation.filters.dueFilter,
      sort_value: validation.filters.sortValue,
      updated_at: new Date().toISOString(),
    })
    .eq("id", viewId);

  if (error) {
    redirectWithSavedViewFeedback(returnPath, {
      error:
        error.code === "23505"
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
    redirectWithSavedViewFeedback(returnPath, { error: "Unable to delete the saved view right now." });
  }

  revalidatePath("/tasks");
  redirectWithSavedViewFeedback(returnPath, { success: "Saved view deleted." });
}
