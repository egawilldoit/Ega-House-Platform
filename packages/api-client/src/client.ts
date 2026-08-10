/**
 * EGA House cross-platform HTTP API client factory.
 *
 * Platform-neutral by construction: it depends only on global `fetch` and
 * never imports Expo, React, React Native, Next.js, Supabase, or any
 * application/data-access internals. Token acquisition is injected through
 * `getAccessToken` (the client owns no storage and no session state), and
 * `onAuthError` lets callers react to server-side 401s without the client
 * knowing how sessions are persisted or refreshed.
 */

import { createGoalsApi, type GoalsApi } from "./goals";
import { HttpClient, type AuthErrorHandler, type TokenProvider } from "./http";
import { createProjectsApi, type ProjectsApi } from "./projects";
import { createTasksApi, type TasksApi } from "./tasks";
import { createTodayApi, type TodayApi } from "./today";
import type { ApiResult, ApiErrorPayload } from "./errors";
import type { HealthResponse } from "./types";

export type EgaApiClientOptions = {
  /** Origin of the transport, e.g. `https://api.ega.example`. */
  baseUrl: string;
  /** Supplies the bearer access token for authenticated requests. */
  getAccessToken: TokenProvider;
  /** Invoked on server-side 401; session refresh remains caller-owned. */
  onAuthError?: AuthErrorHandler;
  /** Injectable fetch for tests/platform adapters. */
  fetch?: typeof globalThis.fetch;
};

export type EgaApiClient = {
  /** GET /health — unauthenticated, no Authorization header. */
  health(): Promise<ApiResult<HealthResponse>>;
  projects: ProjectsApi;
  goals: GoalsApi;
  tasks: TasksApi;
  today: TodayApi;
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
    tasks: createTasksApi(http),
    today: createTodayApi(http),
  };
}

export type { ApiResult, ApiErrorPayload };
