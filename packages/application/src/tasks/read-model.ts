import { isTaskPriority, isTaskStatus } from "@ega/domain";
import {
  isTaskDueFilter,
  isTaskSortValue,
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  type TaskDueFilter,
  type TaskSortValue,
} from "@ega/contracts/common/task-list";
import type { MobileTaskListItem, MobileTaskListResponse } from "@ega/contracts/mobile";

import type { AuthenticatedActor } from "../auth/actor";
import { applicationFailure, applicationSuccess, type ApplicationResult } from "../shared/result";
import type { TaskQuery, TasksRepository } from "./ports";
import { TASK_LIST_MAX_LIMIT, buildMobileTaskListView, toMobileTaskListItem } from "./list-view";

export type ParsedMobileTaskListQuery = Readonly<{
  status: TaskQuery["status"];
  priority: TaskQuery["priority"];
  projectId: string | null;
  goalId: string | null;
  plannedForDate: string | null;
  due: TaskDueFilter;
  sort: TaskSortValue;
  limit: number | null;
}>;

export function parseMobileTaskListQuery(
  query: (name: string) => string | undefined | null,
): { ok: true; data: ParsedMobileTaskListQuery } | { ok: false; message: string } {
  const statusParam = (query("status") ?? "").trim();
  const priorityParam = (query("priority") ?? "").trim();
  const projectId = query("projectId")?.trim() || null;
  const goalId = query("goalId")?.trim() || null;
  const plannedForDate = query("plannedForDate")?.trim() || null;
  const dueParam = (query("due") ?? "").trim() || DEFAULT_TASK_DUE_FILTER;
  const sortParam = (query("sort") ?? "").trim() || DEFAULT_TASK_SORT;
  const limitParam = (query("limit") ?? "").trim();

  const status = statusParam ? statusParam : null;
  if (status !== null && !isTaskStatus(status)) {
    return { ok: false, message: "Invalid status filter." };
  }

  const priority = priorityParam ? priorityParam : null;
  if (priority !== null && !isTaskPriority(priority)) {
    return { ok: false, message: "Invalid priority filter." };
  }

  if (!isTaskDueFilter(dueParam)) {
    return { ok: false, message: "Invalid due filter." };
  }

  if (!isTaskSortValue(sortParam)) {
    return { ok: false, message: "Invalid sort value." };
  }

  let limit: number | null = null;
  if (limitParam) {
    const parsedLimit = Number.parseInt(limitParam, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0 || parsedLimit > TASK_LIST_MAX_LIMIT) {
      return {
        ok: false,
        message: `limit must be an integer between 1 and ${TASK_LIST_MAX_LIMIT}.`,
      };
    }
    limit = parsedLimit;
  }

  return {
    ok: true,
    data: {
      status: status as TaskQuery["status"],
      priority: priority as TaskQuery["priority"],
      projectId,
      goalId,
      plannedForDate,
      due: dueParam,
      sort: sortParam,
      limit,
    },
  };
}

/**
 * Canonical enriched task list. Counters describe the full filtered scope
 * before pagination; project/goal option lists ride along so task forms can
 * reuse one bounded payload.
 */
export async function getTasksReadModel(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  query?: TaskQuery,
  options?: Readonly<{ now?: Date }>,
): Promise<ApplicationResult<MobileTaskListResponse>> {
  const requested = query ?? {};
  const [projectsResult, goalsResult] = await Promise.all([
    repository.listProjectOptions(actor),
    repository.listGoalOptions(actor),
  ]);
  if (!projectsResult.ok || !goalsResult.ok) {
    return applicationFailure("Unable to load tasks right now.");
  }

  // Echo-back resolution mirrors the mobile contract: unknown project/goal
  // filters are dropped instead of yielding an empty page.
  const activeProjectId =
    requested.projectId &&
    projectsResult.value.some((project) => project.id === requested.projectId)
      ? requested.projectId
      : null;
  const visibleGoals = activeProjectId
    ? goalsResult.value.filter((goal) => goal.projectId === activeProjectId)
    : goalsResult.value;
  const activeGoalId =
    requested.goalId && visibleGoals.some((goal) => goal.id === requested.goalId)
      ? requested.goalId
      : null;

  const result = await repository.listTasks(actor, {
    ...requested,
    projectId: activeProjectId,
    goalId: activeGoalId,
  });
  if (!result.ok) return applicationFailure("Unable to load tasks right now.");

  const view = buildMobileTaskListView({
    records: result.value,
    projects: projectsResult.value,
    goals: goalsResult.value,
    query: { ...requested, projectId: activeProjectId, goalId: activeGoalId },
    now: options?.now,
  });

  return applicationSuccess({
    ok: true,
    tasks: view.items,
    counters: view.counters,
    filters: view.filters,
    projects: view.projects,
    goals: view.goals,
  });
}

/**
 * Single enriched task item in the mobile item shape, or null when the task
 * does not exist within the actor's scope.
 */
export async function getTaskReadModel(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  taskIdInput: unknown,
): Promise<ApplicationResult<MobileTaskListItem | null>> {
  const taskId = String(taskIdInput ?? "").trim();
  if (!taskId) return applicationFailure("Task request is invalid.");

  const result = await repository.getTask(actor, taskId);
  if (!result.ok) return applicationFailure("Unable to load task right now.");
  if (!result.value) return applicationSuccess(null);

  return applicationSuccess(toMobileTaskListItem(result.value));
}

/** Builds `{ ok: true, task }` mutation payloads for single-item responses. */
export async function getTaskMutationResponse(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  taskIdInput: unknown,
): Promise<ApplicationResult<{ ok: true; task: MobileTaskListItem } | null>> {
  const result = await getTaskReadModel(actor, repository, taskIdInput);
  if (!result.ok) return result;
  if (!result.data) return applicationSuccess(null);
  return applicationSuccess({ ok: true as const, task: result.data });
}
