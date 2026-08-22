import type {
  TimerStartResponse,
  TimerStopResponse,
  TimerWorkspaceState,
} from "@ega/contracts/mobile";
import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type TimerApi = {
  workspace(): Promise<ApiResult<TimerWorkspaceState>>;
  start(taskId: string): Promise<ApiResult<TimerStartResponse>>;
  stop(sessionId?: string): Promise<ApiResult<TimerStopResponse>>;
};

export function createTimerApi(http: HttpClient): TimerApi {
  return {
    workspace() {
      return http.request<TimerWorkspaceState>({ path: "/api/timer/workspace" });
    },
    start(taskId) {
      return http.request<TimerStartResponse>({
        path: "/api/timer/start",
        method: "POST",
        body: { taskId },
      });
    },
    stop(sessionId) {
      return http.request<TimerStopResponse>({
        path: "/api/timer/stop",
        method: "POST",
        body: sessionId ? { sessionId } : {},
      });
    },
  };
}
