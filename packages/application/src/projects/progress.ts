import { TASK_STATUSES, isCanonicalTaskStatus, isTaskCompletedStatus } from "@ega/domain";

export type ProjectProgressTask = {
  status: string;
};

export type ProjectStatusCount = {
  status: string;
  count: number;
};

export type ProjectProgressSummary = {
  /** Every Task in the supplied scope, including unknown/custom statuses. */
  totalTaskCount: number;
  /** Completed Tasks. `review` is open work, not completion. */
  completedTaskCount: number;
  openTaskCount: number;
  /** Whole-number completion, 0 when the project has no Tasks. */
  progressPercent: number;
  /**
   * Non-empty status distribution in canonical status order. Unknown statuses
   * are retained after the canonical ones so data is never silently dropped.
   */
  statusCounts: ProjectStatusCount[];
};

/**
 * Single owner for project completion and status distribution.
 *
 * The caller decides the Task scope (for example, non-archived Tasks for a
 * destination list that defaults to the active archive view). This function
 * only applies canonical status semantics: `done` is complete, `review` is not,
 * and every supplied Task counts once toward the total.
 */
function toProgressStatus(status: string) {
  // Completed spellings are one semantic bucket. Keeping `complete` separate
  // would count a Task as done while its status segment opened an unfiltered
  // destination list.
  if (isTaskCompletedStatus(status)) return "done";
  return status;
}

export function buildProjectProgress(
  tasks: readonly ProjectProgressTask[],
): ProjectProgressSummary {
  const counts = new Map<string, number>();

  for (const task of tasks) {
    const status = toProgressStatus(task.status);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  const nonCanonicalStatuses = Array.from(counts.keys())
    .filter((status) => !isCanonicalTaskStatus(status))
    .sort((left, right) => left.localeCompare(right));
  const orderedStatuses = [...TASK_STATUSES, ...nonCanonicalStatuses];

  const statusCounts = orderedStatuses
    .map((status) => ({ status, count: counts.get(status) ?? 0 }))
    .filter((entry) => entry.count > 0);

  const totalTaskCount = tasks.length;
  const completedTaskCount = counts.get("done") ?? 0;

  return {
    totalTaskCount,
    completedTaskCount,
    openTaskCount: totalTaskCount - completedTaskCount,
    progressPercent:
      totalTaskCount > 0 ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0,
    statusCounts,
  };
}
