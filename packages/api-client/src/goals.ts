/**
 * Typed goal endpoints against the PR5 Hono transport contract:
 *
 *   GET    /api/goals?view=active|archived|all -> GoalsReadModel
 *   POST   /api/goals                          -> 201 { ok: true, values }
 *   PATCH  /api/goals/:id/status               -> { ok: true }
 *   PATCH  /api/goals/:id/health               -> { ok: true }
 *   PATCH  /api/goals/:id/next-step            -> { ok: true }
 *   POST   /api/goals/:id/archive              -> { ok: true }
 *   POST   /api/goals/:id/unarchive            -> { ok: true }
 *
 * Every method returns the typed `ApiResult` set; errors are mapped from the
 * server envelope (UNAUTHENTICATED | VALIDATION | NOT_FOUND | INTERNAL).
 */

import type { ApiResult, OkResponse } from "./errors";
import type { HttpClient } from "./http";
import type {
  CreateGoalInput,
  GoalFormValues,
  GoalHealth,
  GoalStatus,
  GoalViewFilter,
  GoalsReadModel,
} from "./types";

export type GoalsApi = {
  /** GET /api/goals?view=... (view omitted => server defaults to "active"). */
  list(view?: GoalViewFilter): Promise<ApiResult<GoalsReadModel>>;
  /** POST /api/goals — 201 with the normalized form values echoed back. */
  create(input: CreateGoalInput): Promise<ApiResult<{ values: GoalFormValues }>>;
  /** PATCH /api/goals/:id/status. */
  updateStatus(goalId: string, status: GoalStatus): Promise<ApiResult<OkResponse>>;
  /** PATCH /api/goals/:id/health. */
  updateHealth(goalId: string, health: GoalHealth | null): Promise<ApiResult<OkResponse>>;
  /** PATCH /api/goals/:id/next-step. */
  updateNextStep(goalId: string, nextStep: string | null): Promise<ApiResult<OkResponse>>;
  /** POST /api/goals/:id/archive. */
  archive(goalId: string): Promise<ApiResult<OkResponse>>;
  /** POST /api/goals/:id/unarchive. */
  unarchive(goalId: string): Promise<ApiResult<OkResponse>>;
};

export function createGoalsApi(http: HttpClient): GoalsApi {
  return {
    list(view) {
      return http.request<GoalsReadModel>({
        path: "/api/goals",
        query: { view },
      });
    },

    create(input) {
      return http.request<{ values: GoalFormValues }>({
        path: "/api/goals",
        method: "POST",
        body: input,
      });
    },

    updateStatus(goalId, status) {
      return http.request<OkResponse>({
        path: `/api/goals/${encodeURIComponent(goalId)}/status`,
        method: "PATCH",
        body: { status },
      });
    },

    updateHealth(goalId, health) {
      return http.request<OkResponse>({
        path: `/api/goals/${encodeURIComponent(goalId)}/health`,
        method: "PATCH",
        body: { health },
      });
    },

    updateNextStep(goalId, nextStep) {
      return http.request<OkResponse>({
        path: `/api/goals/${encodeURIComponent(goalId)}/next-step`,
        method: "PATCH",
        body: { nextStep },
      });
    },

    archive(goalId) {
      return http.request<OkResponse>({
        path: `/api/goals/${encodeURIComponent(goalId)}/archive`,
        method: "POST",
      });
    },

    unarchive(goalId) {
      return http.request<OkResponse>({
        path: `/api/goals/${encodeURIComponent(goalId)}/unarchive`,
        method: "POST",
      });
    },
  };
}
