import type {
  CreateExpenseRequest,
  CreateExpenseResponse,
  DeleteExpenseResponse,
  GetExpenseResponse,
  ListExpensesQuery,
  ListExpensesResponse,
  UpdateExpenseRequest,
  UpdateExpenseResponse,
} from "@ega/contracts/expenses";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

/**
 * Typed cross-platform transport for the owner-scoped expense ledger.
 * Owner identity is derived server-side from the bearer token; callers never
 * send an owner id or choose the currency.
 */
export type ExpensesApi = {
  /** GET /api/expenses - newest first, softly deleted rows excluded. */
  list(query?: ListExpensesQuery): Promise<ApiResult<ListExpensesResponse>>;
  /** POST /api/expenses - 201 on create, 200 on idempotent replay. */
  create(request: CreateExpenseRequest): Promise<ApiResult<CreateExpenseResponse>>;
  /** GET /api/expenses/:id */
  get(id: string): Promise<ApiResult<GetExpenseResponse>>;
  /** PATCH /api/expenses/:id - requires the current positive `version`. */
  update(
    id: string,
    request: UpdateExpenseRequest,
  ): Promise<ApiResult<UpdateExpenseResponse>>;
  /** DELETE /api/expenses/:id - idempotent soft delete. */
  remove(id: string): Promise<ApiResult<DeleteExpenseResponse>>;
};

function expensePath(id: string): string {
  return `/api/expenses/${encodeURIComponent(id)}`;
}

export function createExpensesApi(http: HttpClient): ExpensesApi {
  return {
    list(query) {
      return http.request<ListExpensesResponse>({
        path: "/api/expenses",
        query: {
          from: query?.from?.trim() || undefined,
          to: query?.to?.trim() || undefined,
          timezone: query?.timezone?.trim() || undefined,
          limit: query?.limit === undefined ? undefined : String(query.limit),
          offset: query?.offset === undefined ? undefined : String(query.offset),
        },
      });
    },
    create(request) {
      return http.request<CreateExpenseResponse>({
        path: "/api/expenses",
        method: "POST",
        body: request,
      });
    },
    get(id) {
      return http.request<GetExpenseResponse>({ path: expensePath(id) });
    },
    update(id, request) {
      return http.request<UpdateExpenseResponse>({
        path: expensePath(id),
        method: "PATCH",
        body: request,
      });
    },
    remove(id) {
      return http.request<DeleteExpenseResponse>({
        path: expensePath(id),
        method: "DELETE",
      });
    },
  };
}
