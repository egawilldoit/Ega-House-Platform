import type {
  CreateMoneyPeriodRequest,
  CreateMoneyPeriodResponse,
  GetMoneyStateQuery,
  GetMoneyStateResponse,
  UpdateMoneySettingsRequest,
  UpdateMoneySettingsResponse,
} from "@ega/contracts/money";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

/**
 * Typed cross-platform transport for Money period state. Owner identity comes
 * from the bearer token; callers never send an owner id or choose currency.
 */
export type MoneyApi = {
  /** GET /api/money/state - actual local today plus the tracking context. */
  state(query?: GetMoneyStateQuery): Promise<ApiResult<GetMoneyStateResponse>>;
  /** POST /api/money/periods - inclusive period with optional known opening. */
  createPeriod(
    request: CreateMoneyPeriodRequest,
  ): Promise<ApiResult<CreateMoneyPeriodResponse>>;
  /** PATCH /api/money/periods/:id/settings - requires the current version. */
  updateSettings(
    id: string,
    request: UpdateMoneySettingsRequest,
  ): Promise<ApiResult<UpdateMoneySettingsResponse>>;
};

function periodSettingsPath(id: string): string {
  return `/api/money/periods/${encodeURIComponent(id)}/settings`;
}

export function createMoneyApi(http: HttpClient): MoneyApi {
  return {
    state(query) {
      return http.request<GetMoneyStateResponse>({
        path: "/api/money/state",
        query: {
          periodId: query?.periodId?.trim() || undefined,
          date: query?.date?.trim() || undefined,
          mode: query?.mode ?? undefined,
        },
      });
    },
    createPeriod(request) {
      return http.request<CreateMoneyPeriodResponse>({
        path: "/api/money/periods",
        method: "POST",
        body: request,
      });
    },
    updateSettings(id, request) {
      return http.request<UpdateMoneySettingsResponse>({
        path: periodSettingsPath(id),
        method: "PATCH",
        body: request,
      });
    },
  };
}
