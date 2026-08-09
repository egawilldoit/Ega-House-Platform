/**
 * EGA House cross-platform HTTP API client factory.
 *
 * Platform-neutral by construction: it depends only on global `fetch` and
 * never imports Expo, React, React Native, Next.js, Supabase, or any
 * application/data-access internals. Token acquisition is injected through
 * `getAccessToken` (the client owns no storage and no session state), and
 * `onAuthError` lets callers react to server-side 401s (e.g. refresh the
 * session) without the client knowing how sessions work.
 */

import { createGoalsApi, type GoalsApi } from "./goals";
import { HttpClient, type AuthErrorHandler, type TokenProvider } from "./http";
import { createProjectsApi, type ProjectsApi } from "./projects";
import type { ApiResult, ApiErrorPayload } from "./errors";
import type { HealthResponse } from "./types";

export type EgaApiClientOptions = {
  /** Origin of the transport, e.g. `https://api.ega.example`. */
  baseUrl: string;
  /**
   * Supplies the Supabase access token for the `Authorization: Bearer`
   * header on every /api/* request. Return null (or throw) when no token is
   * available — the request is then short-circuited to a local
   * `UNAUTHENTICATED` result without touching the network.
   */
  getAccessToken: TokenProvider;
  /**
   * Invoked when the server answers 401 `UNAUTHENTICATED` — the token is
   * missing, expired, or revoked. The client never refreshes tokens itself.
   */
  onAuthError?: AuthErrorHandler;
  /** Injectable fetch (tests, adapters); defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
};

export type EgaApiClient = {
  /** GET /health — unauthenticated, no Authorization header. */
  health(): Promise<ApiResult<HealthResponse>>;
  projects: ProjectsApi;
  goals: GoalsApi;
};

export function createEgaApiClient(options: EgaApiClientOptions): EgaApiClient {
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    getAccessToken: options.getAccessToken,
    onAuthError: options.onAuthError,
    fetch: options.fetch,
  });

  return {
    health() {
      return http.request<HealthResponse>({
        path: "/health",
        authenticated: false,
      });
    },
    projects: createProjectsApi(http),
    goals: createGoalsApi(http),
  };
}

export type { ApiResult, ApiErrorPayload };
