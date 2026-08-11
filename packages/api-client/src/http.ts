/**
 * HTTP mechanics for @ega/api-client.
 *
 * Pure global-fetch request plumbing: URL building, Authorization header
 * injection from caller-supplied token callbacks, JSON body handling, and
 * mapping of the server's error envelope to typed ApiResult values. The
 * client owns NO storage, platform SDK, or session state.
 */

import {
  errorResult,
  okResult,
  parseErrorEnvelope,
  type ApiErrorPayload,
  type ApiResult,
} from "./errors";

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export type TokenProvider = () => string | Promise<string | null>;
export type RefreshAccessToken = () => boolean | Promise<boolean>;
export type AuthErrorHandler = (error: ApiErrorPayload) => void;

export type HttpClientOptions = {
  baseUrl: string;
  getAccessToken: TokenProvider;
  /** Caller-owned refresh operation. Returns true only when a fresh token is available. */
  refreshAccessToken?: RefreshAccessToken;
  onAuthError?: AuthErrorHandler;
  fetch?: FetchLike;
};

/** The four codes the transport can answer with. */
export type ServerErrorCode = "UNAUTHENTICATED" | "VALIDATION" | "NOT_FOUND" | "INTERNAL";

export type HttpRequestOptions = {
  /** Relative path under the base URL, e.g. `/api/projects`. */
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** Requests outside `/api/*` (e.g. `/health`) do not carry a token. */
  authenticated?: boolean;
};

export class HttpClient {
  private readonly baseUrl: string;
  private readonly getAccessToken: TokenProvider;
  private readonly refreshAccessToken: RefreshAccessToken | undefined;
  private readonly onAuthError: AuthErrorHandler | undefined;
  private readonly fetch: FetchLike;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.getAccessToken = options.getAccessToken;
    this.refreshAccessToken = options.refreshAccessToken;
    this.onAuthError = options.onAuthError;
    this.fetch = options.fetch ?? (globalThis.fetch as FetchLike);
  }

  private buildUrl(
    path: string,
    query: Record<string, string | undefined> | undefined,
  ): string {
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
    return this.requestAttempt<T>(options, true);
  }

  private async requestAttempt<T>(
    options: HttpRequestOptions,
    allowRefresh: boolean,
  ): Promise<ApiResult<T>> {
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

    if (
      payload.code === "UNAUTHENTICATED" &&
      authenticated &&
      allowRefresh &&
      this.refreshAccessToken
    ) {
      let refreshed = false;
      try {
        refreshed = await this.refreshAccessToken();
      } catch {
        refreshed = false;
      }

      if (refreshed) {
        // One retry only. The retry reacquires the token from the caller-owned
        // provider and cannot refresh recursively.
        return this.requestAttempt<T>(options, false);
      }
    }

    if (payload.code === "UNAUTHENTICATED") {
      this.onAuthError?.(payload);
    }

    return errorResult(payload);
  }
}

export type { ApiResult };
