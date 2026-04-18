"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { toGoalHealthWriteValue } from "@/lib/goal-health";
import { toGoalNextStepWriteValue } from "@/lib/goal-next-step";
import { createClient } from "@/lib/supabase/server";
import { GOAL_STATUS_VALUES, isGoalStatus } from "@/lib/task-domain";

export type CreateGoalFormState = {
  error: string | null;
  values: {
    title: string;
    projectId: string;
    description: string;
    nextStep: string;
    health: string;
    status: string;
    slug: string;
  };
};

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function createErrorState(
  message: string,
  values: CreateGoalFormState["values"],
): CreateGoalFormState {
  return { error: message, values };
}

function getGoalsReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  return returnTo.startsWith("/goals") ? returnTo : "/goals";
}

function redirectWithGoalsError(
  returnPath: string,
  errorMessage: string,
  goalId?: string,
  field?: "status" | "health" | "next_step",
): never {
  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("goalUpdateError", errorMessage);

  if (goalId) {
    target.searchParams.set("goalUpdateGoalId", goalId);
  }
  if (field) {
    target.searchParams.set("goalUpdateField", field);
  }

  redirect(`${target.pathname}${target.search}${goalId ? `#goal-${goalId}` : ""}`);
}

export async function createGoalAction(
  _previous: CreateGoalFormState,
  formData: FormData,
): Promise<CreateGoalFormState> {
  const title = String(formData.get("title") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const nextStepResult = toGoalNextStepWriteValue(formData);
  const goalHealthResult = toGoalHealthWriteValue(formData);
  const status = String(formData.get("status") ?? "draft").trim();
  const rawSlug = String(formData.get("slug") ?? "");
  const slug = normalizeSlug(rawSlug);

  const values = {
    title,
    projectId,
    description,
    nextStep: nextStepResult.value ?? "",
    health: goalHealthResult.value ?? "",
    status,
    slug,
  };

  if (!title) {
    return createErrorState("Goal title is required.", values);
  }

  if (!projectId) {
    return createErrorState("Project is required.", values);
  }

  if (!status) {
    return createErrorState("Status is required.", values);
  }

  if (!isGoalStatus(status)) {
    return createErrorState(
      `Status must be one of: ${GOAL_STATUS_VALUES.join(", ")}.`,
      values,
    );
  }

  if (nextStepResult.error) {
    return createErrorState(nextStepResult.error, values);
  }

  if (goalHealthResult.error) {
    return createErrorState(goalHealthResult.error, values);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("goals").insert({
    title,
    project_id: projectId,
    description: description || null,
    next_step: nextStepResult.value,
    health: goalHealthResult.value,
    status,
    slug: slug || null,
  });

  if (error) {
    return createErrorState("Unable to create goal right now.", values);
  }

  revalidatePath("/goals");

  return {
    error: null,
    values: {
      title: "",
      projectId,
      description: "",
      nextStep: "",
      health: "",
      status,
      slug: "",
    },
  };
}

export async function updateGoalStatusAction(formData: FormData) {
  const returnPath = getGoalsReturnPath(formData.get("returnTo"));
  const goalId = String(formData.get("goalId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  if (!goalId || !isGoalStatus(status)) {
    redirectWithGoalsError(returnPath, "Goal update request is invalid.", goalId, "status");
  }

  const updatedAt = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update({
      status,
      updated_at: updatedAt,
    })
    .eq("id", goalId);

  if (error) {
    redirectWithGoalsError(returnPath, "Unable to update goal right now.", goalId, "status");
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");
  revalidatePath("/tasks/projects");
  redirect(`${returnPath}#goal-${goalId}`);
}

export async function updateGoalHealthAction(formData: FormData) {
  const returnPath = getGoalsReturnPath(formData.get("returnTo"));
  const goalId = String(formData.get("goalId") ?? "").trim();
  const goalHealthResult = toGoalHealthWriteValue(formData);

  if (!goalId) {
    redirectWithGoalsError(returnPath, "Goal update request is invalid.", goalId, "health");
  }

  if (goalHealthResult.error) {
    redirectWithGoalsError(returnPath, goalHealthResult.error, goalId, "health");
  }

  const updatedAt = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update({
      health: goalHealthResult.value,
      updated_at: updatedAt,
    })
    .eq("id", goalId);

  if (error) {
    redirectWithGoalsError(returnPath, "Unable to update goal right now.", goalId, "health");
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");
  redirect(`${returnPath}#goal-${goalId}`);
}

export async function updateGoalNextStepAction(formData: FormData) {
  const returnPath = getGoalsReturnPath(formData.get("returnTo"));
  const goalId = String(formData.get("goalId") ?? "").trim();
  const nextStepResult = toGoalNextStepWriteValue(formData);

  if (!goalId) {
    redirectWithGoalsError(returnPath, "Goal update request is invalid.", goalId, "next_step");
  }

  if (nextStepResult.error) {
    redirectWithGoalsError(returnPath, nextStepResult.error, goalId, "next_step");
  }

  const updatedAt = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .update({
      next_step: nextStepResult.value,
      updated_at: updatedAt,
    })
    .eq("id", goalId);

  if (error) {
    redirectWithGoalsError(returnPath, "Unable to update goal right now.", goalId, "next_step");
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");
  redirect(`${returnPath}#goal-${goalId}`);
}
