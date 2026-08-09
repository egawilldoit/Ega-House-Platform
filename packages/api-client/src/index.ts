/**
 * @ega/api-client — cross-platform typed HTTP client for the EGA House
 * transport (@ega/server). Consumes the PR5 Hono contract for projects and
 * goals with injected token acquisition; no platform SDKs, no storage.
 */

export { createEgaApiClient } from "./client";
export type { EgaApiClient, EgaApiClientOptions } from "./client";

export type { ProjectsApi } from "./projects";
export type { GoalsApi } from "./goals";

export type { ApiResult, ApiErrorPayload, ApiErrorCode, OkResponse } from "./errors";

export type {
  ProjectViewFilter,
  GoalViewFilter,
  ProjectStatus,
  GoalStatus,
  GoalHealth,
  ProjectFormValues,
  GoalFormValues,
  ProjectRecord,
  ProjectTaskContextRecord,
  ProjectGoalRecord,
  ProjectCardReadModel,
  ProjectsReadModel,
  ProjectIdentityReadModel,
  GoalTaskContextRecord,
  GoalReadModel,
  GoalsReadModel,
  CreateProjectInput,
  CreateGoalInput,
  HealthResponse,
} from "./types";
