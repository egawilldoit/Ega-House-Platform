import type { GetWeeklyReviewResponse } from "@ega/contracts/weekly-review";
import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type WeeklyReviewApi = {
  get(weekOf?: string): Promise<ApiResult<GetWeeklyReviewResponse>>;
};

export function createWeeklyReviewApi(http: HttpClient): WeeklyReviewApi {
  return {
    get(weekOf) {
      return http.request<GetWeeklyReviewResponse>({
        path: "/api/review",
        query: weekOf ? { weekOf } : undefined,
      });
    },
  };
}
