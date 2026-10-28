import type {
  CreateTaskInput,
  MobileTaskListResponse,
  MobileTaskMutationResponse,
} from "@ega/contracts/mobile";
import type {
  TaskCommentCreateInput,
  TaskCommentDeleteResponse,
  TaskCommentListResponse,
  TaskCommentMutationResponse,
  TaskCommentReactionResponse,
  TaskCommentUpdateInput,
} from "@ega/contracts";
import {
  toTaskViewSearchPairs,
  type TaskDueFilter,
  type TaskSortValue,
  type TaskViewDefinition,
} from "@ega/contracts/common/task-list";
import type { TaskPriority, TaskStatus } from "@ega/domain";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type TaskListQuery = Readonly<{
  status?: TaskStatus | null;
  priority?: TaskPriority | null;
  projectId?: string | null;
  goalId?: string | null;
  plannedForDate?: string | null;
  due?: TaskDueFilter | null;
  sort?: TaskSortValue | null;
  includeArchived?: boolean;
  limit?: number | null;
  /**
   * Canonical view definition shared with the web toolbar and saved views.
   * When present it supersedes the legacy scalar filters above; both surfaces
   * then run the same application filter/sort/group engine.
   */
  view?: TaskViewDefinition | null;
}>;

export type SetTaskRecurrenceInput = Readonly<{
  recurrenceRule: string;
  recurrenceAnchorDate?: string | null;
  recurrenceTimezone?: string | null;
  fallbackAnchorDate: string;
}>;

/**
 * Canonical task transport (`/api/tasks*`). Responses speak the enriched
 * mobile contract: list payloads carry counters, filters, and project/goal
 * form options; detail and mutation payloads carry the full task item.
 */
export type TasksApi = {
  list(query?: TaskListQuery): Promise<ApiResult<MobileTaskListResponse>>;
  get(taskId: string): Promise<ApiResult<MobileTaskMutationResponse>>;
  create(input: CreateTaskInput): Promise<ApiResult<MobileTaskMutationResponse>>;
  update(
    taskId: string,
    input: Record<string, unknown>,
  ): Promise<ApiResult<MobileTaskMutationResponse>>;
  archive(taskId: string): Promise<ApiResult<MobileTaskMutationResponse>>;
  unarchive(taskId: string): Promise<ApiResult<MobileTaskMutationResponse>>;
  pin(taskId: string): Promise<ApiResult<MobileTaskMutationResponse>>;
  unpin(taskId: string): Promise<ApiResult<MobileTaskMutationResponse>>;
  createReminder(taskId: string, remindAt: string, deliveryMode?: "push" | "email" | "both"): Promise<ApiResult<MobileTaskMutationResponse>>;
  cancelReminder(taskId: string, reminderId: string): Promise<ApiResult<MobileTaskMutationResponse>>;
  setRecurrence(taskId: string, input: SetTaskRecurrenceInput): Promise<ApiResult<MobileTaskMutationResponse>>;
  clearRecurrence(taskId: string): Promise<ApiResult<MobileTaskMutationResponse>>;
  listComments(taskId: string): Promise<ApiResult<TaskCommentListResponse>>;
  createComment(
    taskId: string,
    input: TaskCommentCreateInput,
  ): Promise<ApiResult<TaskCommentMutationResponse>>;
  updateComment(
    taskId: string,
    commentId: string,
    input: TaskCommentUpdateInput,
  ): Promise<ApiResult<TaskCommentMutationResponse>>;
  deleteComment(
    taskId: string,
    commentId: string,
  ): Promise<ApiResult<TaskCommentDeleteResponse>>;
  toggleCommentReaction(
    taskId: string,
    commentId: string,
    emoji: string,
  ): Promise<ApiResult<TaskCommentReactionResponse>>;
};

