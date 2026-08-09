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
};

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
}
