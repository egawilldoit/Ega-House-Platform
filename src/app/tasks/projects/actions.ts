"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  archiveProject,
  createAuthenticatedActor,
  unarchiveProject,
  updateProjectStatus,
  type AuthenticatedActor,
} from "@ega/application";
import { SupabaseProjectsRepository } from "@ega/data-access";

import { requireAuthenticatedUser } from "@/lib/services/auth-service";
import { createClient } from "@/lib/supabase/server";

function getProjectsReturnPath(rawReturnTo: unknown) {
  const returnTo = String(rawReturnTo ?? "").trim();
  return returnTo.startsWith("/tasks/projects") ? returnTo : "/tasks/projects";
}

function getProjectsPathname(returnPath: string) {
  return new URL(returnPath, "https://egawilldoit.online").pathname;
}

function redirectWithProjectsError(
  returnPath: string,
  errorMessage: string,
  projectId?: string,
  field?: "status" | "archive",
): never {
  const target = new URL(returnPath, "https://egawilldoit.online");
  target.searchParams.set("projectUpdateError", errorMessage);

  if (projectId) {
    target.searchParams.set("projectUpdateProjectId", projectId);
  }

  if (field) {
    target.searchParams.set("projectUpdateField", field);
  }

  redirect(
    `${target.pathname}${target.search}${projectId ? `#project-${projectId}` : ""}`,
  );
}

async function resolveProjectContext(): Promise<{
  actor: AuthenticatedActor;
  repository: SupabaseProjectsRepository;
}> {
  const supabase = await createClient();
  const user = await requireAuthenticatedUser({ supabase });

  return {
    actor: createAuthenticatedActor(user.id),
    repository: new SupabaseProjectsRepository(supabase),
  };
}

export async function updateProjectStatusAction(formData: FormData) {
  const returnPath = getProjectsReturnPath(formData.get("returnTo"));
  const projectId = String(formData.get("projectId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();

  const { actor, repository } = await resolveProjectContext();
  const result = await updateProjectStatus(actor, repository, { projectId, status });

  if (!result.ok) {
    redirectWithProjectsError(
      returnPath,
      result.errorMessage,
      projectId,
      "status",
    );
  }

  const returnPathname = getProjectsPathname(returnPath);

  revalidatePath("/tasks/projects");
  revalidatePath(returnPathname);
  revalidatePath("/tasks");
  revalidatePath("/goals");
  redirect(`${returnPath}#project-${projectId}`);
}

async function updateProjectArchiveState(formData: FormData, status: "archived" | "active") {
  const returnPath = getProjectsReturnPath(formData.get("returnTo"));
  const projectId = String(formData.get("projectId") ?? "").trim();

  const { actor, repository } = await resolveProjectContext();
  const result =
    status === "archived"
      ? await archiveProject(actor, repository, { projectId })
      : await unarchiveProject(actor, repository, { projectId });

  if (!result.ok) {
    redirectWithProjectsError(
      returnPath,
      result.errorMessage,
      projectId,
      "archive",
    );
  }

  const returnPathname = getProjectsPathname(returnPath);

  revalidatePath("/tasks/projects");
  revalidatePath(returnPathname);
  revalidatePath("/tasks");
  revalidatePath("/goals");
  redirect(`${returnPath}#project-${projectId}`);
}

export async function archiveProjectAction(formData: FormData) {
  await updateProjectArchiveState(formData, "archived");
}

export async function unarchiveProjectAction(formData: FormData) {
  await updateProjectArchiveState(formData, "active");
}
