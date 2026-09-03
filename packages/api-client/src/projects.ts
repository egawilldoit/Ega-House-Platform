/**
 * Typed project endpoints against the PR5 Hono transport contract:
 *
 *   GET    /api/projects?view=active|archived|all -> ProjectsReadModel
 *   GET    /api/projects/:slug                    -> ProjectIdentityReadModel (404 when missing)
 *   POST   /api/projects                          -> 201 { ok: true, values }
 *   PATCH  /api/projects/:id/status               -> { ok: true }
 *   POST   /api/projects/:id/archive              -> { ok: true }
 *   POST   /api/projects/:id/unarchive            -> { ok: true }
 *   DELETE /api/projects/:id                      -> { ok: true }
 *                                                   (400 VALIDATION when not archived,
 *                                                    409 VALIDATION when linked tasks/goals remain,
 *                                                    404 NOT_FOUND when missing/foreign)
 *   GET    /api/projects/:id/purge-preview         -> ProjectPurgePreviewResponse
 *   POST   /api/projects/:id/purge                 -> { ok: true, deleted: ProjectPurgeSummary }
 *                                                   (400 VALIDATION incl. confirmation mismatch,
 *                                                    409 VALIDATION when contents changed,
 *                                                    404 NOT_FOUND when missing/foreign)
 *
 * Every method returns the typed `ApiResult` set; errors are mapped from the
 * server envelope (UNAUTHENTICATED | VALIDATION | NOT_FOUND | INTERNAL).
 * The client preserves the HTTP status, so a 409 dependency conflict keeps
 * `error.status === 409` with `error.code === "VALIDATION"`.
 */

import type { ApiResult, OkResponse } from "./errors";
import type { HttpClient } from "./http";
import type {
  CreateProjectInput,
  ProjectFormValues,
  ProjectIdentityReadModel,
  ProjectStatus,
  ProjectViewFilter,
  ProjectsReadModel,
} from "./types";

export type ProjectPurgeImpact = {
  taskCount: number;
  goalCount: number;
  sessionCount: number;
  activeSessionCount: number;
  reminderCount: number;
  recurrenceCount: number;
  externalRefCount: number;
  taskNotificationCount: number;
  calendarEventCount: number;
};

export type ProjectPurgePreviewResponse = {
  projectId: string;
  projectName: string;
  impact: ProjectPurgeImpact;
};

export type ProjectPurgeSummary = {
  tasksDeleted: number;
  goalsDeleted: number;
  sessionsDeleted: number;
  externalRefsDeleted: number;
  notificationsDeleted: number;
  calendarDeleteJobsEnqueued: number;
};

export type PurgeProjectInput = {
  confirmationName: string;
  expectedTaskCount: number;
  expectedGoalCount: number;
};

export type ProjectsApi = {
  /** GET /api/projects?view=... (view omitted => server defaults to "active"). */
  list(view?: ProjectViewFilter): Promise<ApiResult<ProjectsReadModel>>;
  /** GET /api/projects/:slug — 404 maps to `NOT_FOUND`. */
  getBySlug(slug: string): Promise<ApiResult<ProjectIdentityReadModel>>;
  /** POST /api/projects — 201 with the normalized form values echoed back. */
  create(input: CreateProjectInput): Promise<ApiResult<{ values: ProjectFormValues }>>;
  /** PATCH /api/projects/:id/status. */
  updateStatus(projectId: string, status: ProjectStatus): Promise<ApiResult<OkResponse>>;
  /** POST /api/projects/:id/archive. */
  archive(projectId: string): Promise<ApiResult<OkResponse>>;
  /** POST /api/projects/:id/unarchive. */
  unarchive(projectId: string): Promise<ApiResult<OkResponse>>;
  /** DELETE /api/projects/:id — archived projects without linked tasks/goals only. */
  remove(projectId: string): Promise<ApiResult<OkResponse>>;
  /** GET /api/projects/:id/purge-preview — exact deletion impact for an archived project. */
  getPurgePreview(projectId: string): Promise<ApiResult<ProjectPurgePreviewResponse>>;
  /** POST /api/projects/:id/purge — atomic purge of an archived project. */
  purge(projectId: string, input: PurgeProjectInput): Promise<ApiResult<{ ok: true; deleted: ProjectPurgeSummary }>>;
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
      return http.request<{ values: ProjectFormValues }>({
        path: "/api/projects",
        method: "POST",
        body: input,
      });
    },

    updateStatus(projectId, status) {
      return http.request<OkResponse>({
        path: `/api/projects/${encodeURIComponent(projectId)}/status`,
        method: "PATCH",
        body: { status },
      });
    },

    archive(projectId) {
      return http.request<OkResponse>({
        path: `/api/projects/${encodeURIComponent(projectId)}/archive`,
        method: "POST",
      });
    },

    unarchive(projectId) {
      return http.request<OkResponse>({
        path: `/api/projects/${encodeURIComponent(projectId)}/unarchive`,
        method: "POST",
      });
    },

    remove(projectId) {
      return http.request<OkResponse>({
        path: `/api/projects/${encodeURIComponent(projectId)}`,
        method: "DELETE",
      });
    },

    getPurgePreview(projectId) {
      return http.request<ProjectPurgePreviewResponse>({
        path: `/api/projects/${encodeURIComponent(projectId)}/purge-preview`,
      });
    },

    purge(projectId, input) {
      return http.request<{ ok: true; deleted: ProjectPurgeSummary }>({
        path: `/api/projects/${encodeURIComponent(projectId)}/purge`,
        method: "POST",
        body: input,
      });
    },
  };
}
