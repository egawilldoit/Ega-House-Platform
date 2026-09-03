import {
  PROJECT_ARCHIVE_STATUS,
  isProjectArchivedStatus,
  isProjectStatus,
  type ProjectStatus,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { ProjectPurgePreview, ProjectsRepository } from "./ports";

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

/**
 * Project ids are Postgres uuids. Reject malformed values before any
 * persistence call so a destructive endpoint never sends attacker-shaped
 * input to the database (which would surface as a generic internal failure).
 * The shape is intentionally version-agnostic to mirror the uuid type.
 */
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
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

export type ProjectPurgeSummary = {
  tasksDeleted: number;
  goalsDeleted: number;
  sessionsDeleted: number;
  externalRefsDeleted: number;
  notificationsDeleted: number;
  calendarDeleteJobsEnqueued: number;
};

function parseProjectId(value: unknown): string | null {
  const projectId = String(value ?? "").trim();
  return projectId && PROJECT_ID_PATTERN.test(projectId) ? projectId : null;
}

function parseExpectedCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Read the exact deletion impact for an archived project. The counts feed the
 * confirmation screen and become the expected counts of the purge call; the
 * database recomputes them inside the purge transaction.
 */
export async function getProjectPurgePreview(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown },
): Promise<ApplicationResult<ProjectPurgePreview>> {
  const projectId = parseProjectId(input.projectId);

  if (!projectId) {
    return applicationFailure("Project purge preview request is invalid.", "validation");
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

  const previewResult = await repository.getProjectPurgePreview(actor, projectId);

  if (!previewResult.ok) {
    return applicationFailure("Unable to load deletion impact right now.", "unknown");
  }

  if (!previewResult.value) {
    return applicationFailure("Project not found.", "notFound");
  }

  return applicationSuccess(previewResult.value);
}

/**
 * Atomically purge an archived project and its project-owned work data. The
 * application owns every product rule (archived-only, exact-name
 * confirmation, sane expected counts); the database RPC owns atomicity and
 * re-enforces each invariant inside its own transaction.
 */
export async function purgeArchivedProject(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: {
    projectId: unknown;
    confirmationName: unknown;
    expectedTaskCount: unknown;
    expectedGoalCount: unknown;
  },
): Promise<ApplicationResult<ProjectPurgeSummary>> {
  const projectId = parseProjectId(input.projectId);
  const confirmationName = String(input.confirmationName ?? "").trim();
  const expectedTaskCount = parseExpectedCount(input.expectedTaskCount);
  const expectedGoalCount = parseExpectedCount(input.expectedGoalCount);

  if (!projectId || !confirmationName || expectedTaskCount === null || expectedGoalCount === null) {
    return applicationFailure("Project purge request is invalid.", "validation");
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

  if (confirmationName !== projectResult.value.name) {
    return applicationFailure("Project name confirmation does not match.", "validation");
  }

  const purgeResult = await repository.purgeArchivedProject(actor, {
    projectId,
    confirmationName,
    expectedTaskCount,
    expectedGoalCount,
  });

  if (!purgeResult.ok) {
    return applicationFailure("Unable to purge project right now.", "unknown");
  }

  switch (purgeResult.value.status) {
    case "purged":
      return applicationSuccess({
        tasksDeleted: purgeResult.value.tasksDeleted,
        goalsDeleted: purgeResult.value.goalsDeleted,
        sessionsDeleted: purgeResult.value.sessionsDeleted,
        externalRefsDeleted: purgeResult.value.externalRefsDeleted,
        notificationsDeleted: purgeResult.value.notificationsDeleted,
        calendarDeleteJobsEnqueued: purgeResult.value.calendarDeleteJobsEnqueued,
      });
    case "not_found":
      return applicationFailure("Project not found.", "notFound");
    case "not_archived":
      return applicationFailure("Only archived projects can be permanently deleted.", "validation");
    case "confirmation_mismatch":
      return applicationFailure("Project name confirmation does not match.", "validation");
    case "contents_changed":
      return applicationFailure(
        "Project contents changed. Review the deletion impact and confirm again.",
        "conflict",
      );
  }
}
