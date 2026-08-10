import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";
import type { TaskApiRecord } from "./tasks";

export type TodayApiReadModel = Readonly<{
  date: string;
  tasks: TaskApiRecord[];
  summary: Readonly<{
    total: number;
    completed: number;
    remaining: number;
  }>;
}>;

export type TodayApi = {
  get(date: string): Promise<ApiResult<TodayApiReadModel>>;
};

export function createTodayApi(http: HttpClient): TodayApi {
  return {
    get(date) {
      return http.request<TodayApiReadModel>({
        path: "/api/today",
        query: { date },
      });
    },
  };
}
