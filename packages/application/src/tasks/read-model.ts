import { isTaskDueBucket, isTaskPriority, isTaskStatus } from "@ega/domain";
import {
  isTaskDueFilter,
  isTaskSortValue,
  isTaskViewIdentifier,
  normalizeTaskViewDefinition,
  parseTaskViewSearchParams,
  TASK_VIEW_MAX_SEARCH_LENGTH,
  TASK_VIEW_SORT_KEYS,
  TASK_VIEW_SORT_DIRECTIONS,
  TASK_VIEW_GROUP_BY_VALUES,
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  type TaskDueFilter,
  type TaskSortValue,
  type TaskViewDefinition,
  type TaskViewSearchParams,
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
  includeArchived: boolean;
  due: TaskDueFilter;
  sort: TaskSortValue;
  limit: number | null;
  /** Canonical view shared with the web toolbar and saved views. */
  view: TaskViewDefinition;
}>;

function splitList(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readAllSearchValues(
  query: (name: string) => string | undefined | null,
  queryAll: ((name: string) => string[] | undefined) | undefined,
  name: string,
) {
  if (queryAll) {
    const values = queryAll(name);
    if (values && values.length > 0) return values;
  }
  const single = query(name);
  return single ? [single] : [];
}

export function parseMobileTaskListQuery(
  query: (name: string) => string | undefined | null,
  queryAll?: (name: string) => string[] | undefined,
): { ok: true; data: ParsedMobileTaskListQuery } | { ok: false; message: string } {
  const statusParam = (query("status") ?? "").trim();
  const priorityParam = (query("priority") ?? "").trim();
  const projectId = query("projectId")?.trim() || null;
  const goalId = query("goalId")?.trim() || null;
  const plannedForDate = query("plannedForDate")?.trim() || null;
  const includeArchivedParam = (query("includeArchived") ?? "").trim();
  const dueParam = (query("due") ?? "").trim() || DEFAULT_TASK_DUE_FILTER;
  const sortParam = (query("sort") ?? "").trim() || DEFAULT_TASK_SORT;
  const dirParam = (query("dir") ?? "").trim();
  const groupParam = (query("group") ?? "").trim();
  const searchParam = (query("q") ?? query("search") ?? "").trim();
  const limitParam = (query("limit") ?? "").trim();

  const status = statusParam ? statusParam : null;
  const statusValues = status ? splitList(status) : [];
  if (status !== null && (statusValues.length === 0 || !statusValues.every(isTaskStatus))) {
    return { ok: false, message: "Invalid status filter." };
  }

  const priority = priorityParam ? priorityParam : null;
  const priorityValues = priority ? splitList(priority) : [];
  if (
    priority !== null &&
    (priorityValues.length === 0 || !priorityValues.every(isTaskPriority))
  ) {
    return { ok: false, message: "Invalid priority filter." };
  }

  for (const [name, value] of [
    ["project", query("project")?.trim()],
    ["goal", query("goal")?.trim()],
    ["projectId", projectId],
    ["goalId", goalId],
  ] as const) {
    if (value && !value.split(",").every(isTaskViewIdentifier)) {
      return { ok: false, message: `Invalid ${name} filter.` };
    }
  }

  if (includeArchivedParam && includeArchivedParam !== "true" && includeArchivedParam !== "false") {
    return { ok: false, message: "Invalid includeArchived filter." };
  }

  const dueValues = splitList(dueParam);
  if (
    !isTaskDueFilter(dueParam) &&
    !(dueValues.length > 0 && dueValues.every(isTaskDueBucket))
  ) {
    return { ok: false, message: "Invalid due filter." };
  }

  if (
    !isTaskSortValue(sortParam) &&
    !TASK_VIEW_SORT_KEYS.includes(sortParam as (typeof TASK_VIEW_SORT_KEYS)[number])
  ) {
    return { ok: false, message: "Invalid sort value." };
  }

  if (dirParam && !TASK_VIEW_SORT_DIRECTIONS.includes(dirParam as "asc" | "desc")) {
    return { ok: false, message: "Invalid sort direction." };
  }

  if (groupParam && !TASK_VIEW_GROUP_BY_VALUES.includes(groupParam as "none")) {
    return { ok: false, message: "Invalid group value." };
  }

  if (searchParam.length > TASK_VIEW_MAX_SEARCH_LENGTH) {
    return { ok: false, message: "Search is too long." };
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

  const searchParams: { [key: string]: string | string[] } = {};
  for (const key of [
    "status",
    "statusNot",
    "priority",
    "priorityNot",
    "project",
    "projectNot",
    "goal",
    "goalNot",
    "due",
    "dueNot",
    "dueWithin",
    "estimateMin",
    "estimateMax",
    "tasks",
    "q",
    "group",
    "sort",
    "dir",
  ]) {
    const value = query(key);
    if (value !== undefined && value !== null && value !== "") searchParams[key] = value;
  }
  if (projectId) searchParams.projectId = projectId;
  if (goalId) searchParams.goalId = goalId;
  // `projectId`/`goalId` are the transport names; the URL/contract uses
  // `project`/`goal`. Normalize here so both spellings produce one view.
  if (projectId) searchParams.project = projectId;
  if (goalId) searchParams.goal = goalId;
  const filterValues = readAllSearchValues(query, queryAll, "filter");
  if (filterValues.length > 0) searchParams.filter = filterValues;

  const view = parseTaskViewSearchParams(searchParams as TaskViewSearchParams);

  return {
    ok: true,
    data: {
      status: (statusValues.length === 1 ? statusValues[0] : null) as TaskQuery["status"],
      priority: (priorityValues.length === 1 ? priorityValues[0] : null) as TaskQuery["priority"],
      projectId,
      goalId,
      plannedForDate,
      includeArchived: includeArchivedParam === "true",
      due: (isTaskDueFilter(dueParam) ? dueParam : dueValues[0]) as TaskDueFilter,
      sort: (isTaskSortValue(sortParam) ? sortParam : DEFAULT_TASK_SORT) as TaskSortValue,
      limit,
      view,
    },
  };
}

/**
 * Canonical enriched task list. Counters describe the full filtered scope
 * before pagination; project/goal option lists ride along so task forms can
 * reuse one bounded payload.
 *
 * `options.localDate` is the owner's canonical local date resolved from Time
 * Context by the caller (route → resolveTimeContext() → localDate). Due
 * filters and counters are evaluated against it, never the process timezone.
 */
export async function getTasksReadModel(
  actor: AuthenticatedActor,
  repository: TasksRepository,
  query?: TaskQuery,
  options?: Readonly<{ now?: Date; localDate?: string }>,
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

  // Unknown project/goal filter values are dropped before they reach SQL, the
  // same echo-back rule the legacy scalar filters use.
  const scopedView = requested.view
    ? (normalizeTaskViewDefinition({
        ...requested.view,
        filters: requested.view.filters.flatMap((filter) => {
          if (filter.field === "project") {
            const values = filter.values.filter((value) =>
              projectsResult.value.some((project) => project.id === value),
            );
            return values.length > 0 ? [{ ...filter, values }] : [];
          }
          if (filter.field === "goal") {
            const values = filter.values.filter((value) =>
              visibleGoals.some((goal) => goal.id === value),
            );
            return values.length > 0 ? [{ ...filter, values }] : [];
          }
          return [filter];
        }),
      }) ?? requested.view)
    : requested.view;

  const localDate = options?.localDate?.trim() || "";
  if (!localDate) {
    return applicationFailure("Unable to resolve the local day right now.");
  }

  const result = await repository.listTasks(actor, {
    ...requested,
    projectId: activeProjectId,
    goalId: activeGoalId,
    today: localDate,
    view: scopedView,
  });
  if (!result.ok) return applicationFailure("Unable to load tasks right now.");

  const countResult = repository.countTasks
    ? await repository.countTasks(actor, {
        ...requested,
        projectId: activeProjectId,
        goalId: activeGoalId,
        today: localDate,
        view: scopedView,
      })
    : null;

  const view = buildMobileTaskListView({
    records: result.value,
    projects: projectsResult.value,
    goals: goalsResult.value,
    query: {
      ...requested,
      projectId: activeProjectId,
      goalId: activeGoalId,
      today: localDate,
      view: scopedView,
      totalCount: countResult?.ok ? countResult.value : null,
    },
    today: localDate,
  });

  return applicationSuccess({
    ok: true,
    tasks: view.items,
    counters: view.counters,
    filters: view.filters,
    groups: view.groups,
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
