/**
 * @ega/api-client — cross-platform typed HTTP client for EGA House.
 * Owns transport mechanics only; platform storage/session state stays outside.
 */

export { createEgaApiClient } from "./client";
export type { EgaApiClient, EgaApiClientOptions } from "./client";

export type { ProjectsApi } from "./projects";
export type { GoalsApi } from "./goals";
export type { TasksApi, TaskListQuery, SetTaskRecurrenceInput } from "./tasks";
export type { InboxApi, InboxListQuery, CreateInboxInput, UpdateInboxInput } from "./inbox";
export type { TodayApi } from "./today";
export type { TimerApi } from "./timer";
export type { OperatorApi } from "./operator";
export type { TimeContextApi, TimeContextQuery } from "./time-context";
export type { AuthApi } from "./auth";

export type { ApiResult, ApiErrorPayload, ApiErrorCode, OkResponse } from "./errors";

export type {
  CreateTaskInput,
  UpdateTaskInput,
  MobileTaskListResponse,
  MobileTaskListItem,
  MobileTaskCounters,
  MobileTaskListFilters,
  MobileTaskMutationResponse,
  MobileTaskProject,
  MobileTaskGoal,
  MobileTaskReminder,
  MobileTaskRecurrence,
  MobileTodayResponse,
  MobileTodaySummary,
  MobileTodayTaskItem,
  MobileTodayTaskMutationResponse,
  MobileTodayTaskStatusMutationResponse,
  MobileTodayClearCompletedResponse,
} from "@ega/contracts/mobile";
export type {
  OperatorSnapshotDto,
  OperatorSignalsDto,
  OperatorFocusDto,
  OperatorScheduleDto,
  GetOperatorSnapshotResponse,
  OperatorProposalDto,
  OperatorProposalResultDto,
  CreateOperatorProposalRequest,
  CreateOperatorProposalResponse,
  ApplyOperatorProposalRequest,
  ApplyOperatorProposalResponse,
  ApproveOperatorProposalResponse,
} from "@ega/contracts/operator";
export type { TaskDueFilter, TaskSortValue } from "@ega/contracts/common/task-list";
export type { TaskPriority, TaskStatus } from "@ega/domain";

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