function queryValue(value: string | number | boolean | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function idPath(taskId: string, suffix = "") {
  return `/api/tasks/${encodeURIComponent(taskId)}${suffix}`;
}

export function createTasksApi(http: HttpClient): TasksApi {
  return {
    list(query = {}) {
      const viewPairs = query.view ? toTaskViewSearchPairs(query.view) : [];
      const serialized: Record<string, string | string[] | undefined> = {};
      for (const [key, value] of viewPairs) {
        if (key === "filter") {
          const existing = serialized.filter;
          serialized.filter = Array.isArray(existing)
            ? [...existing, value]
            : existing
              ? [existing, value]
              : [value];
        } else {
          serialized[key] = value;
        }
      }

      return http.request<MobileTaskListResponse>({
        path: "/api/tasks",
        query: {
          ...serialized,
          ...(query.view
            ? {}
            : {
                status: queryValue(query.status),
                priority: queryValue(query.priority),
                due: queryValue(query.due),
                sort: queryValue(query.sort),
              }),
          projectId: queryValue(query.projectId),
          goalId: queryValue(query.goalId),
          plannedForDate: queryValue(query.plannedForDate),
          includeArchived: queryValue(query.includeArchived),
          limit: queryValue(query.limit),
        },
      });
    },
    get(taskId) {
      return http.request<MobileTaskMutationResponse>({ path: idPath(taskId) });
    },
    create(input) {
      return http.request<MobileTaskMutationResponse>({ path: "/api/tasks", method: "POST", body: input });
    },
    update(taskId, input) {
      return http.request<MobileTaskMutationResponse>({ path: idPath(taskId), method: "PATCH", body: input });
    },
    archive(taskId) {
      return http.request<MobileTaskMutationResponse>({ path: idPath(taskId, "/archive"), method: "POST" });
    },
    unarchive(taskId) {
      return http.request<MobileTaskMutationResponse>({ path: idPath(taskId, "/unarchive"), method: "POST" });
    },
    pin(taskId) {
      return http.request<MobileTaskMutationResponse>({ path: idPath(taskId, "/pin"), method: "POST" });
    },
    unpin(taskId) {
      return http.request<MobileTaskMutationResponse>({ path: idPath(taskId, "/unpin"), method: "POST" });
    },
    createReminder(taskId, remindAt, deliveryMode) {
      return http.request<MobileTaskMutationResponse>({
        path: idPath(taskId, "/reminders"),
        method: "POST",
        body: deliveryMode ? { remindAt, deliveryMode } : { remindAt },
      });
    },
    cancelReminder(taskId, reminderId) {
      return http.request<MobileTaskMutationResponse>({
        path: idPath(taskId, `/reminders/${encodeURIComponent(reminderId)}`),
        method: "PATCH",
        body: { status: "cancelled" },
      });
    },
    setRecurrence(taskId, input) {
      return http.request<MobileTaskMutationResponse>({
        path: idPath(taskId, "/recurrence"),
        method: "PUT",
        body: input,
      });
    },
    clearRecurrence(taskId) {
      return http.request<MobileTaskMutationResponse>({
        path: idPath(taskId, "/recurrence"),
        method: "DELETE",
      });
    },
    listComments(taskId) {
      return http.request<TaskCommentListResponse>({
        path: idPath(taskId, "/comments"),
      });
    },
    createComment(taskId, input) {
      return http.request<TaskCommentMutationResponse>({
        path: idPath(taskId, "/comments"),
        method: "POST",
        body: input,
      });
    },
    updateComment(taskId, commentId, input) {
      return http.request<TaskCommentMutationResponse>({
        path: idPath(taskId, `/comments/${encodeURIComponent(commentId)}`),
        method: "PATCH",
        body: input,
      });
    },
    deleteComment(taskId, commentId) {
      return http.request<TaskCommentDeleteResponse>({
        path: idPath(taskId, `/comments/${encodeURIComponent(commentId)}`),
        method: "DELETE",
      });
    },
    toggleCommentReaction(taskId, commentId, emoji) {
      return http.request<TaskCommentReactionResponse>({
        path: idPath(
          taskId,
          `/comments/${encodeURIComponent(commentId)}/reactions`,
        ),
        method: "POST",
        body: { emoji },
      });
    },
  };
}
