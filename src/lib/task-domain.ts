import { isTaskCompletedStatus } from "@ega/domain";

export {
  GOAL_STATUS_VALUES,
  PROJECT_STATUS_VALUES,
  TASK_PRIORITY_VALUES,
  TASK_STATUSES,
  TASK_STATUS_VALUES,
  isCanonicalTaskStatus,
  isGoalStatus,
  isProjectStatus,
  isTaskCanceledStatus,
  isTaskCompletedStatus,
  isTaskPriority,
  isTaskStatus,
} from "@ega/domain";
export type { GoalStatus, ProjectStatus, TaskPriority, TaskStatus } from "@ega/domain";

export function formatTaskToken(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function getTaskStatusTone(status: string) {
  const normalized = status.toLowerCase();

  if (isTaskCompletedStatus(normalized)) return "success" as const;
  if (["blocked", "cancelled", "canceled"].includes(normalized)) return "danger" as const;
  if (["in progress", "in_progress", "active"].includes(normalized)) return "accent" as const;
  return "neutral" as const;
}
