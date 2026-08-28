/**
 * EGA House cross-platform HTTP API client factory.
 *
 * Platform-neutral by construction: it depends only on global `fetch` and
 * never imports Expo, React, React Native, Next.js, Supabase, or any
 * application/data-access internals. Token acquisition and optional refresh
 * are injected; the client owns no storage and no session state.
 */

import { createAuthApi, type AuthApi } from "./auth";
import { createGoalsApi, type GoalsApi } from "./goals";
import {
  HttpClient,
  type AuthErrorHandler,
  type RefreshAccessToken,
  type TokenProvider,
} from "./http";
import { createInboxApi, type InboxApi } from "./inbox";
import { createProjectsApi, type ProjectsApi } from "./projects";
import { createTasksApi, type TasksApi } from "./tasks";
import { createTimerApi, type TimerApi } from "./timer";
import { createTodayApi, type TodayApi } from "./today";
import type { ApiErrorPayload, ApiResult } from "./errors";
import type { HealthResponse } from "./types";

export type EgaApiClientOptions = {
  /** Origin of the transport, e.g. `https://api.ega.example`. */
  baseUrl: string;
  /** Supplies the bearer access token for authenticated requests. */
  getAccessToken: TokenProvider;
  /**
   * Caller-owned refresh operation used once after an authenticated 401.
   * Returns true only when `getAccessToken` can now supply a refreshed token.
   */
  refreshAccessToken?: RefreshAccessToken;
  /** Invoked only for terminal server-side authentication failures. */
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
  inbox: InboxApi;
  today: TodayApi;
  timer: TimerApi;
  auth: AuthApi;
};

export function createEgaApiClient(options: EgaApiClientOptions): EgaApiClient {
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    getAccessToken: options.getAccessToken,
    refreshAccessToken: options.refreshAccessToken,
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
    inbox: createInboxApi(http),
    today: createTodayApi(http),
    timer: createTimerApi(http),
    auth: createAuthApi(http),
  };
}

export type { ApiResult, ApiErrorPayload };
