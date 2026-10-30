import type { TaskPriority, TaskRecurrenceRule, TaskStatus } from "@ega/domain";
import type {
  TaskDueFilter,
  TaskSortValue,
  TaskViewDefinition,
} from "@ega/contracts/common/task-list";

import type { AuthenticatedActor } from "../auth/actor";
import type { RepositoryResult } from "../shared/result";

export type TaskReminderRecord = Readonly<{
  id: string;
  taskId: string;
  remindAt: string;
  channel: "email";
  deliveryMode?: "push" | "email" | "both";
  status: "pending" | "processing" | "sent" | "failed" | "cancelled" | "processed";
  sentAt: string | null;
  failureReason: string | null;
  source?: string | null;
  sourceId?: string | null;
  createdAt?: string;
  updatedAt?: string;
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
  boardRank?: string | null;
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
  projectSlug?: string | null;
  goalTitle?: string | null;
  totalDurationSeconds?: number;
}>;

export type TaskProjectOptionRecord = Readonly<{
  id: string;
  name: string;
  slug: string | null;
}>;

export type TaskGoalOptionRecord = Readonly<{
  id: string;
  title: string;
  projectId: string;
}>;

export type TaskScopeRecord = Readonly<{
  projectIds: string[];
  goals: Array<Readonly<{ id: string; projectId: string }>>;
}>;

export type TaskQuery = Readonly<{
  status?: TaskStatus | null;
  priority?: TaskPriority | null;
  projectId?: string | null;
  goalId?: string | null;
  plannedForDate?: string | null;
  /** Owner canonical local date for due-bucket pushdown. */
  today?: string | null;
  due?: TaskDueFilter | null;
  sort?: TaskSortValue | null;
  includeArchived?: boolean;
  limit?: number | null;
  /**
   * Canonical view definition. When present it supersedes the legacy scalar
   * filters above; adapters may use it to push allow-listed predicates into the
   * database before the application read model applies the same semantics.
   */
  view?: TaskViewDefinition | null;
  /**
   * Exact owner-scoped count of tasks matching the query, when the adapter can
   * supply it. Lets the read model distinguish loaded rows from total matches.
   */
  totalCount?: number | null;
}>;

export type CreateTaskRecordInput = Readonly<{
  /** Optional deterministic id for inbox conversion idempotency; when omitted, DB generates random. */
  id?: string;
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
  mcpOperationId?: string;
  mcpClientId?: string;
  recurrence?: Readonly<{
    rule: TaskRecurrenceRule;
    anchorDate: string;
    timezone: string;
    nextOccurrenceDate: string;
  }> | null;
}>;

export type UpdateTaskRecordInput = Readonly<{
  taskId: string;
  /** Reject the write when the persisted task changed since this version was read. */
  expectedUpdatedAt?: string;
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
  /**
   * Exact owner-scoped count for the same query `listTasks` would run. Optional
   * so existing adapters/test doubles keep compiling; when absent the read
   * model reports the loaded filtered count and marks truncation from the page.
   */
  countTasks?(actor: AuthenticatedActor, query?: TaskQuery): Promise<RepositoryResult<number>>;
  listProjectOptions(actor: AuthenticatedActor): Promise<RepositoryResult<TaskProjectOptionRecord[]>>;
  listGoalOptions(actor: AuthenticatedActor): Promise<RepositoryResult<TaskGoalOptionRecord[]>>;
  getTask(actor: AuthenticatedActor, taskId: string): Promise<RepositoryResult<TaskRecord | null>>;
  createTask(actor: AuthenticatedActor, input: CreateTaskRecordInput): Promise<RepositoryResult<TaskRecord>>;
  updateTask(actor: AuthenticatedActor, input: UpdateTaskRecordInput): Promise<RepositoryResult<TaskRecord>>;
  setTaskArchived(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; archivedAt: string | null }>,
  ): Promise<RepositoryResult<TaskRecord>>;
  createReminder(
    actor: AuthenticatedActor,
    input: Readonly<{
      taskId: string;
      remindAt: string;
      channel: "email";
      status: "pending";
      mcpOperationId?: string;
      mcpClientId?: string;
      deliveryMode?: "push" | "email" | "both";
      source?: string | null;
      sourceId?: string | null;
    }>,
  ): Promise<RepositoryResult<TaskRecord>>;
  findReminderByOperation(
    actor: AuthenticatedActor,
    input: Readonly<{ mcpOperationId: string; mcpClientId: string }>,
  ): Promise<RepositoryResult<TaskRecord | null>>;
  cancelReminder(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; reminderId: string; status: "cancelled" }>,
  ): Promise<RepositoryResult<TaskRecord>>;
  /** Resolves the task's focus rank; `exists` is false when the task is absent. */
  getFocusRank(
    actor: AuthenticatedActor,
    taskId: string,
  ): Promise<RepositoryResult<{ exists: boolean; focusRank: number | null }>>;
  /** Highest focus rank currently assigned, or null when no task is pinned. */
  getMaxFocusRank(
    actor: AuthenticatedActor,
    input: Readonly<{ includeArchived: boolean }>,
  ): Promise<RepositoryResult<number | null>>;
  setFocusRank(
    actor: AuthenticatedActor,
    input: Readonly<{ taskId: string; focusRank: number | null }>,
  ): Promise<RepositoryResult<void>>;
}
