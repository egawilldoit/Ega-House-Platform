import {
  normalizeArchiveSearchQuery,
  normalizeArchiveTab,
  type ArchiveTab,
} from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type {
  ArchiveGoalRecord,
  ArchiveProjectRecord,
  ArchiveRepository,
  ArchiveSummary,
  ArchiveTaskRecord,
} from "./ports";

/**
 * Hard ceiling on archived rows returned for one tab. The archive centre is a
 * review/restore surface, not a bulk export; search narrows the scope before
 * the limit applies.
 */
export const ARCHIVE_ITEM_LIMIT = 200;

export type ArchiveReadModel = {
  tab: ArchiveTab;
  search: string;
  summary: ArchiveSummary;
  tasks: ArchiveTaskRecord[];
  goals: ArchiveGoalRecord[];
  projects: ArchiveProjectRecord[];
};

/**
 * Compose the archive centre read model. Only the active tab is listed; the
 * summary counts every tab so the tab strip can show totals without loading
 * three lists.
 */
export async function getArchiveReadModel(
  actor: AuthenticatedActor,
  repository: ArchiveRepository,
  input: { tab?: unknown; search?: unknown },
): Promise<ApplicationResult<ArchiveReadModel>> {
  const tab = normalizeArchiveTab(input.tab);
  const search = normalizeArchiveSearchQuery(input.search);
  const query = { search, limit: ARCHIVE_ITEM_LIMIT };

  const listResult =
    tab === "goals"
      ? repository.listArchivedGoals(actor, query)
      : tab === "projects"
        ? repository.listArchivedProjects(actor, query)
        : repository.listArchivedTasks(actor, query);

  const [summaryResult, itemsResult] = await Promise.all([
    repository.getArchiveSummary(actor),
    listResult,
  ]);

  if (!summaryResult.ok || !itemsResult.ok) {
    return applicationFailure("Unable to load the archive right now.");
  }

  const items = itemsResult.value as unknown[];

  return applicationSuccess({
    tab,
    search,
    summary: summaryResult.value,
    tasks: tab === "tasks" ? (items as ArchiveTaskRecord[]) : [],
    goals: tab === "goals" ? (items as ArchiveGoalRecord[]) : [],
    projects: tab === "projects" ? (items as ArchiveProjectRecord[]) : [],
  });
}
