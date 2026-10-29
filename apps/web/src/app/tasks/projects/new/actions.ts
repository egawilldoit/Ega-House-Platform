"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createAuthenticatedActor,
  createProject,
  createProjectFromTemplate,
  isProjectTemplateId,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { getRequestTimeContextRepository } from "@/lib/request-time-context";
import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";
import { revalidateWorkspaceFor } from "@/lib/workspace/workspace-navigation";

export type CreateProjectFormState = {
  error: string | null;
  values: {
    name: string;
    slug: string;
    description: string;
    areaId: string;
    templateId: string;
  };
};

function readTemplateId(value: FormDataEntryValue | null) {
  const templateId = String(value ?? "blank").trim();
  return isProjectTemplateId(templateId) ? templateId : "blank";
}

export async function createProjectAction(
  _previous: CreateProjectFormState,
  formData: FormData,
): Promise<CreateProjectFormState> {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });
  const actor = createAuthenticatedActor(user.id);
  const repository = new SupabaseProjectsRepository(supabase);
  const templateId = readTemplateId(formData.get("templateId"));

  const input = {
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description"),
    areaId: formData.get("areaId"),
  };

  if (templateId === "blank") {
    // Blank keeps the established project-create path: no goals/tasks and no
    // template operation receipt to maintain.
    const result = await createProject(actor, repository, input);

    if (!result.ok) {
      return {
        error: result.errorMessage,
        values: {
          name: result.values.name,
          slug: result.values.slug,
          description: result.values.description,
          areaId: result.values.areaId ?? "",
          templateId,
        },
      };
    }

    revalidatePath("/tasks/projects");
    revalidatePath("/settings/areas");
    redirect("/tasks/projects");
  }

  const result = await createProjectFromTemplate(
    actor,
    repository,
    await getRequestTimeContextRepository(),
    {
      templateId,
      operationId: formData.get("operationId"),
      ...input,
    },
  );

  if (!result.ok) {
    return {
      error: result.errorMessage,
      values: {
        name: result.values.name,
        slug: result.values.slug,
        description: result.values.description,
        areaId: result.values.areaId ?? "",
        templateId,
      },
    };
  }

  const projectPath = `/tasks/projects/${result.data.slug}`;
  revalidateWorkspaceFor("task", { returnTo: projectPath });
  revalidatePath("/goals");
  revalidatePath("/settings/areas");
  redirect(projectPath);
}
