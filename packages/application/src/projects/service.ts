import {
  PROJECT_ARCHIVE_STATUS,
  isProjectArchivedStatus,
  isProjectStatus,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import {
  applicationFailure,
  applicationSuccess,
  type ApplicationErrorCode,
  type ApplicationResult,
} from "../shared/result";
import {
  resolveTimeContext,
  type TimeContextRepository,
} from "../shared/time-context";
import type {
  CreateProjectFromTemplateRecordInput,
  CreateProjectFromTemplateTaskInput,
  ProjectPurgePreview,
  ProjectsRepository,
} from "./ports";
import {
  PROJECT_TEMPLATE_GOAL_STATUS,
  isProjectTemplateId,
  resolveProjectTemplatePreview,
  type ProjectTemplatePreview,
} from "./templates";

/**
 * A repository refusal carries either a class ("conflict") or none ("unknown").
 * Every MCP write use case must forward it: a transport that cannot tell the
 * two apart freezes a transient dependency failure as a permanent receipt.
 */
function toAppErrorCode(repoCode?: string): "conflict" | "unknown" {
  return repoCode === "conflict" ? "conflict" : "unknown";
}

export type ProjectFormValues = {
  name: string;
  slug: string;
  description: string;
  areaId?: string;
};

export type CreateProjectResult =
  | Readonly<{ ok: true; data: null; values: ProjectFormValues }>
  | Readonly<{ ok: false; errorMessage: string; values: ProjectFormValues; code?: ApplicationErrorCode }>;

export function normalizeProjectSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Canonical project form validation. `createProject` and
 * `createProjectFromTemplate` both read untrusted project fields through this
 * one function, so the two creation paths cannot drift on name/slug rules.
 */
export function readProjectFormValues(input: {
  name: unknown;
  slug: unknown;
  description: unknown;
  areaId?: unknown;
}): { values: ProjectFormValues; errorMessage: string | null } {
  const name = String(input.name ?? "").trim();
  const slug = normalizeProjectSlug(String(input.slug ?? ""));
  const description = String(input.description ?? "").trim();
  const areaId = String(input.areaId ?? "").trim();
  const values = { name, slug, description, areaId };

  if (!name) return { values, errorMessage: "Project name is required." };
  if (!slug) return { values, errorMessage: "Slug is required." };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return {
      values,
      errorMessage: "Slug can only contain lowercase letters, numbers, and hyphens.",
    };
  }

  return { values, errorMessage: null };
}

export async function createProject(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: {
    name: unknown;
    slug: unknown;
    description: unknown;
    areaId?: unknown;
    mcpOperationId?: string;
    mcpClientId?: string;
  },
): Promise<CreateProjectResult> {
  const { values, errorMessage } = readProjectFormValues(input);

  if (errorMessage) return { ok: false, errorMessage, values };

  const { name, slug, description, areaId = "" } = values;

  if (areaId) {
    if (!PROJECT_ID_PATTERN.test(areaId)) {
      return { ok: false, errorMessage: "Choose a valid area.", values };
    }

    const areaResult = await repository.getAreaById(actor, areaId);
    if (!areaResult.ok) {
      return {
        ok: false,
        errorMessage: "Unable to verify the area right now.",
        values,
      };
    }
    if (!areaResult.value) {
      return { ok: false, errorMessage: "Area not found.", values };
    }
  }

  const createInput = {
    name,
    slug,
    description: description || null,
    areaId: areaId || null,
    ...(input.mcpOperationId && input.mcpClientId
      ? { mcpOperationId: input.mcpOperationId, mcpClientId: input.mcpClientId }
      : {}),
  };
  const result = await repository.createProject(actor, createInput);

  if (!result.ok) {
    // The repository refused, so the dependency class is what a transport needs
    // to tell a retryable outage from a request it will reject again.
    return {
      ok: false,
      errorMessage:
        result.error.code === "conflict"
          ? "That slug is already in use. Choose a different slug."
          : "Unable to create project right now. Please try again.",
      values,
      code: toAppErrorCode(result.error.code),
    };
  }

  return { ok: true, data: null, values };
}

