import type { ProjectStatus, ProjectViewFilter } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type ProjectRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectTaskContextRecord = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  priority: string;
  updatedAt: string;
};

export type ProjectGoalRecord = {
  id: string;
  title: string;
  projectId: string;
};

export type CreateProjectRecordInput = {
  name: string;
  slug: string;
  description: string | null;
  mcpOperationId?: string;
  mcpClientId?: string;
};

export type DeleteArchivedProjectInput = {
  projectId: string;
};

export type DeleteArchivedProjectResult = {
  deleted: boolean;
};

export type ProjectPurgePreview = {
  projectId: string;
  projectName: string;
  taskCount: number;
  goalCount: number;
  sessionCount: number;
  activeSessionCount: number;
  reminderCount: number;
  recurrenceCount: number;
  externalRefCount: number;
  taskNotificationCount: number;
  calendarEventCount: number;
};

export type PurgeArchivedProjectInput = {
  projectId: string;
  confirmationName: string;
  expectedTaskCount: number;
  expectedGoalCount: number;
};

export type PurgeArchivedProjectResult =
  | Readonly<{
      status: "purged";
      tasksDeleted: number;
      goalsDeleted: number;
      sessionsDeleted: number;
      externalRefsDeleted: number;
      notificationsDeleted: number;
      calendarDeleteJobsEnqueued: number;
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "not_archived" }>
  | Readonly<{ status: "confirmation_mismatch" }>
  | Readonly<{ status: "contents_changed" }>;

export interface ProjectsRepository {
  listProjects(
    actor: AuthenticatedActor,
    view: ProjectViewFilter,
  ): Promise<RepositoryResult<ProjectRecord[]>>;
  listProjectStatuses(actor: AuthenticatedActor): Promise<RepositoryResult<string[]>>;
  listTasksForProjects(
    actor: AuthenticatedActor,
    projectIds: string[],
  ): Promise<RepositoryResult<ProjectTaskContextRecord[]>>;
  getProjectBySlug(
    actor: AuthenticatedActor,
    slug: string,
  ): Promise<RepositoryResult<ProjectRecord | null>>;
  getProjectById(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<RepositoryResult<ProjectRecord | null>>;
  listGoalsForProject(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<RepositoryResult<ProjectGoalRecord[]>>;
  createProject(
    actor: AuthenticatedActor,
    input: CreateProjectRecordInput,
  ): Promise<RepositoryResult<null>>;
  updateProjectStatus(
    actor: AuthenticatedActor,
    input: { projectId: string; status: ProjectStatus; updatedAt: string },
  ): Promise<RepositoryResult<null>>;
  deleteArchivedProject(
    actor: AuthenticatedActor,
    input: DeleteArchivedProjectInput,
  ): Promise<RepositoryResult<DeleteArchivedProjectResult>>;
  getProjectPurgePreview(
    actor: AuthenticatedActor,
    projectId: string,
  ): Promise<RepositoryResult<ProjectPurgePreview | null>>;
  purgeArchivedProject(
    actor: AuthenticatedActor,
    input: PurgeArchivedProjectInput,
  ): Promise<RepositoryResult<PurgeArchivedProjectResult>>;
}
