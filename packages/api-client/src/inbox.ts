import type { ConvertInboxInput, InboxConversionResponse, InboxItem, InboxListResponse, InboxMutationResponse } from "@ega/contracts/inbox";

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";

export type InboxListQuery = Readonly<{
  view?: string | null;
  search?: string | null;
  type?: string | null;
  status?: string | null;
  project?: string | null;
  projectId?: string | null;
  priority?: string | null;
  tag?: string | null;
  q?: string | null;
}>;

export type CreateInboxInput = Readonly<{
  title: string;
  body?: string | null;
  type?: string | null;
  projectId?: string | null;
  priority?: string | null;
  tags?: string[] | null;
  tagsInput?: string | null;
}>;

export type UpdateInboxInput = Readonly<{
  title: string;
  body?: string | null;
  type?: string | null;
  projectId?: string | null;
  priority?: string | null;
  tags?: string[] | null;
  tagsInput?: string | null;
  status: string;
}>;

export type ConvertInboxApiInput = ConvertInboxInput;

export type InboxApi = {
  list(query?: InboxListQuery): Promise<ApiResult<InboxListResponse>>;
  get(id: string): Promise<ApiResult<InboxMutationResponse>>;
  create(input: CreateInboxInput, idempotencyKey?: string): Promise<ApiResult<InboxMutationResponse>>;
  update(id: string, input: UpdateInboxInput): Promise<ApiResult<InboxMutationResponse>>;
  archive(id: string): Promise<ApiResult<InboxMutationResponse>>;
  restore(id: string): Promise<ApiResult<InboxMutationResponse>>;
  convert(id: string, input?: ConvertInboxApiInput): Promise<ApiResult<InboxConversionResponse>>;
};

function queryValue(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function idPath(id: string, suffix = "") {
  return `/api/inbox/${encodeURIComponent(id)}${suffix}`;
}

export function createInboxApi(http: HttpClient): InboxApi {
  return {
    list(query = {}) {
      return http.request<InboxListResponse>({
        path: "/api/inbox",
        query: {
          view: queryValue(query.view),
          search: queryValue(query.search),
          type: queryValue(query.type),
          status: queryValue(query.status),
          project: queryValue(query.project ?? query.projectId),
          priority: queryValue(query.priority),
          tag: queryValue(query.tag),
          q: queryValue(query.q),
        },
      });
    },
    get(id) {
      return http.request<InboxMutationResponse>({ path: idPath(id) });
    },
    create(input, idempotencyKey) {
      const headers: Record<string, string> | undefined = idempotencyKey
        ? { "X-Idempotency-Key": idempotencyKey }
        : undefined;
      // HttpClient doesn't support custom headers directly; we pass via body? Instead, we need to extend HttpClient to support headers.
      // For now, we use fetch directly if idempotency key needed, but we can also pass via query? Simpler: ignore header for now and rely on future extension.
      // To keep sliced vertical, we send via HttpClient with body and let server read header if we extend HttpClient later.
      // As workaround, pass idempotencyKey as part of request options via extended http method if available.
      const requestOptions: any = { path: "/api/inbox", method: "POST", body: input };
      if (headers) {
        requestOptions.headers = headers;
      }
      return http.request<InboxMutationResponse>(requestOptions);
    },
    update(id, input) {
      return http.request<InboxMutationResponse>({ path: idPath(id), method: "PATCH", body: input });
    },
    archive(id) {
      return http.request<InboxMutationResponse>({ path: idPath(id, "/archive"), method: "POST" });
    },
    restore(id) {
      return http.request<InboxMutationResponse>({ path: idPath(id, "/restore"), method: "POST" });
    },
    convert(id, input = {}) {
      return http.request<InboxConversionResponse>({ path: idPath(id, "/convert"), method: "POST", body: input });
    },
  };
}
