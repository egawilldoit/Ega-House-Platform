import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  isTaskDueFilter,
  isTaskSortValue,
  normalizeTaskViewDefinition,
  serializeTaskViewDefinition,
  taskViewFromLegacyInput,
  TASK_VIEW_DEFINITION_MAX_CHARS,
  taskSortValueToViewSort,
  type TaskDueFilter,
  type TaskSortValue,
  type TaskViewDefinition,
  type TaskViewFilter,
} from "@ega/contracts/common/task-list";
import { getTaskViewDefinitionVersion } from "@ega/contracts/common/task-list";
import { isTaskPriority, isTaskStatus, type TaskPriority } from "@/lib/task-domain";

export const MAX_TASK_SAVED_VIEW_NAME_LENGTH = 80;
export const DEEP_WORK_SAVED_VIEW_ID = "default:deep-work";
export const QUICK_WINS_SAVED_VIEW_ID = "default:quick-wins";
export const BLOCKED_SAVED_VIEW_ID = "default:blocked";
export const DUE_THIS_WEEK_SAVED_VIEW_ID = "default:due-this-week";

const DEEP_WORK_PRIORITIES = ["urgent", "high"] as const satisfies TaskPriority[];

export type TaskSavedViewFilters = {
  status: string | null;
  projectId: string | null;
  goalId: string | null;
  dueFilter: TaskDueFilter;
  sortValue: TaskSortValue;
  activeTasks: boolean;
  priorityValues: ReadonlyArray<TaskPriority>;
  estimateMinMinutes: number | null;
  estimateMaxMinutes: number | null;
  dueWithinDays: number | null;
};

/** Saved-view definitions are the canonical v2 task view definition. */
export type TaskSavedViewDefinition = TaskViewDefinition;

