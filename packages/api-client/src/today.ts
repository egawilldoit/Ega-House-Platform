import type {
  MobileTodayClearCompletedResponse,
  MobileTodayResponse,
  MobileTodayTaskMutationResponse,
  MobileTodayTaskStatusMutationResponse,
  TaskStatus,
} from "@ega/contracts/mobile";
import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type TodayApi = {
  get(date?: string): Promise<ApiResult<MobileTodayResponse>>;
  plan(
    taskId: string,
    date: string,
  ): Promise<ApiResult<MobileTodayTaskMutationResponse>>;
  remove(taskId: string): Promise<ApiResult<MobileTodayTaskMutationResponse>>;
  updateStatus(
    taskId: string,
    status: TaskStatus,
    blockedReason?: string | null,
  ): Promise<ApiResult<MobileTodayTaskStatusMutationResponse>>;
  clearCompleted(date: string): Promise<ApiResult<MobileTodayClearCompletedResponse>>;
};

function encodedId(taskId: string) {
  return encodeURIComponent(taskId);
}

export function createTodayApi(http: HttpClient): TodayApi {
  return {
    get(date) {
      return http.request<MobileTodayResponse>({
        path: "/api/today",
        query: date ? { date } : undefined,
      });
    },
    plan(taskId, date) {
      return http.request<MobileTodayTaskMutationResponse>({
        path: `/api/today/tasks/${encodedId(taskId)}`,
        method: "POST",
        body: { date },
      });
    },
    remove(taskId) {
      return http.request<MobileTodayTaskMutationResponse>({
        path: `/api/today/tasks/${encodedId(taskId)}`,
        method: "DELETE",
      });
    },
    updateStatus(taskId, status, blockedReason) {
      return http.request<MobileTodayTaskStatusMutationResponse>({
        path: `/api/today/tasks/${encodedId(taskId)}/status`,
        method: "PATCH",
        body: blockedReason ? { status, blockedReason } : { status },
      });
    },
    clearCompleted(date) {
      return http.request<MobileTodayClearCompletedResponse>({
        path: "/api/today/clear-completed",
        method: "POST",
        body: { date },
      });
    },
  };
}
