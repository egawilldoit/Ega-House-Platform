import type { TaskPriority, TaskRecurrenceRule, TaskStatus } from "@ega/domain";

import type { TaskDueFilter, TaskSortValue } from "./common/task-list";
import type { OperatorSnapshotDto } from "./operator";

export type { TaskPriority, TaskStatus, TaskDueFilter, TaskSortValue };

export type MobileApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "INVALID_CREDENTIALS"
  | "SESSION_EXPIRED"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export type MobileAuthenticatedUser = {
  id: string;
  email: string;
};

export type MobileSessionPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type MobileAuthSessionResponse = {
  ok: true;
  user: MobileAuthenticatedUser;
  session: MobileSessionPayload;
};

export type MobileAuthRefreshResponse = {
  ok: true;
  session: MobileSessionPayload;
  user?: MobileAuthenticatedUser;
};

export type MobileAuthLogoutResponse = { ok: true };

export type MobileApiErrorResponse = {
  ok: false;
  error: {
    code: MobileApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type MobileAuthErrorResponse = MobileApiErrorResponse;

export type MobileTaskProject = { id: string; name: string; slug: string | null };
export type MobileTaskGoal = { id: string; title: string };

export type MobileTaskReminder = {
  id: string;
  taskId: string;
  remindAt: string;
  channel: "email";
  deliveryMode?: "push" | "email" | "both";
  status: "pending" | "processing" | "sent" | "failed" | "cancelled" | "processed";
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MobileTaskRecurrence = {
  rule: TaskRecurrenceRule;
  anchorDate: string;
  timezone: string;
  nextOccurrenceDate: string;
  lastGeneratedAt: string | null;
};

export type MobileTaskListItem = {
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  updatedAt: string;
  focusRank: number | null;
  trackedDurationSeconds: number;
  project: MobileTaskProject;
  goal: MobileTaskGoal | null;
  reminders: MobileTaskReminder[];
  recurrence: MobileTaskRecurrence | null;
};

export type MobileTaskCounters = {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<TaskPriority, number>;
  pinned: number;
  overdue: number;
  dueToday: number;
};

export type MobileTaskListFilters = {
  status: TaskStatus | null;
  projectId: string | null;
  goalId: string | null;
  priority: TaskPriority | null;
  due: TaskDueFilter;
  sort: TaskSortValue;
  limit: number | null;
};

export type MobileTaskListResponse = {
  ok: true;
  tasks: MobileTaskListItem[];
  counters: MobileTaskCounters;
  filters: MobileTaskListFilters;
  projects: MobileTaskProject[];
  goals: MobileTaskGoal[];
};

export type MobileTaskMutationResponse = { ok: true; task: MobileTaskListItem };

export type MobileTodayTaskItem = {
  id: string;
  title: string;
  description: string | null;
  blockedReason: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  updatedAt: string;
  focusRank: number | null;
  plannedForDate: string | null;
  projectName: string;
  projectSlug: string | null;
  goalTitle: string | null;
  hasActiveTimer: boolean;
  isDueToday: boolean;
  isPlannedForToday: boolean;
  dueBucket: "none" | "overdue" | "today" | "soon" | "scheduled";
};

export type MobileTodaySummary = {
  plannedCount: number;
  inProgressCount: number;
  blockedCount: number;
  completedCount: number;
  selectedCount: number;
  clearableCompletedCount: number;
  overdueCount: number;
  dueTodayCount: number;
  totalEstimateMinutes: number;
  trackedTodaySeconds: number;
  trackedTodayLabel: string;
};

/**
 * GET /api/today response body.
 *
 * Today is served by the Operator snapshot use case. Keep the historical
 * mobile name as a type alias so native callers and the server share the
 * same response authority instead of maintaining a narrower shadow DTO.
 */
export type MobileTodayResponse = OperatorSnapshotDto;

export type MobileTodayTaskStatusMutationResponse = {
  ok: true;
  taskId: string;
  status: TaskStatus;
};

export type MobileTodayTaskMutationResponse = { ok: true; taskId: string };
export type MobileTodayClearCompletedResponse = { ok: true };

export type CreateTaskInput = {
  title: string;
  projectId: string;
  goalId: string | null;
  description: string | null;
  blockedReason: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  recurrenceRule?: TaskRecurrenceRule | null;
  recurrenceAnchorDate?: string | null;
  recurrenceTimezone?: string | null;
};

export type UpdateTaskInput = {
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  description?: string | null;
  blockedReason?: string | null;
  recurrenceRule?: TaskRecurrenceRule | null;
  recurrenceAnchorDate?: string | null;
  recurrenceTimezone?: string | null;
};

export type CreateTaskReminderInput = { remindAt: string; deliveryMode?: "push" | "email" | "both" };
export type CancelTaskReminderInput = { reminderId: string };

export type TimerSessionSummary = {
  trackedTodaySeconds: number;
  trackedTodayLabel: string;
  trackedTotalSeconds: number;
  trackedTotalLabel: string;
  sessionsTodayCount: number;
  longestSessionSeconds: number | null;
  longestSessionLabel: string | null;
  longestSessionTaskTitle: string | null;
};

export type TimerWorkspaceState = {
  activeSession: {
    sessionId: string;
    taskId: string;
    startedAt: string;
    elapsedLabel: string;
    taskTitle: string;
  } | null;
  summary: TimerSessionSummary;
};

export type TimerActiveSession = NonNullable<TimerWorkspaceState["activeSession"]>;

export type TimerStartResponse = { ok: true; activeSession: TimerActiveSession };
export type TimerStopResponse = { ok: true; sessionId: string; taskId: string };
