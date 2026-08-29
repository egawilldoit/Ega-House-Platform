import {
  PROJECT_ARCHIVE_STATUS,
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
