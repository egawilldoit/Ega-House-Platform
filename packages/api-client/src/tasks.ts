import type {
  CreateTaskInput,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from "@ega/contracts/mobile";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type TaskListQuery = Readonly<{
  status?: TaskStatus | null;
  projectId?: string | null;
  goalId?: string | null;
  plannedForDate?: string | null;
  includeArchived?: boolean;
  limit?: number | null;
}>;

export type TaskApiReminder = Readonly<{
  id: string;
  taskId: string;
  remindAt: string;
  channel: "email";
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  sentAt: string | null;
  failureReason: string | null;
}>;

export type TaskApiRecurrence = Readonly<{
  id: string;
  taskId: string;
  rule: string;
  anchorDate: string;
  timezone: string;
  nextOccurrenceDate: string;
  lastGeneratedAt: string | null;
}>;

export type TaskApiRecord = Readonly<{
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
  reminders: TaskApiReminder[];
  recurrence: TaskApiRecurrence | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  calendarSyncEnabled?: boolean;
  calendarReminderMinutes?: number;
  completedAt?: string | null;
  createdAt?: string;
}>;

export type TaskUpdateInput = UpdateTaskInput & Readonly<{
  title?: string;
  projectId?: string;
  goalId?: string | null;
}>;

export type TasksApi = {
  list(query?: TaskListQuery): Promise<ApiResult<{ tasks: TaskApiRecord[] }>>;
  get(taskId: string): Promise<ApiResult<TaskApiRecord>>;
  create(input: CreateTaskInput): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
  update(taskId: string, input: TaskUpdateInput): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
  archive(taskId: string): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
  unarchive(taskId: string): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
  createReminder(
    taskId: string,
    remindAt: string,
  ): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
  cancelReminder(
    taskId: string,
    reminderId: string,
  ): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
};

function queryValue(value: string | number | boolean | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export function createTasksApi(http: HttpClient): TasksApi {
  return {
    list(query = {}) {
      return http.request<{ tasks: TaskApiRecord[] }>({
        path: "/api/tasks",
        query: {
          status: queryValue(query.status),
          projectId: queryValue(query.projectId),
          goalId: queryValue(query.goalId),
          plannedForDate: queryValue(query.plannedForDate),
          includeArchived: queryValue(query.includeArchived),
          limit: queryValue(query.limit),
        },
      });
    },

    get(taskId) {
      return http.request<TaskApiRecord>({
        path: `/api/tasks/${encodeURIComponent(taskId)}`,
      });
    },

    create(input) {
      return http.request<{ ok: true; task: TaskApiRecord }>({
        path: "/api/tasks",
        method: "POST",
        body: input,
      });
    },

    update(taskId, input) {
      return http.request<{ ok: true; task: TaskApiRecord }>({
        path: `/api/tasks/${encodeURIComponent(taskId)}`,
        method: "PATCH",
        body: input,
      });
    },

    archive(taskId) {
      return http.request<{ ok: true; task: TaskApiRecord }>({
        path: `/api/tasks/${encodeURIComponent(taskId)}/archive`,
        method: "POST",
      });
    },

    unarchive(taskId) {
      return http.request<{ ok: true; task: TaskApiRecord }>({
        path: `/api/tasks/${encodeURIComponent(taskId)}/unarchive`,
        method: "POST",
      });
    },

    createReminder(taskId, remindAt) {
      return http.request<{ ok: true; task: TaskApiRecord }>({
        path: `/api/tasks/${encodeURIComponent(taskId)}/reminders`,
        method: "POST",
        body: { remindAt },
      });
    },

    cancelReminder(taskId, reminderId) {
      return http.request<{ ok: true; task: TaskApiRecord }>({
        path: `/api/tasks/${encodeURIComponent(taskId)}/reminders/${encodeURIComponent(reminderId)}`,
        method: "PATCH",
        body: { status: "cancelled" },
      });
    },
  };
}
