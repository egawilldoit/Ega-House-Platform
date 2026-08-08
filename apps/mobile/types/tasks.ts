import {
  TASK_PRIORITY_VALUES,
  TASK_RECURRENCE_RULE_VALUES,
  TASK_STATUS_VALUES,
  type TaskPriority,
  type TaskRecurrenceRule,
  type TaskStatus,
} from "@ega/domain";
import type {
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

export const MOBILE_TASK_RECURRENCE_RULE_VALUES =
  TASK_RECURRENCE_RULE_VALUES as readonly MobileTaskRecurrenceRule[];

export const MOBILE_TASK_STATUS_VALUES = TASK_STATUS_VALUES as readonly MobileTaskStatus[];
export const MOBILE_TASK_PRIORITY_VALUES = TASK_PRIORITY_VALUES as readonly MobileTaskPriority[];
