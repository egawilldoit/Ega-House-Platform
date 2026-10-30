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

/**
 * Canonical status transitions shown by every task surface (board drag, card
 * buttons, tap alternatives).
 *
 * `review` is an explicit hand-off, never an implicit next step: work enters it
 * from in progress and leaves it back to in progress or straight to done.
 * `done` only reopens to `todo`, so a completed task cannot silently re-enter
 * execution and start a timer without an explicit reopen.
 */
export const TASK_STATUS_TRANSITIONS = {
  todo: ["in_progress", "blocked", "done"],
  in_progress: ["todo", "review", "blocked", "done"],
  review: ["in_progress", "blocked", "done"],
  blocked: ["todo", "in_progress", "done"],
  done: ["todo"],
} as const satisfies Record<TaskStatus, readonly TaskStatus[]>;

export function getTaskStatusTransitions(status: string): TaskStatus[] {
  return isTaskStatus(status) ? [...TASK_STATUS_TRANSITIONS[status]] : [];
}

export function isTaskStatusTransitionAllowed(
  from: string,
  to: string,
): to is TaskStatus {
  if (!isTaskStatus(from) || !isTaskStatus(to)) return false;
  return (TASK_STATUS_TRANSITIONS[from] as readonly TaskStatus[]).includes(to);
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
