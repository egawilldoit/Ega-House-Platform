import type { GetTimeContextResponse } from "@ega/contracts/time-context";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

/**
 * Canonical Time Context transport (GET only).
 *
 * Mobile and other native clients resolve the authenticated owner's
 * Time Context through this typed HTTP layer. The call is owner-scoped
 * server-side via the bearer token; callers never supply an owner ID.
 *
 * Query options:
 *   - `timezone` (or `requestedTimezone` alias on the server) — optional IANA
 *     zone to evaluate. Omitted => server uses persisted owner timezone.
 *     Invalid zones fall back to UTC with `fallback: "invalid_timezone"` per
 *     domain contract (not a 400).
 *   - `date` — optional explicit local date (YYYY-MM-DD) for historical
 *     reproducibility. Omitted => server derives localDate from `now`.
 *
 * PUT / persisted timezone mutation remains HITL-gated and is not exposed
 * here. `setTimeContextTimezone` stays tested in application/data-access
 * without a transport write path until product approves overwrite policy.
 */
export type TimeContextQuery = Readonly<{
  timezone?: string | null;
  date?: string | null;
}>;

export type TimeContextApi = {
  /**
   * GET /api/time-context — authenticated, owner-scoped.
   * Returns canonical `TimeContextDto` via `GetTimeContextResponse`.
   * Same owner/timezone/date yields identical web/mobile semantics:
   * DST, midnight adjacency, Asia/Tokyo, server-TZ invariance, and
   * historical reproducibility are proven in domain/application tests
   * and preserved through this transport by forwarding query params
   * verbatim and mapping the contract DTO unchanged.
   */
  get(query?: TimeContextQuery): Promise<ApiResult<GetTimeContextResponse>>;
};

export function createTimeContextApi(http: HttpClient): TimeContextApi {
  return {
    get(query) {
      const timezone = query?.timezone?.trim() || undefined;
      const date = query?.date?.trim() || undefined;
      return http.request<GetTimeContextResponse>({
        path: "/api/time-context",
        query: {
          timezone,
          date,
        },
      });
    },
  };
}
