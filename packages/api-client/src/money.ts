import type {
  CreateMoneyPeriodRequest,
  CreateMoneyPeriodResponse,
  CreateMovementRequest,
  CreateMovementResponse,
  GetMoneyStateQuery,
  GetMoneyStateResponse,
  GetMovementResponse,
  ListMovementsQuery,
  ListMovementsResponse,
  UpdateMovementRequest,
  UpdateMovementResponse,
  UpdateMoneySettingsRequest,
  UpdateMoneySettingsResponse,
} from "@ega/contracts/money";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

/**
 * Typed cross-platform transport for Money. Owner identity comes from the
 * bearer token; callers never send an owner id or choose the currency. Period
 * state is the MONEY-03 canonical read; movements are the MONEY-04 ledger
 * surface.
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
  /** GET /api/money/movements - newest booking date first. */
  listMovements(query?: ListMovementsQuery): Promise<ApiResult<ListMovementsResponse>>;
  /** POST /api/money/movements - 201 on create, 200 on idempotent replay. */
  createMovement(request: CreateMovementRequest): Promise<ApiResult<CreateMovementResponse>>;
  /** GET /api/money/movements/:id */
  getMovement(id: string): Promise<ApiResult<GetMovementResponse>>;
  /** PATCH /api/money/movements/:id - requires the current positive `version`. */
  updateMovement(
    id: string,
    request: UpdateMovementRequest,
  ): Promise<ApiResult<UpdateMovementResponse>>;
};

function periodSettingsPath(id: string): string {
  return `/api/money/periods/${encodeURIComponent(id)}/settings`;
}

function movementPath(id: string): string {
  return `/api/money/movements/${encodeURIComponent(id)}`;
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
    listMovements(query) {
      return http.request<ListMovementsResponse>({
        path: "/api/money/movements",
        query: {
          from: query?.from?.trim() || undefined,
          to: query?.to?.trim() || undefined,
          cutoff: query?.cutoff?.trim() || undefined,
          timezone: query?.timezone?.trim() || undefined,
          kind: query?.kind ?? undefined,
          limit: query?.limit === undefined ? undefined : String(query.limit),
          offset: query?.offset === undefined ? undefined : String(query.offset),
        },
      });
    },
    createMovement(request) {
      return http.request<CreateMovementResponse>({
        path: "/api/money/movements",
        method: "POST",
        body: request,
      });
    },
    getMovement(id) {
      return http.request<GetMovementResponse>({ path: movementPath(id) });
    },
    updateMovement(id, request) {
      return http.request<UpdateMovementResponse>({
        path: movementPath(id),
        method: "PATCH",
        body: request,
      });
    },
  };
}
