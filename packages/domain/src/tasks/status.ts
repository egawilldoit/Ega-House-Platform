/**
 * Canonical task statuses.
 *
 * `review` sits between in-progress and done: an agent or PR has produced work
 * that is waiting for the owner's check. It is open (not completed) work, it is
 * not part of the default execution queue, and a timer can only run on it after
 * it returns to `in_progress`.
 */
export const TASK_STATUSES = ["todo", "in_progress", "review", "done", "blocked"] as const;
export const TASK_STATUS_VALUES = TASK_STATUSES;
export const TASK_PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;
export const GOAL_STATUS_VALUES = ["draft", "active", "done", "paused"] as const;
export const PROJECT_STATUS_VALUES = ["planned", "active", "done", "paused", "archived"] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];
export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];
export type GoalStatus = (typeof GOAL_STATUS_VALUES)[number];
export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUS_VALUES.includes(value as TaskStatus);
}

export function isCanonicalTaskStatus(value: string): value is TaskStatus {
  return isTaskStatus(value);
}

export function isTaskCompletedStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "done" || normalized === "complete" || normalized === "completed";
}

export function isTaskCanceledStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "canceled" || normalized === "cancelled";
}

export function isTaskPriority(value: string): value is TaskPriority {
  return TASK_PRIORITY_VALUES.includes(value as TaskPriority);
}

export function isGoalStatus(value: string): value is GoalStatus {
  return GOAL_STATUS_VALUES.includes(value as GoalStatus);
}

export function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUS_VALUES.includes(value as ProjectStatus);
}
