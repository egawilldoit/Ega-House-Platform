import type {
  CreateObligationRequest,
  CreateObligationResponse,
  CreateObligationTemplateRequest,
  GenerateObligationsRequest,
  GenerateObligationsResponse,
  GetObligationResponse,
  ListObligationsQuery,
  ListObligationsResponse,
  ListObligationTemplatesQuery,
  ListObligationTemplatesResponse,
  ObligationSummaryQuery,
  ObligationSummaryResponse,
  ObligationTemplateResponse,
  TransitionObligationRequest,
  UpdateObligationRequest,
  UpdateObligationResponse,
  UpdateObligationTemplateRequest,
} from "@ega/contracts/money";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

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
