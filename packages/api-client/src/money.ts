import type {
  ClassifyMoneyExpenseRequest,
  ClassifyMoneyExpenseResponse,
  CloseMoneyDayRequest,
  CloseMoneyDayResponse,
  CorrectObligationPaymentRequest,
  CreateMoneyPeriodRequest,
  CreateMoneyPeriodResponse,
  CreateMovementRequest,
  CreateMovementResponse,
  CreateObligationRequest,
  CreateObligationResponse,
  CreateObligationTemplateRequest,
  DeleteMoneyCoffeeVisitResponse,
  GenerateObligationsRequest,
  GenerateObligationsResponse,
  GetObligationResponse,
  GetMoneyBudgetPlanQuery,
  GetMoneyBudgetPlanResponse,
  GetMoneyStateQuery,
  GetMoneyStateResponse,
  GetMovementResponse,
  ListMoneyCoffeeVisitsQuery,
  ListMoneyCoffeeVisitsResponse,
  ListMovementsQuery,
  ListMovementsResponse,
  ListObligationsQuery,
  ListObligationsResponse,
  ListObligationTemplatesQuery,
  ListObligationTemplatesResponse,
  MoneyBudgetMutationResponse,
  MoneyCoffeeWindowQuery,
  MoneyCoffeeWindowResponse,
  ObligationPaymentResponse,
  ObligationSummaryQuery,
  ObligationSummaryResponse,
  ObligationTemplateResponse,
  PayObligationRequest,
  RecordMoneyCoffeeVisitRequest,
  RecordMoneyCoffeeVisitResponse,
  SaveMoneyBudgetPlanRequest,
  SetMoneyBudgetAllocationRequest,
  TransitionObligationRequest,
  UndoObligationPaymentRequest,
  UpdateMovementRequest,
  UpdateMovementResponse,
  UpdateMoneySettingsRequest,
  UpdateMoneySettingsResponse,
  UpdateObligationRequest,
  UpdateObligationResponse,
  UpdateObligationTemplateRequest,
} from "@ega/contracts/money";
import type {
  MoneyRolloverPreviewResponse,
  MoneyRolloverResponse,
  MoneyRolloverWriteRequest,
} from "@ega/contracts/money-rollover";

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
  /** GET /api/money/periods/:id/rollover/preview - successor defaults + choices. */
  rolloverPreview(id: string): Promise<ApiResult<MoneyRolloverPreviewResponse>>;
  /** POST /api/money/periods/:id/rollover - one explicit successor per source. */
  rollover(
    id: string,
    request: MoneyRolloverWriteRequest,
  ): Promise<ApiResult<MoneyRolloverResponse>>;
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
  /** POST /api/money/day-close - durable close, 200 on idempotent replay. */
  closeDay(
    request: CloseMoneyDayRequest,
  ): Promise<ApiResult<CloseMoneyDayResponse>>;
};

function periodSettingsPath(id: string): string {
  return `/api/money/periods/${encodeURIComponent(id)}/settings`;
}

function periodPath(id: string): string {
  return `/api/money/periods/${encodeURIComponent(id)}`;
}

function movementPath(id: string): string {
  return `/api/money/movements/${encodeURIComponent(id)}`;
}

