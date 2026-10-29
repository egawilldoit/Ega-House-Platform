"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createAuthenticatedActor, createProject } from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

export type CreateProjectFormState = {
  error: string | null;
  values: {
    name: string;
    slug: string;
    description: string;
    areaId: string;
  };
};

export async function createProjectAction(
  _previous: CreateProjectFormState,
  formData: FormData,
): Promise<CreateProjectFormState> {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseProjectsRepository(supabase);

  const result = await createProject(actor, repository, {
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description"),
    areaId: formData.get("areaId"),
  });

  if (!result.ok) {
    return {
      error: result.errorMessage,
      values: {
        name: result.values.name,
        slug: result.values.slug,
        description: result.values.description,
        areaId: result.values.areaId ?? "",
      },
    };
  }

  revalidatePath("/tasks/projects");
  revalidatePath("/settings/areas");
  redirect("/tasks/projects");
}
