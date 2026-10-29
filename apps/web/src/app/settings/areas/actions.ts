"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createArea,
  createAuthenticatedActor,
  deleteArea,
  updateArea,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";
import type { AreaFormValues } from "@ega/domain";

import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

export type AreaFormState = {
  error: string | null;
  values: AreaFormValues;
};

async function resolveAreaContext() {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });

  return {
    actor: createAuthenticatedActor(user.id),
    repository: new SupabaseProjectsRepository(supabase),
  };
}

function revalidateAreaSurfaces() {
  revalidatePath("/settings/areas");
  revalidatePath("/tasks/projects");
  revalidatePath("/tasks");
  revalidatePath("/work-analytics");
}

function redirectWithFeedback(type: "success" | "error", message: string): never {
  redirect(`/settings/areas?${new URLSearchParams({ [type]: message }).toString()}`);
}

export async function createAreaAction(
  _previous: AreaFormState,
  formData: FormData,
): Promise<AreaFormState> {
  const { actor, repository } = await resolveAreaContext();
  const result = await createArea(actor, repository, {
    name: formData.get("name"),
    icon: formData.get("icon"),
    color: formData.get("color"),
    description: formData.get("description"),
  });

  if (!result.ok) {
    return { error: result.errorMessage, values: result.values };
  }

  revalidateAreaSurfaces();
  redirectWithFeedback("success", `${result.area.name} added.`);
}

export async function updateAreaAction(
  previous: AreaFormState,
  formData: FormData,
): Promise<AreaFormState> {
  const { actor, repository } = await resolveAreaContext();
  const result = await updateArea(actor, repository, {
    areaId: formData.get("areaId"),
    name: formData.get("name"),
    icon: formData.get("icon"),
    color: formData.get("color"),
    description: formData.get("description"),
  });

  if (!result.ok) {
    return { error: result.errorMessage, values: result.values ?? previous.values };
  }

  revalidateAreaSurfaces();
  redirectWithFeedback("success", `${result.area.name} updated.`);
}

export async function deleteAreaAction(formData: FormData) {
  const { actor, repository } = await resolveAreaContext();
  const result = await deleteArea(actor, repository, {
    areaId: formData.get("areaId"),
  });

  if (!result.ok) {
    revalidatePath("/settings/areas");
    redirectWithFeedback("error", result.errorMessage);
  }

  revalidateAreaSurfaces();
  redirectWithFeedback(
    "success",
    "Area deleted. Its projects are now unassigned; no projects or tasks were deleted.",
  );
}