function coffeeVisitPath(id: string): string {
  return `/api/money/coffee-visits/${encodeURIComponent(id)}`;
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
    rolloverPreview(id) {
      return http.request<MoneyRolloverPreviewResponse>({
        path: `${periodPath(id)}/rollover/preview`,
      });
    },
    rollover(id, request) {
      return http.request<MoneyRolloverResponse>({
        path: `${periodPath(id)}/rollover`,
        method: "POST",
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
        path: coffeeVisitPath(id),
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
    closeDay(request) {
      return http.request<CloseMoneyDayResponse>({
        path: "/api/money/day-close",
        method: "POST",
        body: request,
      });
    },
  };
}

/**
 * Typed cross-platform transport for MONEY-06 obligations (bills and
 * subscriptions). Both views share these occurrence IDs and payment state;
 * there is no separate bill/subscription resource. Owner identity is derived
 * server-side from the bearer token; callers never send an owner id.
 */
export type ObligationsApi = {
  /** GET /api/money/obligations — due-date order, inclusive due filters. */
  list(query?: ListObligationsQuery): Promise<ApiResult<ListObligationsResponse>>;
  /** POST /api/money/obligations — 201 on create, 200 on idempotent replay. */
  create(
    request: CreateObligationRequest,
  ): Promise<ApiResult<CreateObligationResponse>>;
  /** GET /api/money/obligations/summary?cutoff=YYYY-MM-DD */
  summary(
    query: ObligationSummaryQuery,
  ): Promise<ApiResult<ObligationSummaryResponse>>;
  /** GET /api/money/obligations/:id */
  get(id: string): Promise<ApiResult<GetObligationResponse>>;
  /** PATCH /api/money/obligations/:id — requires the current positive `version`. */
  update(
    id: string,
    request: UpdateObligationRequest,
  ): Promise<ApiResult<UpdateObligationResponse>>;
  /** POST /api/money/obligations/:id/transition — cancel/waive/reopen. */
  transition(
    id: string,
    request: TransitionObligationRequest,
  ): Promise<ApiResult<UpdateObligationResponse>>;
  /** POST /api/money/obligations/:id/payment — one atomic payment. */
  pay(
    id: string,
    request: PayObligationRequest,
  ): Promise<ApiResult<ObligationPaymentResponse>>;
  /** POST /api/money/obligations/:id/payment/correction — move the payment. */
  correctPayment(
    id: string,
    request: CorrectObligationPaymentRequest,
  ): Promise<ApiResult<ObligationPaymentResponse>>;
  /** POST /api/money/obligations/:id/payment/undo — remove the payment. */
  undoPayment(
    id: string,
    request: UndoObligationPaymentRequest,
  ): Promise<ApiResult<ObligationPaymentResponse>>;

  /** GET /api/money/obligation-templates */
  listTemplates(
    query?: ListObligationTemplatesQuery,
  ): Promise<ApiResult<ListObligationTemplatesResponse>>;
  /** POST /api/money/obligation-templates */
  createTemplate(
    request: CreateObligationTemplateRequest,
  ): Promise<ApiResult<ObligationTemplateResponse>>;
  /** GET /api/money/obligation-templates/:id */
  getTemplate(id: string): Promise<ApiResult<ObligationTemplateResponse>>;
  /** PATCH /api/money/obligation-templates/:id */
  updateTemplate(
    id: string,
    request: UpdateObligationTemplateRequest,
  ): Promise<ApiResult<ObligationTemplateResponse>>;
  /** POST /api/money/obligation-templates/:id/generate */
  generate(
    id: string,
    request: GenerateObligationsRequest,
  ): Promise<ApiResult<GenerateObligationsResponse>>;
};

function obligationPath(id: string): string {
  return `/api/money/obligations/${encodeURIComponent(id)}`;
}

function templatePath(id: string): string {
  return `/api/money/obligation-templates/${encodeURIComponent(id)}`;
}

function optional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function createObligationsApi(http: HttpClient): ObligationsApi {
  return {
    list(query) {
      return http.request<ListObligationsResponse>({
        path: "/api/money/obligations",
        query: {
          kind: optional(query?.kind),
          state: optional(query?.state),
          dueFrom: optional(query?.dueFrom),
          dueTo: optional(query?.dueTo),
          limit: query?.limit === undefined ? undefined : String(query.limit),
          offset: query?.offset === undefined ? undefined : String(query.offset),
        },
      });
    },
    create(request) {
      return http.request<CreateObligationResponse>({
        path: "/api/money/obligations",
        method: "POST",
        body: request,
      });
    },
    summary(query) {
      return http.request<ObligationSummaryResponse>({
        path: "/api/money/obligations/summary",
        query: {
          cutoff: query.cutoff,
          kind: optional(query.kind),
        },
      });
    },
    get(id) {
      return http.request<GetObligationResponse>({ path: obligationPath(id) });
    },
    update(id, request) {
      return http.request<UpdateObligationResponse>({
        path: obligationPath(id),
        method: "PATCH",
        body: request,
      });
    },
    transition(id, request) {
      return http.request<UpdateObligationResponse>({
        path: `${obligationPath(id)}/transition`,
        method: "POST",
        body: request,
      });
    },
    pay(id, request) {
      return http.request<ObligationPaymentResponse>({
        path: `${obligationPath(id)}/payment`,
        method: "POST",
        body: request,
      });
    },
    correctPayment(id, request) {
      return http.request<ObligationPaymentResponse>({
        path: `${obligationPath(id)}/payment/correction`,
        method: "POST",
        body: request,
      });
    },
    undoPayment(id, request) {
      return http.request<ObligationPaymentResponse>({
        path: `${obligationPath(id)}/payment/undo`,
        method: "POST",
        body: request,
      });
    },
    listTemplates(query) {
      return http.request<ListObligationTemplatesResponse>({
        path: "/api/money/obligation-templates",
        query: {
          kind: optional(query?.kind),
          includeArchived:
            query?.includeArchived === undefined
              ? undefined
              : String(query.includeArchived),
        },
      });
    },
    createTemplate(request) {
      return http.request<ObligationTemplateResponse>({
        path: "/api/money/obligation-templates",
        method: "POST",
        body: request,
      });
    },
    getTemplate(id) {
      return http.request<ObligationTemplateResponse>({
        path: templatePath(id),
      });
    },
    updateTemplate(id, request) {
      return http.request<ObligationTemplateResponse>({
        path: templatePath(id),
        method: "PATCH",
        body: request,
      });
    },
    generate(id, request) {
      return http.request<GenerateObligationsResponse>({
        path: `${templatePath(id)}/generate`,
        method: "POST",
        body: request,
      });
    },
  };
}
