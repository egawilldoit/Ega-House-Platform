import {
  DEFAULT_TASK_DUE_FILTER,
  DEFAULT_TASK_SORT,
  isTaskDueFilter,
  isTaskSortValue,
  type TaskDueFilter,
  type TaskSortValue,
} from "@/lib/task-list";
import {
  isTaskPriority,
  isTaskStatus,
  type TaskPriority,
} from "@/lib/task-domain";

export const MAX_TASK_SAVED_VIEW_NAME_LENGTH = 80;
export const DEEP_WORK_SAVED_VIEW_ID = "default:deep-work";

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
};

export type TaskSavedViewDefinition = {
  version: 1;
  filters: {
    activeTasks?: boolean;
    priority?: TaskPriority[];
    estimateMinMinutes?: number;
  };
};

export function normalizeTaskSavedViewFilters(input: {
  status?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  dueFilter?: string | null;
  sortValue?: string | null;
  activeTasks?: boolean | null;
  priority?: string | ReadonlyArray<string> | null;
  estimateMinMinutes?: string | number | null;
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

  return {
    status: status && isTaskStatus(status) ? status : null,
    projectId: projectId || null,
    goalId: goalId || null,
    dueFilter: isTaskDueFilter(dueFilter) ? dueFilter : DEFAULT_TASK_DUE_FILTER,
    sortValue: isTaskSortValue(sortValue) ? sortValue : DEFAULT_TASK_SORT,
    activeTasks: input.activeTasks === true,
    priorityValues,
    estimateMinMinutes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeTaskSavedViewDefinition(
  rawDefinition: unknown,
): TaskSavedViewDefinition | null {
  if (!isRecord(rawDefinition)) {
    return null;
  }

  const filters = isRecord(rawDefinition.filters) ? rawDefinition.filters : null;
  if (!filters) {
    return null;
  }

  const activeTasks = filters.activeTasks === true;
  const priority = Array.isArray(filters.priority)
    ? Array.from(
        new Set(filters.priority.filter((value): value is TaskPriority =>
          typeof value === "string" && isTaskPriority(value),
        )),
      )
    : [];
  const estimateMinMinutes = Number(filters.estimateMinMinutes);
  const normalizedEstimateMinMinutes =
    Number.isSafeInteger(estimateMinMinutes) && estimateMinMinutes > 0
      ? estimateMinMinutes
      : undefined;

  const allowedPriority =
    priority.length === DEEP_WORK_PRIORITIES.length &&
    DEEP_WORK_PRIORITIES.every((value) => priority.includes(value));
  const isDeepWorkDefinition =
    activeTasks &&
    allowedPriority &&
    normalizedEstimateMinMinutes === 30;

  if (!isDeepWorkDefinition) {
    return null;
  }

  return {
    version: 1,
    filters: {
      activeTasks: true,
      priority: [...DEEP_WORK_PRIORITIES],
      estimateMinMinutes: 30,
    },
  };
}

export function getTaskSavedViewFiltersFromDefinition(
  definition: TaskSavedViewDefinition | null,
): Partial<TaskSavedViewFilters> {
  if (!definition) {
    return {};
  }

  return {
    activeTasks: definition.filters.activeTasks === true,
    priorityValues: [...(definition.filters.priority ?? [])],
    estimateMinMinutes: definition.filters.estimateMinMinutes ?? null,
  };
}

export function getTaskSavedViewDefinitionFromFilters(
  filters: TaskSavedViewFilters,
): TaskSavedViewDefinition | null {
  const allowedPriority =
    filters.priorityValues.length === DEEP_WORK_PRIORITIES.length &&
    DEEP_WORK_PRIORITIES.every((value) => filters.priorityValues.includes(value));

  if (filters.activeTasks && allowedPriority && filters.estimateMinMinutes === 30) {
    return {
      version: 1,
      filters: {
        activeTasks: true,
        priority: [...DEEP_WORK_PRIORITIES],
        estimateMinMinutes: 30,
      },
    };
  }

  return null;
}

export const DEEP_WORK_SAVED_VIEW_DEFINITION = {
  version: 1,
  filters: {
    activeTasks: true,
    priority: [...DEEP_WORK_PRIORITIES],
    estimateMinMinutes: 30,
  },
} satisfies TaskSavedViewDefinition;

export const DEEP_WORK_SAVED_VIEW_FILTERS = normalizeTaskSavedViewFilters({
  activeTasks: true,
  priority: [...DEEP_WORK_PRIORITIES],
  estimateMinMinutes: 30,
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
    left.priorityValues.length === right.priorityValues.length &&
    left.priorityValues.every((value, index) => value === right.priorityValues[index])
  );
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
