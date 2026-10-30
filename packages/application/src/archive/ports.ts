import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

/**
 * One archived task, as the archive centre lists it. `archivedAt` is the
 * archival timestamp owned by the tasks table; nothing here re-derives it.
 */
export type ArchiveTaskRecord = {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  projectArchived: boolean;
  goalId: string | null;
  goalTitle: string | null;
  goalArchived: boolean;
  archivedAt: string;
  updatedAt: string;
};

export type ArchiveGoalRecord = {
  id: string;
  title: string;
  status: string;
  projectId: string;
  projectName: string | null;
  projectArchived: boolean;
  archivedAt: string;
  updatedAt: string;
};

export type ArchiveProjectRecord = {
  id: string;
  name: string;
  slug: string;
  archivedAt: string;
  updatedAt: string;
};

export type ArchiveSummary = {
  tasks: number;
  goals: number;
  projects: number;
};

export type ArchiveListQuery = {
  /** Already normalised by the read model; empty means "no search filter". */
  search: string;
  limit: number;
};

export interface ArchiveRepository {
  getArchiveSummary(actor: AuthenticatedActor): Promise<RepositoryResult<ArchiveSummary>>;
  listArchivedTasks(
    actor: AuthenticatedActor,
    query: ArchiveListQuery,
  ): Promise<RepositoryResult<ArchiveTaskRecord[]>>;
  listArchivedGoals(
    actor: AuthenticatedActor,
    query: ArchiveListQuery,
  ): Promise<RepositoryResult<ArchiveGoalRecord[]>>;
  listArchivedProjects(
    actor: AuthenticatedActor,
    query: ArchiveListQuery,
  ): Promise<RepositoryResult<ArchiveProjectRecord[]>>;
}
