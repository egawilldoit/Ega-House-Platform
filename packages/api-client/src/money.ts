import type {
  ClassifyMoneyExpenseRequest,
  ClassifyMoneyExpenseResponse,
  DeleteMoneyCoffeeVisitResponse,
  GetMoneyBudgetPlanQuery,
  GetMoneyBudgetPlanResponse,
  ListMoneyCoffeeVisitsQuery,
  ListMoneyCoffeeVisitsResponse,
  MoneyBudgetMutationResponse,
  MoneyCoffeeWindowQuery,
  MoneyCoffeeWindowResponse,
  RecordMoneyCoffeeVisitRequest,
  RecordMoneyCoffeeVisitResponse,
  SaveMoneyBudgetPlanRequest,
  SetMoneyBudgetAllocationRequest,
} from "@ega/contracts/money";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

/**
 * Typed cross-platform transport for MONEY-05 budgets, classification and
 * counted coffee visits. Owner identity is derived server-side; no request
 * field can select an owner and no amount is a floating-point MAD value.
 */
export type MoneyApi = {
  /** GET /api/money/budget - `plan: null` means no explicit plan exists. */
  getBudgetPlan(
    query: GetMoneyBudgetPlanQuery,
  ): Promise<ApiResult<GetMoneyBudgetPlanResponse>>;
  /** PUT /api/money/budget - full versioned plan save (0 creates). */
  saveBudgetPlan(
    request: SaveMoneyBudgetPlanRequest,
  ): Promise<ApiResult<MoneyBudgetMutationResponse>>;
  /** PATCH /api/money/budget - partial allocation/target/limit edit. */
  setAllocation(
    request: SetMoneyBudgetAllocationRequest,
  ): Promise<ApiResult<MoneyBudgetMutationResponse>>;
  /** POST /api/money/coffee-visits - one counted visit, replayable by key. */
  recordCoffeeVisit(
    request: RecordMoneyCoffeeVisitRequest,
  ): Promise<ApiResult<RecordMoneyCoffeeVisitResponse>>;
  /** GET /api/money/coffee-visits - counted visits with canonical lines. */
  listCoffeeVisits(
    query: ListMoneyCoffeeVisitsQuery,
  ): Promise<ApiResult<ListMoneyCoffeeVisitsResponse>>;
  /** DELETE /api/money/coffee-visits/:id?version=N */
  deleteCoffeeVisit(
    id: string,
    version: number,
  ): Promise<ApiResult<DeleteMoneyCoffeeVisitResponse>>;
  /** GET /api/money/coffee-window */
  getCoffeeWindow(
    query: MoneyCoffeeWindowQuery,
  ): Promise<ApiResult<MoneyCoffeeWindowResponse>>;
  /** POST /api/money/classify - explicit versioned category edit. */
  classifyExpense(
    request: ClassifyMoneyExpenseRequest,
  ): Promise<ApiResult<ClassifyMoneyExpenseResponse>>;
};

export function createMoneyApi(http: HttpClient): MoneyApi {
  return {
    getBudgetPlan(query) {
      return http.request<GetMoneyBudgetPlanResponse>({
        path: "/api/money/budget",
        query: {
          periodStartDate: query.periodStartDate,
          periodEndDate: query.periodEndDate,
        },
      });
    },
    saveBudgetPlan(request) {
      return http.request<MoneyBudgetMutationResponse>({
        path: "/api/money/budget",
        method: "PUT",
        body: request,
      });
    },
    setAllocation(request) {
      return http.request<MoneyBudgetMutationResponse>({
        path: "/api/money/budget",
        method: "PATCH",
        body: request,
      });
    },
    recordCoffeeVisit(request) {
      return http.request<RecordMoneyCoffeeVisitResponse>({
        path: "/api/money/coffee-visits",
        method: "POST",
        body: request,
      });
    },
    listCoffeeVisits(query) {
      return http.request<ListMoneyCoffeeVisitsResponse>({
        path: "/api/money/coffee-visits",
        query: {
          from: query.from,
          to: query.to,
          limit: query.limit === undefined ? undefined : String(query.limit),
          offset: query.offset === undefined ? undefined : String(query.offset),
        },
      });
    },
    deleteCoffeeVisit(id, version) {
      return http.request<DeleteMoneyCoffeeVisitResponse>({
        path: `/api/money/coffee-visits/${encodeURIComponent(id)}`,
        method: "DELETE",
        query: { version: String(version) },
      });
    },
    getCoffeeWindow(query) {
      return http.request<MoneyCoffeeWindowResponse>({
        path: "/api/money/coffee-window",
        query: {
          localDate: query.localDate,
          timezone: query.timezone,
          periodStartDate: query.periodStartDate,
          periodEndDate: query.periodEndDate,
          spendLimitMinor:
            query.spendLimitMinor === undefined || query.spendLimitMinor === null
              ? undefined
              : String(query.spendLimitMinor),
          visitLimitMinor:
            query.visitLimitMinor === undefined || query.visitLimitMinor === null
              ? undefined
              : String(query.visitLimitMinor),
        },
      });
    },
    classifyExpense(request) {
      return http.request<ClassifyMoneyExpenseResponse>({
        path: "/api/money/classify",
        method: "POST",
        body: request,
      });
    },
  };
}
