import type { TaskStatus } from "@ega/contracts/mobile";
import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";
import type { TaskApiRecord } from "./tasks";

export type TodayApiReadModel = Readonly<{
  date: string;
  tasks: TaskApiRecord[];
  summary: Readonly<{ total: number; completed: number; remaining: number }>;
}>;

export type TodayApi = {
  get(date: string): Promise<ApiResult<TodayApiReadModel>>;
  plan(taskId: string, date: string): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
  remove(taskId: string): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
  updateStatus(taskId: string, status: TaskStatus, blockedReason?: string | null): Promise<ApiResult<{ ok: true; task: TaskApiRecord }>>;
  clearCompleted(date: string): Promise<ApiResult<{ ok: true; clearedCount: number }>>;
};

export function createTodayApi(http: HttpClient): TodayApi {
  return {
    get(date) { return http.request<TodayApiReadModel>({ path: "/api/today", query: { date } }); },
    plan(taskId, date) { return http.request<{ ok: true; task: TaskApiRecord }>({ path: `/api/today/tasks/${encodeURIComponent(taskId)}`, method: "POST", body: { date } }); },
    remove(taskId) { return http.request<{ ok: true; task: TaskApiRecord }>({ path: `/api/today/tasks/${encodeURIComponent(taskId)}`, method: "DELETE" }); },
    updateStatus(taskId, status, blockedReason) { return http.request<{ ok: true; task: TaskApiRecord }>({ path: `/api/today/tasks/${encodeURIComponent(taskId)}/status`, method: "PATCH", body: blockedReason ? { status, blockedReason } : { status } }); },
    clearCompleted(date) { return http.request<{ ok: true; clearedCount: number }>({ path: "/api/today/clear-completed", method: "POST", body: { date } }); },
  };
}