export type CreateProjectFromTemplateFormValues = ProjectFormValues & {
  templateId: string;
};

export type CreateProjectFromTemplateSummary = Readonly<{
  projectId: string;
  slug: string;
  goalCount: number;
  taskCount: number;
  replayed: boolean;
}>;

export type CreateProjectFromTemplateResult =
  | Readonly<{
      ok: true;
      data: CreateProjectFromTemplateSummary;
      values: CreateProjectFromTemplateFormValues;
    }>
  | Readonly<{
      ok: false;
      errorMessage: string;
      values: CreateProjectFromTemplateFormValues;
    }>;

const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the repository payload from an already-resolved preview.
 *
 * The preview and the insert payload come from the same resolution, so every
 * due date the owner reviewed is the due date that is persisted. No repository
 * or template-specific task store is introduced: the payload lands in the
 * canonical projects/goals/tasks tables inside one database transaction.
 */
export function toCreateProjectFromTemplateRecord(input: {
  preview: ProjectTemplatePreview;
  operationId: string;
  name: string;
  slug: string;
  description: string | null;
  areaId: string | null;
}): CreateProjectFromTemplateRecordInput {
  const goals = input.preview.goals.map((goal) => ({
    title: goal.title,
    description: goal.description,
    status: PROJECT_TEMPLATE_GOAL_STATUS,
  }));

  const tasks: CreateProjectFromTemplateTaskInput[] = [];

  input.preview.goals.forEach((goal, goalIndex) => {
    for (const task of goal.tasks) {
      tasks.push({
        goalIndex,
        title: task.title,
        description: task.description,
        priority: task.priority,
        estimateMinutes: task.estimateMinutes,
        dueDate: task.dueDate,
      });
    }
  });

  return {
    operationId: input.operationId,
    templateId: input.preview.templateId,
    name: input.name,
    slug: input.slug,
    description: input.description,
    areaId: input.areaId,
    goals,
    tasks,
  };
}

/**
 * Create a project from a typed template in one bounded repository operation.
 *
 * Business rules owned here: template selection, canonical project field
 * validation, server-issued operation identity, the owner's local-date
 * resolution, and the resolved preview itself. Atomicity and idempotency are
 * owned by the database function (`create_project_from_template`): a failure
 * anywhere inside it leaves no project, goal or task row, and repeating the
 * same operation id returns the project created by the first attempt.
 */
