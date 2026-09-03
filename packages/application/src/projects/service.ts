import {
  PROJECT_ARCHIVE_STATUS,
  isProjectArchivedStatus,
  isProjectStatus,
  type ProjectStatus,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { ProjectsRepository } from "./ports";

export type ProjectFormValues = {
  name: string;
  slug: string;
  description: string;
};

export type CreateProjectResult =
  | Readonly<{ ok: true; data: null; values: ProjectFormValues }>
  | Readonly<{ ok: false; errorMessage: string; values: ProjectFormValues }>;

export function normalizeProjectSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createProject(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: {
    name: unknown;
    slug: unknown;
    description: unknown;
    mcpOperationId?: string;
    mcpClientId?: string;
  },
): Promise<CreateProjectResult> {
  const name = String(input.name ?? "").trim();
  const slug = normalizeProjectSlug(String(input.slug ?? ""));
  const description = String(input.description ?? "").trim();
  const values = { name, slug, description };

  if (!name) return { ok: false, errorMessage: "Project name is required.", values };
  if (!slug) return { ok: false, errorMessage: "Slug is required.", values };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return {
      ok: false,
      errorMessage: "Slug can only contain lowercase letters, numbers, and hyphens.",
      values,
    };
  }

  const createInput = {
    name,
    slug,
    description: description || null,
    ...(input.mcpOperationId && input.mcpClientId
      ? { mcpOperationId: input.mcpOperationId, mcpClientId: input.mcpClientId }
      : {}),
  };
  const result = await repository.createProject(actor, createInput);

  if (!result.ok) {
    return {
      ok: false,
      errorMessage:
        result.error.code === "conflict"
          ? "That slug is already in use. Choose a different slug."
          : "Unable to create project right now. Please try again.",
      values,
    };
  }

  return { ok: true, data: null, values };
}

export async function updateProjectStatus(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; status: unknown; now?: Date },
): Promise<ApplicationResult<null>> {
  const projectId = String(input.projectId ?? "").trim();
  const status = String(input.status ?? "").trim();

  if (!projectId || !isProjectStatus(status)) {
    return applicationFailure("Project update request is invalid.");
  }

  const result = await repository.updateProjectStatus(actor, {
    projectId,
    status,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  return result.ok
    ? applicationSuccess(null)
    : applicationFailure("Unable to update project right now.");
}

async function setProjectArchiveState(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; status: ProjectStatus; now?: Date },
) {
  const projectId = String(input.projectId ?? "").trim();
  if (!projectId) return applicationFailure("Project update request is invalid.");

  const result = await repository.updateProjectStatus(actor, {
    projectId,
    status: input.status,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  return result.ok
    ? applicationSuccess(null)
    : applicationFailure("Unable to update project right now.");
}

export function archiveProject(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; now?: Date },
) {
  return setProjectArchiveState(actor, repository, {
    ...input,
    status: PROJECT_ARCHIVE_STATUS,
  });
}

export function unarchiveProject(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; now?: Date },
) {
  return setProjectArchiveState(actor, repository, {
    ...input,
    status: "active",
  });
}

function dependencyErrorMessage(taskCount: number, goalCount: number) {
  if (taskCount > 0 && goalCount > 0) {
    return "This project still has linked tasks and goals. Move or remove them before permanently deleting the project.";
  }

  if (taskCount > 0) {
    return "This project still has linked tasks. Move or remove them before permanently deleting the project.";
  }

  return "This project still has linked goals. Move or remove them before permanently deleting the project.";
}

/**
 * Permanently delete a project that is already archived and has no linked
 * tasks or goals. This is the only business-rule owner for project deletion:
 * transports call it, the repository only performs the guarded persistence
 * write. A Postgres 23503 race (dependency inserted after the pre-check) maps
 * to the same dependency conflict, never to a raw database error.
 */
export async function deleteArchivedProject(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown },
): Promise<ApplicationResult<null>> {
  const projectId = String(input.projectId ?? "").trim();

  if (!projectId) {
    return applicationFailure("Project delete request is invalid.", "validation");
  }

  const projectResult = await repository.getProjectById(actor, projectId);

  if (!projectResult.ok) {
    return applicationFailure("Unable to load project right now.", "unknown");
  }

  if (!projectResult.value) {
    return applicationFailure("Project not found.", "notFound");
  }

  if (!isProjectArchivedStatus(projectResult.value.status)) {
    return applicationFailure("Only archived projects can be permanently deleted.", "validation");
  }

  const [tasksResult, goalsResult] = await Promise.all([
    repository.listTasksForProjects(actor, [projectId]),
    repository.listGoalsForProject(actor, projectId),
  ]);

  if (!tasksResult.ok || !goalsResult.ok) {
    return applicationFailure("Unable to verify linked records right now.", "unknown");
  }

  const taskCount = tasksResult.value.length;
  const goalCount = goalsResult.value.length;

  if (taskCount > 0 || goalCount > 0) {
    return applicationFailure(dependencyErrorMessage(taskCount, goalCount), "conflict");
  }

  const deleteResult = await repository.deleteArchivedProject(actor, { projectId });

  if (!deleteResult.ok) {
    if (deleteResult.error.code === "conflict") {
      return applicationFailure(
        "This project still has linked tasks or goals. Move or remove them before permanently deleting the project.",
        "conflict",
      );
    }

    return applicationFailure("Unable to delete project right now.", "unknown");
  }

  if (!deleteResult.value.deleted) {
    return applicationFailure("Unable to delete project right now.", "unknown");
  }

  return applicationSuccess(null);
}
