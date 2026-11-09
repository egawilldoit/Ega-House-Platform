import type {
  GetDailyCheckinResponse,
  SaveDailyCheckinRequest,
  SaveDailyCheckinResponse,
} from "@ega/contracts/checkins";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

/**
 * Typed cross-platform transport for the canonical daily check-in (PO-15,
 * issue #360). Owner identity is derived server-side from the bearer token.
 */
export type CheckinsApi = {
  /** GET /api/checkins?localDate=&timezone= */
  get(localDate: string, timezone: string): Promise<ApiResult<GetDailyCheckinResponse>>;
  /** POST /api/checkins — partial saves merge onto the owner/day record. */
  save(request: SaveDailyCheckinRequest): Promise<ApiResult<SaveDailyCheckinResponse>>;
};

export function createCheckinsApi(http: HttpClient): CheckinsApi {
  return {
    get(localDate, timezone) {
      return http.request<GetDailyCheckinResponse>({
        path: "/api/checkins",
        query: { localDate, timezone },
      });
    },
    save(request) {
      return http.request<SaveDailyCheckinResponse>({
        path: "/api/checkins",
        method: "POST",
        body: request,
      });
    },
  };
}
