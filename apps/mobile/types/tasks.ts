import {
  TASK_PRIORITY_VALUES,
  TASK_RECURRENCE_RULE_VALUES,
  TASK_STATUS_VALUES,
  type TaskPriority,
  type TaskRecurrenceRule,
  type TaskStatus,
} from "@ega/domain";
import type {
  MobileTaskCounters,
  MobileTaskListFilters,
  MobileTaskListItem,
  MobileTaskReminder,
  TaskDueFilter,
  TaskSortValue,
  UpdateTaskInput as ContractUpdateTaskInput,
} from "@ega/contracts/mobile";

export type MobileTaskStatus = TaskStatus;
export type MobileTaskPriority = TaskPriority;
export type MobileTaskDueFilter = TaskDueFilter;
export type MobileTaskSortValue = TaskSortValue;
export type MobileTaskRecurrenceRule = TaskRecurrenceRule;
export type UpdateTaskInput = ContractUpdateTaskInput;
export type UpdateMobileTaskInput = ContractUpdateTaskInput;

export type {
  CancelTaskReminderInput,
  CreateTaskInput,
  CreateTaskReminderInput,
  MobileTaskCounters,
  MobileTaskGoal,
  MobileTaskListFilters,
  MobileTaskListItem,
  MobileTaskListResponse,
  MobileTaskMutationResponse,
  MobileTaskProject,
  MobileTaskRecurrence,
  MobileTaskReminder,
} from "@ega/contracts/mobile";

/**
 * View-model shapes produced by the canonical tasks adapter
 * (lib/api/tasks.ts). Fields the canonical TaskApiRecord cannot supply stay
 * optional instead of being invented:
 *
 *   - trackedDurationSeconds: canonical record has no tracked-time data.
 *   - project.name / goal.title: canonical record only carries the raw ids.
 *   - reminders[].createdAt/updatedAt: canonical reminder rows omit them.
 */
export type MobileTaskProjectView = { id: string; name?: string };
export type MobileTaskGoalView = { id: string; title?: string };
export type MobileTaskReminderView = Omit<MobileTaskReminder, "createdAt" | "updatedAt"> & {
  createdAt?: string;
  updatedAt?: string;
};
export type MobileTaskListItemView = Omit<
  MobileTaskListItem,
  "trackedDurationSeconds" | "project" | "goal" | "reminders"
> & {
  trackedDurationSeconds?: number;
  project: MobileTaskProjectView;
  goal: MobileTaskGoalView | null;
  reminders: MobileTaskReminderView[];
};
export type MobileTaskListViewResponse = {
  ok: true;
  tasks: MobileTaskListItemView[];
  counters: MobileTaskCounters;
  filters: MobileTaskListFilters;
  projects: MobileTaskProjectView[];
  goals: MobileTaskGoalView[];
};

export const MOBILE_TASK_RECURRENCE_RULE_VALUES =
  TASK_RECURRENCE_RULE_VALUES as readonly MobileTaskRecurrenceRule[];

export const MOBILE_TASK_STATUS_VALUES = TASK_STATUS_VALUES as readonly MobileTaskStatus[];
export const MOBILE_TASK_PRIORITY_VALUES = TASK_PRIORITY_VALUES as readonly MobileTaskPriority[];
