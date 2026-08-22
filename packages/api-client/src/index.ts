/**
 * @ega/api-client — cross-platform typed HTTP client for EGA House.
 * Owns transport mechanics only; platform storage/session state stays outside.
 */

export { createEgaApiClient } from "./client";
export type { EgaApiClient, EgaApiClientOptions } from "./client";

export type { ProjectsApi } from "./projects";
export type { GoalsApi } from "./goals";
export type {
  TasksApi,
  TaskListQuery,
  TaskApiRecord,
  TaskApiReminder,
  TaskApiRecurrence,
  TaskUpdateInput,
  SetTaskRecurrenceInput,
} from "./tasks";
export type { TodayApi } from "./today";
export type { TimerApi } from "./timer";
export type { AuthApi } from "./auth";

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
