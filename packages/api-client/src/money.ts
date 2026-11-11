import type {
  CreateMovementRequest,
  CreateMovementResponse,
  GetMoneyStateQuery,
  GetMoneyStateResponse,
  GetMovementResponse,
  ListMovementsQuery,
  ListMovementsResponse,
  UpdateMovementRequest,
  UpdateMovementResponse,
} from "@ega/contracts/money";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

/**
 * Typed cross-platform transport for the MONEY-04 movement ledger. Owner
 * identity is derived server-side from the bearer token; callers never send an
 * owner id or choose the currency.
 */
export type MoneyApi = {
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
  /** GET /api/money/state - recorded cash, cutoff, period and completeness. */
  getState(query?: GetMoneyStateQuery): Promise<ApiResult<GetMoneyStateResponse>>;
};

function movementPath(id: string): string {
  return `/api/money/movements/${encodeURIComponent(id)}`;
}

export function createMoneyApi(http: HttpClient): MoneyApi {
  return {
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
    getState(query) {
      return http.request<GetMoneyStateResponse>({
        path: "/api/money/state",
        query: {
          cutoff: query?.cutoff?.trim() || undefined,
          timezone: query?.timezone?.trim() || undefined,
        },
      });
    },
  };
}
