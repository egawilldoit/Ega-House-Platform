import type { User } from "@supabase/supabase-js";

import type { TaskPriority, TaskStatus } from "@/lib/task-domain";
import type { TaskDueFilter, TaskSortValue } from "@/lib/task-list";

export type { TaskStatus, TaskPriority, TaskDueFilter };

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

export type MobileAuthLogoutResponse = {
  ok: true;
};

export type MobileApiErrorResponse = {
  ok: false;
  error: {
    code: MobileApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type MobileAuthErrorResponse = MobileApiErrorResponse;

export type MobileTaskProject = {
  id: string;
  name: string;
};

export type MobileTaskGoal = {
  id: string;
  title: string;
};

export type MobileTaskListItem = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
  updatedAt: string;
  focusRank: number | null;
  trackedDurationSeconds: number;
  project: MobileTaskProject;
  goal: MobileTaskGoal | null;
};

export type MobileTaskCounters = {
  total: number;
  byStatus: Record<TaskStatus, number>;
  pinned: number;
  overdue: number;
  dueToday: number;
};

export type MobileTaskListFilters = {
  status: TaskStatus | null;
  projectId: string | null;
  goalId: string | null;
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

export type MobileTaskMutationResponse = {
  ok: true;
  task: MobileTaskListItem;
};

export type CreateTaskInput = {
  title: string;
  projectId: string;
  goalId: string | null;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  estimateMinutes: number | null;
};

export type UpdateTaskInput = {
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  estimateMinutes?: number | null;
  description?: string | null;
};

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

export function mapUserToMobileAuthenticatedUser(user: User): MobileAuthenticatedUser {
  return {
    id: user.id,
    email: user.email ?? "",
  };
}
