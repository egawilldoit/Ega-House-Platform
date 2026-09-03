/**
 * Compatibility barrel for the historical `@ega/api-client/types` subpath.
 *
 * DTO authority lives in `@ega/contracts`; this file intentionally contains
 * no wire-shape definitions so older imports do not create a second source of
 * truth.
 */
export type {
  CreateProjectInput,
  CreateProjectResponse,
  ProjectCardReadModel,
  ProjectFormValues,
  ProjectGoalRecord,
  ProjectIdentityReadModel,
  ProjectMutationResponse,
  ProjectRecord,
  ProjectStatus,
  ProjectTaskContextRecord,
  ProjectViewFilter,
  ProjectsReadModel,
} from "@ega/contracts/projects";

export type {
  CreateGoalInput,
  CreateGoalResponse,
  GoalFormValues,
  GoalHealth,
  GoalMutationResponse,
  GoalReadModel,
  GoalStatus,
  GoalTaskContextRecord,
  GoalViewFilter,
  GoalsReadModel,
} from "@ega/contracts/goals";

export type { HealthStatusResponse as HealthResponse } from "@ega/contracts/health";
