/**
 * HTTP mechanics for @ega/api-client.
 *
 * Pure global-fetch request plumbing: URL building, Authorization header
 * injection from a caller-supplied token callback, JSON body handling, and
 * mapping of the server's `{ error: { code, message } }` envelope to the
 * typed `ApiResult` set. The client owns NO storage, platform SDK, or
 * session state — tokens are acquired per request through the injected
 * `getAccessToken` callback.
 */

import { errorResult, okResult, parseErrorEnvelope, type ApiErrorPayload, type ApiResult } from "./errors";

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export type TokenProvider = () => string | Promise<string | null>;

export type AuthErrorHandler = (error: ApiErrorPayload) => void;

export type HttpClientOptions = {
  baseUrl: string;
  getAccessToken: TokenProvider;
  onAuthError?: AuthErrorHandler;
  fetch?: FetchLike;
};

/** The four codes the transport can answer with. */
export type ServerErrorCode = "UNAUTHENTICATED" | "VALIDATION" | "NOT_FOUND" | "INTERNAL";

export type HttpRequestOptions = {
  /** Relative path under the base URL, e.g. `/api/projects`. */
  path: string;
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** Requests outside `/api/*` (e.g. `/health`) do not carry a token. */
  authenticated?: boolean;
};

export class HttpClient {
  private readonly baseUrl: string;
  private readonly getAccessToken: TokenProvider;
  private readonly onAuthError: AuthErrorHandler | undefined;
  private readonly fetch: FetchLike;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.getAccessToken = options.getAccessToken;
    this.onAuthError = options.onAuthError;
    this.fetch = options.fetch ?? (globalThis.fetch as FetchLike);
  }

  private buildUrl(path: string, query: Record<string, string | undefined> | undefined): string {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    if (!query) return url;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, value);
    }
    const encoded = params.toString();
    return encoded.length > 0 ? `${url}?${encoded}` : url;
  }

  async request<T>(options: HttpRequestOptions): Promise<ApiResult<T>> {
    const { path, method = "GET", query, body, authenticated = true } = options;

    let token: string | null = null;
    if (authenticated) {
      try {
        token = await this.getAccessToken();
      } catch {
        token = null;
      }
      if (!token) {
        return errorResult({
          code: "UNAUTHENTICATED",
          message: "Authentication required.",
          status: 401,
        });
      }
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (authenticated && token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetch(this.buildUrl(path, query), {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      return errorResult({
        code: "INTERNAL",
        message: "Network request failed.",
        status: 0,
      });
    }

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (response.status >= 200 && response.status < 300) {
      return okResult(parsed as T);
    }

    const payload = parseErrorEnvelope(parsed, response.status);
    if (payload.code === "UNAUTHENTICATED") {
      this.onAuthError?.(payload);
    }
    return errorResult(payload);
  }
}

export type { ApiResult };
