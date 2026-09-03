/**
 * Typed project endpoints against the PR5 Hono transport contract:
 *
 *   GET    /api/projects?view=active|archived|all -> ProjectsReadModel
 *   GET    /api/projects/:slug                    -> ProjectIdentityReadModel (404 when missing)
 *   POST   /api/projects                          -> 201 { ok: true, values }
 *   PATCH  /api/projects/:id/status               -> { ok: true }
 *   POST   /api/projects/:id/archive              -> { ok: true }
 *   POST   /api/projects/:id/unarchive            -> { ok: true }
 *
 * Every method returns the typed `ApiResult` set; errors are mapped from the
 * server envelope (UNAUTHENTICATED | VALIDATION | NOT_FOUND | INTERNAL).
 */

import type { ApiResult } from "./errors";
import type { HttpClient } from "./http";
import type {
  CreateProjectResponse,
  CreateProjectInput,
  ProjectIdentityReadModel,
  ProjectMutationResponse,
  ProjectStatus,
  ProjectViewFilter,
  ProjectsReadModel,
} from "@ega/contracts/projects";

export type ProjectsApi = {
  /** GET /api/projects?view=... (view omitted => server defaults to "active"). */
  list(view?: ProjectViewFilter): Promise<ApiResult<ProjectsReadModel>>;
  /** GET /api/projects/:slug — 404 maps to `NOT_FOUND`. */
  getBySlug(slug: string): Promise<ApiResult<ProjectIdentityReadModel>>;
  /** POST /api/projects — 201 with the normalized form values echoed back. */
  create(input: CreateProjectInput): Promise<ApiResult<CreateProjectResponse>>;
  /** PATCH /api/projects/:id/status. */
  updateStatus(projectId: string, status: ProjectStatus): Promise<ApiResult<ProjectMutationResponse>>;
  /** POST /api/projects/:id/archive. */
  archive(projectId: string): Promise<ApiResult<ProjectMutationResponse>>;
  /** POST /api/projects/:id/unarchive. */
  unarchive(projectId: string): Promise<ApiResult<ProjectMutationResponse>>;
};

export function createProjectsApi(http: HttpClient): ProjectsApi {
  return {
    list(view) {
      return http.request<ProjectsReadModel>({
        path: "/api/projects",
        query: { view },
      });
    },

    getBySlug(slug) {
      return http.request<ProjectIdentityReadModel>({
        path: `/api/projects/${encodeURIComponent(slug)}`,
      });
    },

    create(input) {
      return http.request<CreateProjectResponse>({
        path: "/api/projects",
        method: "POST",
        body: input,
      });
    },

    updateStatus(projectId, status) {
      return http.request<ProjectMutationResponse>({
        path: `/api/projects/${encodeURIComponent(projectId)}/status`,
        method: "PATCH",
        body: { status },
      });
    },

    archive(projectId) {
      return http.request<ProjectMutationResponse>({
        path: `/api/projects/${encodeURIComponent(projectId)}/archive`,
        method: "POST",
      });
    },

    unarchive(projectId) {
      return http.request<ProjectMutationResponse>({
        path: `/api/projects/${encodeURIComponent(projectId)}/unarchive`,
        method: "POST",
      });
    },
  };
}
