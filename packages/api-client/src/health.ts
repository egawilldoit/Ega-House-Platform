import type { HealthSnapshotResponse } from "@ega/contracts";
import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type HealthApi = {
  getSnapshot(input?: { timezone?: string; includeOpenSessions?: boolean }): Promise<ApiResult<HealthSnapshotResponse>>;
};

export function createHealthApi(http: HttpClient): HealthApi {
  return {
    getSnapshot(input) {
      const query: Record<string, string | undefined> = {};
      if (input?.timezone) query.timezone = input.timezone;
      if (input?.includeOpenSessions !== undefined) query.includeOpenSessions = String(input.includeOpenSessions);
      return http.request<HealthSnapshotResponse>({
        path: "/api/health/snapshot",
        query: Object.keys(query).length > 0 ? query : undefined,
      });
    },
  };
}
