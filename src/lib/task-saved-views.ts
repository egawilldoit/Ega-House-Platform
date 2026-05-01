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
  type TaskStatus,
} from "@/lib/task-domain";

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

export type TaskSavedViewDefinition = {
  version: 1;
  filters: {
    activeTasks?: boolean;
    status?: TaskStatus;
    priority?: TaskPriority[];
    estimateMinMinutes?: number;
    estimateMaxMinutes?: number;
    dueWithinDays?: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeTaskSavedViewDefinition(
  rawDefinition: unknown,
): TaskSavedViewDefinition | null {
  if (!isRecord(rawDefinition)) {
    return null;
  }

  if (rawDefinition.version !== 1) {
    return null;
  }

  const filters = isRecord(rawDefinition.filters) ? rawDefinition.filters : null;
  if (!filters) {
    return null;
  }

  const allowedFilterKeys = new Set([
    "activeTasks",
    "status",
    "priority",
    "estimateMinMinutes",
    "estimateMaxMinutes",
    "dueWithinDays",
  ]);
  if (Object.keys(filters).some((key) => !allowedFilterKeys.has(key))) {
    return null;
  }

  const activeTasks = filters.activeTasks === true;
  const status = typeof filters.status === "string" && isTaskStatus(filters.status)
    ? filters.status
    : null;
  if (filters.status !== undefined && !status) {
    return null;
  }
  const priority = Array.isArray(filters.priority)
    ? Array.from(
        new Set(filters.priority.filter((value): value is TaskPriority =>
          typeof value === "string" && isTaskPriority(value),
        )),
      )
    : [];
  if (filters.priority !== undefined) {
    if (!Array.isArray(filters.priority) || priority.length !== filters.priority.length) {
      return null;
    }
  }
  const estimateMinMinutes =
    typeof filters.estimateMinMinutes === "number" ? filters.estimateMinMinutes : NaN;
  const normalizedEstimateMinMinutes =
    Number.isSafeInteger(estimateMinMinutes) && estimateMinMinutes > 0
      ? estimateMinMinutes
      : undefined;
  if (filters.estimateMinMinutes !== undefined && !normalizedEstimateMinMinutes) {
    return null;
  }
  const estimateMaxMinutes =
    typeof filters.estimateMaxMinutes === "number" ? filters.estimateMaxMinutes : NaN;
  const normalizedEstimateMaxMinutes =
    Number.isSafeInteger(estimateMaxMinutes) && estimateMaxMinutes > 0
      ? estimateMaxMinutes
      : undefined;
  if (filters.estimateMaxMinutes !== undefined && !normalizedEstimateMaxMinutes) {
    return null;
  }
  const dueWithinDays =
    typeof filters.dueWithinDays === "number" ? filters.dueWithinDays : NaN;
  const normalizedDueWithinDays =
    Number.isSafeInteger(dueWithinDays) && dueWithinDays > 0 ? dueWithinDays : undefined;
  if (filters.dueWithinDays !== undefined && !normalizedDueWithinDays) {
    return null;
  }

  const allowedPriority =
    priority.length === DEEP_WORK_PRIORITIES.length &&
    DEEP_WORK_PRIORITIES.every((value) => priority.includes(value));
  const isDeepWorkDefinition =
    activeTasks &&
    !status &&
    allowedPriority &&
    normalizedEstimateMinMinutes === 30 &&
    normalizedEstimateMaxMinutes === undefined &&
    normalizedDueWithinDays === undefined;
  const isQuickWinsDefinition =
    activeTasks &&
    !status &&
    priority.length === 0 &&
    normalizedEstimateMinMinutes === undefined &&
    normalizedEstimateMaxMinutes === 15 &&
    normalizedDueWithinDays === undefined;
  const isBlockedDefinition =
    activeTasks &&
    status === "blocked" &&
    priority.length === 0 &&
    normalizedEstimateMinMinutes === undefined &&
    normalizedEstimateMaxMinutes === undefined &&
    normalizedDueWithinDays === undefined;
  const isDueThisWeekDefinition =
    activeTasks &&
    !status &&
    priority.length === 0 &&
    normalizedEstimateMinMinutes === undefined &&
    normalizedEstimateMaxMinutes === undefined &&
    normalizedDueWithinDays === 7;

  if (isDeepWorkDefinition) {
    return DEEP_WORK_SAVED_VIEW_DEFINITION;
  }

  if (isQuickWinsDefinition) {
    return QUICK_WINS_SAVED_VIEW_DEFINITION;
  }

  if (isBlockedDefinition) {
    return BLOCKED_SAVED_VIEW_DEFINITION;
  }

  if (isDueThisWeekDefinition) {
    return DUE_THIS_WEEK_SAVED_VIEW_DEFINITION;
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

export const QUICK_WINS_SAVED_VIEW_DEFINITION = {
  version: 1,
  filters: {
    activeTasks: true,
    estimateMaxMinutes: 15,
  },
} satisfies TaskSavedViewDefinition;

export const BLOCKED_SAVED_VIEW_DEFINITION = {
  version: 1,
  filters: {
    activeTasks: true,
    status: "blocked",
  },
} satisfies TaskSavedViewDefinition;

export const DUE_THIS_WEEK_SAVED_VIEW_DEFINITION = {
  version: 1,
  filters: {
    activeTasks: true,
    dueWithinDays: 7,
  },
} satisfies TaskSavedViewDefinition;

export function getTaskSavedViewFiltersFromDefinition(
  definition: TaskSavedViewDefinition | null,
): Partial<TaskSavedViewFilters> {
  if (!definition) {
    return {};
  }

  if (definition === DEEP_WORK_SAVED_VIEW_DEFINITION) {
    return {
      activeTasks: true,
      priorityValues: [...DEEP_WORK_PRIORITIES],
      estimateMinMinutes: 30,
    };
  }

  if (definition === QUICK_WINS_SAVED_VIEW_DEFINITION) {
    return {
      activeTasks: true,
      estimateMaxMinutes: 15,
    };
  }

  if (definition === BLOCKED_SAVED_VIEW_DEFINITION) {
    return {
      activeTasks: true,
      status: "blocked",
    };
  }

  if (definition === DUE_THIS_WEEK_SAVED_VIEW_DEFINITION) {
    return {
      activeTasks: true,
      dueWithinDays: 7,
    };
  }

  const normalized = normalizeTaskSavedViewDefinition(definition);
  if (!normalized) {
    return {};
  }

  return getTaskSavedViewFiltersFromDefinition(normalized);
}

function hasDeepWorkPriority(filters: TaskSavedViewFilters) {
  return (
    filters.priorityValues.length === DEEP_WORK_PRIORITIES.length &&
    DEEP_WORK_PRIORITIES.every((value) => filters.priorityValues.includes(value))
  );
}

export function getTaskSavedViewDefinitionFromFilters(
  filters: TaskSavedViewFilters,
): TaskSavedViewDefinition | null {
  if (
    filters.activeTasks &&
    filters.status === null &&
    hasDeepWorkPriority(filters) &&
    filters.estimateMinMinutes === 30 &&
    filters.estimateMaxMinutes === null &&
    filters.dueWithinDays === null
  ) {
    return DEEP_WORK_SAVED_VIEW_DEFINITION;
  }

  if (
    filters.activeTasks &&
    filters.status === null &&
    filters.priorityValues.length === 0 &&
    filters.estimateMinMinutes === null &&
    filters.estimateMaxMinutes === 15 &&
    filters.dueWithinDays === null
  ) {
    return QUICK_WINS_SAVED_VIEW_DEFINITION;
  }

  if (
    filters.activeTasks &&
    filters.status === "blocked" &&
    filters.priorityValues.length === 0 &&
    filters.estimateMinMinutes === null &&
    filters.estimateMaxMinutes === null &&
    filters.dueWithinDays === null
  ) {
    return BLOCKED_SAVED_VIEW_DEFINITION;
  }

  if (
    filters.activeTasks &&
    filters.status === null &&
    filters.priorityValues.length === 0 &&
    filters.estimateMinMinutes === null &&
    filters.estimateMaxMinutes === null &&
    filters.dueWithinDays === 7
  ) {
    return DUE_THIS_WEEK_SAVED_VIEW_DEFINITION;
  }

  return null;
}

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