export async function createProjectFromTemplate(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  timeContextRepository: TimeContextRepository,
  input: {
    templateId: unknown;
    operationId: unknown;
    name: unknown;
    slug: unknown;
    description: unknown;
    areaId?: unknown;
    now?: Date;
  },
): Promise<CreateProjectFromTemplateResult> {
  const templateIdRaw = String(input.templateId ?? "").trim();
  const operationId = String(input.operationId ?? "").trim();
  const { values, errorMessage } = readProjectFormValues(input);
  const formValues: CreateProjectFromTemplateFormValues = {
    ...values,
    templateId: templateIdRaw,
  };

  if (!isProjectTemplateId(templateIdRaw)) {
    return {
      ok: false,
      errorMessage: "Choose a project template.",
      values: formValues,
    };
  }

  if (errorMessage) {
    return { ok: false, errorMessage, values: formValues };
  }

  if (!OPERATION_ID_PATTERN.test(operationId)) {
    return {
      ok: false,
      errorMessage: "This form is no longer valid. Reload the page and try again.",
      values: formValues,
    };
  }

  const areaId = values.areaId ?? "";

  if (areaId) {
    if (!PROJECT_ID_PATTERN.test(areaId)) {
      return { ok: false, errorMessage: "Choose a valid area.", values: formValues };
    }

    const areaResult = await repository.getAreaById(actor, areaId);
    if (!areaResult.ok) {
      return {
        ok: false,
        errorMessage: "Unable to verify the area right now.",
        values: formValues,
      };
    }
    if (!areaResult.value) {
      return { ok: false, errorMessage: "Area not found.", values: formValues };
    }
  }

  const timeContext = await resolveTimeContext(actor, timeContextRepository, {
    now: input.now ?? new Date(),
  });

  if (!timeContext.ok) {
    return {
      ok: false,
      errorMessage: "Unable to load your time zone right now. Please try again.",
      values: formValues,
    };
  }

  const previewResult = resolveProjectTemplatePreview({
    templateId: templateIdRaw,
    localDate: timeContext.data.localDate,
  });

  if (!previewResult.ok) {
    return { ok: false, errorMessage: previewResult.errorMessage, values: formValues };
  }

  const record = toCreateProjectFromTemplateRecord({
    preview: previewResult.data,
    operationId,
    name: values.name,
    slug: values.slug,
    description: values.description || null,
    areaId: areaId || null,
  });

  const result = await repository.createProjectFromTemplate(actor, record);

  if (!result.ok) {
    return {
      ok: false,
      errorMessage:
        result.error.code === "conflict"
          ? "That slug is already in use. Choose a different slug."
          : "Unable to create the project from this template right now. Please try again.",
      values: formValues,
    };
  }

  return { ok: true, data: result.value, values: formValues };
}

export async function updateProjectStatus(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; status: unknown; now?: Date },
): Promise<ApplicationResult<null>> {
  const projectId = String(input.projectId ?? "").trim();
  const status = String(input.status ?? "").trim();

  // Archived is not a lifecycle status: it is archival metadata owned by
  // archiveProject/unarchiveProject, and the database ties `status =
  // 'archived'` to `archived_at`. A status write must never be the way in.
  if (
    !projectId ||
    !isProjectStatus(status) ||
    status === PROJECT_ARCHIVE_STATUS
  ) {
    return applicationFailure("Project update request is invalid.");
  }

  const result = await repository.updateProjectStatus(actor, {
    projectId,
    status,
    updatedAt: (input.now ?? new Date()).toISOString(),
  });

  return result.ok
    ? applicationSuccess(null)
    : applicationFailure("Unable to update project right now.", toAppErrorCode(result.error.code));
}

async function setProjectArchiveState(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; archived: boolean; now?: Date },
) {
  const projectId = String(input.projectId ?? "").trim();
  if (!projectId) return applicationFailure("Project update request is invalid.");

  // Archiving a project hides its active tasks from active surfaces, so it
  // must not detach currently running work. Mirrors the task archive rule.
  if (input.archived) {
    const timerResult = await repository.hasOpenTaskSessionForProject(actor, projectId);
    if (!timerResult.ok) {
      return applicationFailure("Unable to validate timer sessions for this project right now.");
    }
    if (timerResult.value) {
      return applicationFailure("Stop the active timer before archiving this project.");
    }
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const result = await repository.updateProjectArchiveState(actor, {
    projectId,
    archivedAt: input.archived ? nowIso : null,
    updatedAt: nowIso,
  });

  return result.ok
    ? applicationSuccess(null)
    : applicationFailure("Unable to update project right now.", toAppErrorCode(result.error.code));
}

export function archiveProject(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; now?: Date },
) {
  return setProjectArchiveState(actor, repository, {
    projectId: input.projectId,
    archived: true,
    now: input.now,
  });
}

export function unarchiveProject(
  actor: AuthenticatedActor,
  repository: ProjectsRepository,
  input: { projectId: unknown; now?: Date },
) {
  return setProjectArchiveState(actor, repository, {
    projectId: input.projectId,
    archived: false,
    now: input.now,
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
    repository.listTasksForProjects(actor, [projectId], { includeArchived: true }),
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