export function normalizeTaskSavedViewFilters(input: {
  status?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  dueFilter?: string | null;
  sortValue?: string | null;
  activeTasks?: boolean | null;
  priority?: string | ReadonlyArray<string> | null;
  estimateMinMinutes?: string | number | null;
  estimateMaxMinutes?: string | number | null;
  dueWithinDays?: string | number | null;
}): TaskSavedViewFilters {
  const status = String(input.status ?? "").trim();
  const projectId = String(input.projectId ?? "").trim();
  const goalId = String(input.goalId ?? "").trim();
  const dueFilter = String(input.dueFilter ?? "").trim();
  const sortValue = String(input.sortValue ?? "").trim();
  const rawPriorityValues = Array.isArray(input.priority)
    ? input.priority
    : String(input.priority ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  const priorityValues = Array.from(
    new Set(rawPriorityValues.filter((value): value is TaskPriority => isTaskPriority(value))),
  );
  const rawEstimateMinValue =
    input.estimateMinMinutes === null || input.estimateMinMinutes === undefined
      ? null
      : Number(input.estimateMinMinutes);
  const estimateMinMinutes =
    rawEstimateMinValue !== null &&
    Number.isSafeInteger(rawEstimateMinValue) &&
    rawEstimateMinValue > 0
      ? rawEstimateMinValue
      : null;
  const rawEstimateMaxValue =
    input.estimateMaxMinutes === null || input.estimateMaxMinutes === undefined
      ? null
      : Number(input.estimateMaxMinutes);
  const estimateMaxMinutes =
    rawEstimateMaxValue !== null &&
    Number.isSafeInteger(rawEstimateMaxValue) &&
    rawEstimateMaxValue > 0
      ? rawEstimateMaxValue
      : null;
  const rawDueWithinDays =
    input.dueWithinDays === null || input.dueWithinDays === undefined
      ? null
      : Number(input.dueWithinDays);
  const dueWithinDays =
    rawDueWithinDays !== null &&
    Number.isSafeInteger(rawDueWithinDays) &&
    rawDueWithinDays > 0
      ? rawDueWithinDays
      : null;

  return {
    status: status && isTaskStatus(status) ? status : null,
    projectId: projectId || null,
    goalId: goalId || null,
    dueFilter: isTaskDueFilter(dueFilter) ? dueFilter : DEFAULT_TASK_DUE_FILTER,
    sortValue: isTaskSortValue(sortValue) ? sortValue : DEFAULT_TASK_SORT,
    activeTasks: input.activeTasks === true,
    priorityValues,
    estimateMinMinutes,
    estimateMaxMinutes,
    dueWithinDays,
  };
}

/** Validate/normalize an untrusted `definition_json` (v1 migrates to v2). */
export function normalizeTaskSavedViewDefinition(
  rawDefinition: unknown,
): TaskSavedViewDefinition | null {
  return normalizeTaskViewDefinition(rawDefinition);
}

export function serializeTaskSavedViewDefinition(definition: TaskSavedViewDefinition) {
  const serialized = serializeTaskViewDefinition(definition);
  return serialized.length <= TASK_VIEW_DEFINITION_MAX_CHARS ? serialized : null;
}

function hasFilterField(filters: readonly TaskViewFilter[], field: TaskViewFilter["field"]) {
  return filters.some((filter) => filter.field === field);
}

/**
 * Rebuild the canonical view for a saved-view row.
 *
 * Version 2 rows carry everything in `definition_json`. Version 1 rows (and
 * rows written before `definition_json` existed) keep their scope in the legacy
 * columns; those columns are merged on read so old views still load with the
 * same meaning.
 */
export function getTaskViewFromSavedView(input: {
  definitionJson?: unknown;
  status?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  dueFilter?: string | null;
  sortValue?: string | null;
}): TaskViewDefinition {
  const rawVersion = getTaskViewDefinitionVersion(input.definitionJson);
  const definition = normalizeTaskViewDefinition(input.definitionJson);
  const legacy = taskViewFromLegacyInput({
    status: input.status,
    projectId: input.projectId,
    goalId: input.goalId,
    due: input.dueFilter,
    sort: input.sortValue,
  });

  if (!definition) {
    return legacy;
  }

  if (rawVersion === 2) {
    return definition;
  }

  // Version 1 never stored project/goal/sort in the definition.
  const mergedFilters = [...definition.filters];
  for (const filter of legacy.filters) {
    if (!hasFilterField(mergedFilters, filter.field)) {
      mergedFilters.push(filter);
    }
  }

  const merged = normalizeTaskViewDefinition({
    ...definition,
    filters: mergedFilters,
    sort: legacy.sort,
  });

  return merged ?? definition;
}

export function getTaskSavedViewFiltersFromDefinition(
  definition: TaskSavedViewDefinition | null,
): Partial<TaskSavedViewFilters> {
  if (!definition) return {};

  const filters = definition.filters;
  const statusFilter = filters.find(
    (filter) =>
      filter.field === "status" &&
      (filter.operator === "is" || filter.operator === "is_any_of"),
  );
  const priorityFilter = filters.find(
    (filter) =>
      filter.field === "priority" &&
      (filter.operator === "is" || filter.operator === "is_any_of"),
  );
  const estimateFilter = filters.find(
    (filter) => filter.field === "estimate" && filter.operator === "between",
  );
  const dueWithinFilter = filters.find(
    (filter) => filter.field === "due_within_days" && filter.operator === "is",
  );
  const projectFilter = filters.find(
    (filter) =>
      filter.field === "project" &&
      (filter.operator === "is" || filter.operator === "is_any_of"),
  );
  const goalFilter = filters.find(
    (filter) =>
      filter.field === "goal" &&
      (filter.operator === "is" || filter.operator === "is_any_of"),
  );
  const dueFilter = filters.find(
    (filter) => filter.field === "due_bucket" && filter.operator === "is",
  );

  return {
    status:
      statusFilter?.values.length === 1 && isTaskStatus(statusFilter.values[0])
        ? statusFilter.values[0]
        : null,
    projectId: projectFilter?.values.length === 1 ? projectFilter.values[0] : null,
    goalId: goalFilter?.values.length === 1 ? goalFilter.values[0] : null,
    dueFilter:
      dueFilter?.values[0] === "overdue"
        ? "overdue"
        : dueFilter?.values[0] === "today"
          ? "due_today"
          : dueFilter?.values[0] === "next_7_days"
            ? "due_soon"
            : dueFilter?.values[0] === "none"
              ? "no_due_date"
              : DEFAULT_TASK_DUE_FILTER,
    sortValue:
      definition.sort.key === "due" && definition.sort.direction === "asc"
        ? "due_date_asc"
        : definition.sort.key === "due" && definition.sort.direction === "desc"
          ? "due_date_desc"
          : DEFAULT_TASK_SORT,
    activeTasks: definition.activeOnly,
    priorityValues: (priorityFilter?.values ?? []).filter(
      (value): value is TaskPriority => isTaskPriority(value),
    ),
    estimateMinMinutes:
      estimateFilter && estimateFilter.values[0] !== ""
        ? Number(estimateFilter.values[0])
        : null,
    estimateMaxMinutes:
      estimateFilter && estimateFilter.values[1] !== ""
        ? Number(estimateFilter.values[1])
        : null,
    dueWithinDays: dueWithinFilter ? Number(dueWithinFilter.values[0]) : null,
  };
}

export function getTaskSavedViewDefinitionFromFilters(
  filters: TaskSavedViewFilters,
): TaskSavedViewDefinition {
  return taskViewFromLegacyInput({
    status: filters.status,
    priority: filters.priorityValues,
    projectId: filters.projectId,
    goalId: filters.goalId,
    due: filters.dueFilter,
    dueWithinDays: filters.dueWithinDays,
    estimateMinMinutes: filters.estimateMinMinutes,
    estimateMaxMinutes: filters.estimateMaxMinutes,
    sort: filters.sortValue,
    activeOnly: filters.activeTasks,
  });
}

/**
 * Legacy columns kept for old readers/compatibility. New rows still write them
 * from the canonical view so a rollback to an older build shows a sensible
 * one-dimensional view instead of "all tasks".
 */
export function getTaskSavedViewLegacyColumns(view: TaskViewDefinition) {
  const status = view.filters.find(
    (filter) =>
      filter.field === "status" &&
      (filter.operator === "is" || filter.operator === "is_any_of"),
  );
  const project = view.filters.find(
    (filter) =>
      filter.field === "project" &&
      (filter.operator === "is" || filter.operator === "is_any_of"),
  );
  const goal = view.filters.find(
    (filter) =>
      filter.field === "goal" &&
      (filter.operator === "is" || filter.operator === "is_any_of"),
  );
  const due = view.filters.find(
    (filter) => filter.field === "due_bucket" && filter.operator === "is",
  );
  const filters = getTaskSavedViewFiltersFromDefinition(view);

  return {
    status: status?.values.length === 1 ? status.values[0] : null,
    projectId: project?.values.length === 1 ? project.values[0] : null,
    goalId: goal?.values.length === 1 ? goal.values[0] : null,
    dueFilter:
      due?.values[0] === "overdue"
        ? "overdue"
        : due?.values[0] === "today"
          ? "due_today"
          : due?.values[0] === "next_7_days"
            ? "due_soon"
            : due?.values[0] === "none"
              ? "no_due_date"
              : "all",
    sortValue:
      view.sort.key === "due" && view.sort.direction === "asc"
        ? "due_date_asc"
        : view.sort.key === "due" && view.sort.direction === "desc"
          ? "due_date_desc"
          : "updated_desc",
    filters,
  };
}

export const DEEP_WORK_SAVED_VIEW_DEFINITION: TaskSavedViewDefinition = {
  version: 2,
  filters: [
    { field: "priority", operator: "is_any_of", values: [...DEEP_WORK_PRIORITIES] },
    { field: "estimate", operator: "between", values: ["30", ""] },
  ],
  groupBy: "none",
  sort: { key: "updated", direction: "desc" },
  search: "",
  activeOnly: true,
};

export const QUICK_WINS_SAVED_VIEW_DEFINITION: TaskSavedViewDefinition = {
  version: 2,
  filters: [{ field: "estimate", operator: "between", values: ["", "15"] }],
  groupBy: "none",
  sort: { key: "updated", direction: "desc" },
  search: "",
  activeOnly: true,
};

export const BLOCKED_SAVED_VIEW_DEFINITION: TaskSavedViewDefinition = {
  version: 2,
  filters: [{ field: "status", operator: "is", values: ["blocked"] }],
  groupBy: "none",
  sort: { key: "updated", direction: "desc" },
  search: "",
  activeOnly: true,
};

export const DUE_THIS_WEEK_SAVED_VIEW_DEFINITION: TaskSavedViewDefinition = {
  version: 2,
  filters: [{ field: "due_within_days", operator: "is", values: ["7"] }],
  groupBy: "none",
  sort: { key: "updated", direction: "desc" },
  search: "",
  activeOnly: true,
};

export const DEEP_WORK_SAVED_VIEW_FILTERS = normalizeTaskSavedViewFilters({
  activeTasks: true,
  priority: [...DEEP_WORK_PRIORITIES],
  estimateMinMinutes: 30,
});

export const QUICK_WINS_SAVED_VIEW_FILTERS = normalizeTaskSavedViewFilters({
  activeTasks: true,
  estimateMaxMinutes: 15,
});

export const BLOCKED_SAVED_VIEW_FILTERS = normalizeTaskSavedViewFilters({
  activeTasks: true,
  status: "blocked",
});

export const DUE_THIS_WEEK_SAVED_VIEW_FILTERS = normalizeTaskSavedViewFilters({
  activeTasks: true,
  dueWithinDays: 7,
});

export function getTaskSavedViewNameError(name: string) {
  if (!name) {
    return "Saved view name is required.";
  }

  if (name.length > MAX_TASK_SAVED_VIEW_NAME_LENGTH) {
    return `Saved view name must be ${MAX_TASK_SAVED_VIEW_NAME_LENGTH} characters or fewer.`;
  }

  return null;
}

export function areTaskSavedViewFiltersEqual(
  left: TaskSavedViewFilters,
  right: TaskSavedViewFilters,
) {
  return (
    left.status === right.status &&
    left.projectId === right.projectId &&
    left.goalId === right.goalId &&
    left.dueFilter === right.dueFilter &&
    left.sortValue === right.sortValue &&
    left.activeTasks === right.activeTasks &&
    left.estimateMinMinutes === right.estimateMinMinutes &&
    left.estimateMaxMinutes === right.estimateMaxMinutes &&
    left.dueWithinDays === right.dueWithinDays &&
    left.priorityValues.length === right.priorityValues.length &&
    left.priorityValues.every((value, index) => value === right.priorityValues[index])
  );
}

export function areTaskViewDefinitionsEqual(
  left: TaskViewDefinition,
  right: TaskViewDefinition,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateTaskSavedViewScope(
  filters: TaskSavedViewFilters,
  scope: {
    projectIds: Set<string>;
    goalsById: Map<string, { id: string; projectId: string }>;
  },
) {
  if (filters.projectId && !scope.projectIds.has(filters.projectId)) {
    return "Selected project is unavailable.";
  }

  if (!filters.goalId) {
    return null;
  }

  const goal = scope.goalsById.get(filters.goalId);

  if (!goal) {
    return "Selected goal is unavailable.";
  }

  if (filters.projectId && goal.projectId !== filters.projectId) {
    return "Selected goal does not belong to the chosen project.";
  }

  return null;
}

/**
 * Scope validation for a canonical view. Project/goal filters must reference the
 * owner's own rows; a goal must belong to the selected project when both are
 * present. Everything else is validated by the contract allowlist.
 */
export function validateTaskViewScope(
  view: TaskViewDefinition,
  scope: {
    projectIds: Set<string>;
    goalsById: Map<string, { id: string; projectId: string }>;
  },
): string | null {
  const projectFilter = view.filters.find((filter) => filter.field === "project");
  for (const projectId of projectFilter?.values ?? []) {
    if (!scope.projectIds.has(projectId)) {
      return "Selected project is unavailable.";
    }
  }

  const goalFilter = view.filters.find((filter) => filter.field === "goal");
  for (const goalId of goalFilter?.values ?? []) {
    const goal = scope.goalsById.get(goalId);
    if (!goal) return "Selected goal is unavailable.";
    if (
      projectFilter?.values.length === 1 &&
      goal.projectId !== projectFilter.values[0]
    ) {
      return "Selected goal does not belong to the chosen project.";
    }
  }

  return null;
}

export { taskSortValueToViewSort };
