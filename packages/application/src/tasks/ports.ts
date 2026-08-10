import type { TaskPriority, TaskRecurrenceRule, TaskStatus } from "@ega/domain";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type TaskReminderRecord = Readonly<{
  id: string;
  taskId: string;
  remindAt: string;
  channel: "email";
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  sentAt: string | null;
  failureReason: string | null;
}>;

export type TaskRecurrenceRecord = Readonly<{
  id: string;
  taskId: string;
  rule: TaskRecurrenceRule;
  anchorDate: string;
  timezone: string;
  nextOccurrenceDate: string;
  lastGeneratedAt: string | null;
}>;

export type TaskRecord = Readonly<{
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  projectId: string;
  goalId: string | null;
  plannedForDate: string | null;
  focusRank: number | null;
  archivedAt: string | null;
  updatedAt: string;
  reminders: TaskReminderRecord[];
  recurrence: TaskRecurrenceRecord | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  calendarSyncEnabled?: boolean;
  calendarReminderMinutes?: number;
  completedAt?: string | null;
  createdAt?: string;
  projectName?: string | null;
  goalTitle?: string | null;
  totalDurationMs?: number;
}>;

export type TaskScopeRecord = Readonly<{
  projectIds: string[];
  goals: Array<Readonly<{ id: string; projectId: string }>>;
}>;

export type TaskQuery = Readonly<{
  status?: TaskStatus | null;
  projectId?: string | null;
  goalId?: string | null;
  plannedForDate?: string | null;
  includeArchived?: boolean;
  limit?: number | null;
}>;

export type CreateTaskRecordInput = Readonly<{
  title: string;
  projectId: string;
  goalId: string | null;
  description: string | null;
  blockedReason: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  plannedForDate?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  calendarSyncEnabled?: boolean;
  calendarReminderMinutes?: number;
  recurrence?: Readonly<{
    rule: TaskRecurrenceRule;
    anchorDate: string;
    timezone: string;
    nextOccurrenceDate: string;
  }> | null;
}>;

export type UpdateTaskRecordInput = Readonly<{
  taskId: string;
  title?: string;
  description?: string | null;
  blockedReason?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  projectId?: string;
  goalId?: string | null;
  plannedForDate?: string | null;
  focusRank?: number | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  calendarSyncEnabled?: boolean;
  calendarReminderMinutes?: number;
}>;

export interface TasksRepository {
  getScope(actor: AuthenticatedActor): Promise<RepositoryResult<TaskScopeRecord>>;
  listTasks(actor: AuthenticatedActor, query?: TaskQuery): Promise<RepositoryResult<TaskRecord[]>>;
  getTask(actor: AuthenticatedActor, taskId: string): Promise<RepositoryResult<TaskRecord | null>>;
  createTask(actor: AuthenticatedActor, input: CreateTaskRecordInput): Promise<RepositoryResult<TaskRecord>>;
  updateTask(actor: AuthenticatedActor, input: UpdateTaskRecordInput): Promise<RepositoryResult<TaskRecord>>;
  setTaskArchived(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; archivedAt: string | null }>,
  ): Promise<RepositoryResult<TaskRecord>>;
  createReminder(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; remindAt: string; channel: "email"; status: "pending" }>,
  ): Promise<RepositoryResult<TaskRecord>>;
  cancelReminder(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; reminderId: string; status: "cancelled" }>,
  ): Promise<RepositoryResult<TaskRecord>>;
}
