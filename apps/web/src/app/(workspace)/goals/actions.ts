"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  archiveGoal,
  createAuthenticatedActor,
  createGoal,
  unarchiveGoal,
  updateGoalHealth,
  updateGoalNextStep,
  updateGoalStatus,
} from "@ega/application";
import { SupabaseGoalsRepository } from "@ega/data-access";

import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

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
  field?: "status" | "health" | "next_step" | "archive",
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

async function resolveGoalContext() {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });

  return {
    actor: createAuthenticatedActor(user.id),
    repository: new SupabaseGoalsRepository(supabase),
  };
}

export async function createGoalAction(
  _previous: CreateGoalFormState,
  formData: FormData,
): Promise<CreateGoalFormState> {
  const { actor, repository } = await resolveGoalContext();

  const result = await createGoal(actor, repository, {
    title: formData.get("title"),
    projectId: formData.get("projectId"),
    description: formData.get("description"),
    nextStep: formData.get("next_step") ?? formData.get("nextStep"),
    health: formData.get("health") ?? formData.get("goal_health"),
    status: formData.get("status"),
    slug: formData.get("slug"),
  });

  const values = {
    title: result.values.title,
    projectId: result.values.projectId,
    description: result.values.description,
    nextStep: result.values.nextStep,
    health: result.values.health,
    status: result.values.status,
    slug: result.values.slug,
  };

  if (!result.ok) {
    return createErrorState(result.errorMessage, values);
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");

  return {
    error: null,
    values: {
      title: "",
      projectId: values.projectId,
      description: "",
      nextStep: "",
      health: "",
      status: values.status,
      slug: "",
    },
  };
}

export async function updateGoalStatusAction(formData: FormData) {
  const returnPath = getGoalsReturnPath(formData.get("returnTo"));
  const goalId = String(formData.get("goalId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  const { actor, repository } = await resolveGoalContext();
  const result = await updateGoalStatus(actor, repository, { goalId, status });

  if (!result.ok) {
    redirectWithGoalsError(returnPath, result.errorMessage, goalId, "status");
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");
  revalidatePath("/tasks/projects");
  redirect(`${returnPath}#goal-${goalId}`);
}

export async function updateGoalHealthAction(formData: FormData) {
  const returnPath = getGoalsReturnPath(formData.get("returnTo"));
  const goalId = String(formData.get("goalId") ?? "").trim();

  const { actor, repository } = await resolveGoalContext();
  const result = await updateGoalHealth(actor, repository, {
    goalId,
    health: formData.get("health") ?? formData.get("goal_health"),
  });

  if (!result.ok) {
    redirectWithGoalsError(returnPath, result.errorMessage, goalId, "health");
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");
  redirect(`${returnPath}#goal-${goalId}`);
}

export async function updateGoalNextStepAction(formData: FormData) {
  const returnPath = getGoalsReturnPath(formData.get("returnTo"));
  const goalId = String(formData.get("goalId") ?? "").trim();

  const { actor, repository } = await resolveGoalContext();
  const result = await updateGoalNextStep(actor, repository, {
    goalId,
    nextStep: formData.get("next_step") ?? formData.get("nextStep"),
  });

  if (!result.ok) {
    redirectWithGoalsError(returnPath, result.errorMessage, goalId, "next_step");
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");
  redirect(`${returnPath}#goal-${goalId}`);
}

async function updateGoalArchiveState(formData: FormData, status: "archived" | "active") {
  const returnPath = getGoalsReturnPath(formData.get("returnTo"));
  const goalId = String(formData.get("goalId") ?? "").trim();

  const { actor, repository } = await resolveGoalContext();
  const result =
    status === "archived"
      ? await archiveGoal(actor, repository, { goalId })
      : await unarchiveGoal(actor, repository, { goalId });

  if (!result.ok) {
    redirectWithGoalsError(returnPath, result.errorMessage, goalId, "archive");
  }

  revalidatePath("/goals");
  revalidatePath("/dashboard");
  revalidatePath("/tasks");
  revalidatePath("/tasks/projects");
  redirect(`${returnPath}#goal-${goalId}`);
}

export async function archiveGoalAction(formData: FormData) {
  await updateGoalArchiveState(formData, "archived");
}

export async function unarchiveGoalAction(formData: FormData) {
  await updateGoalArchiveState(formData, "active");
}
