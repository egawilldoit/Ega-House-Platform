export * from "./auth/actor";
export * from "./shared/result";
export * from "./projects/ports";
export * from "./projects/read-model";
export * from "./projects/service";
export * from "./goals/ports";
export * from "./goals/read-model";
export * from "./goals/service";

export type {
  GoalHealth,
  GoalStatus,
  GoalViewFilter,
  ProjectStatus,
  ProjectViewFilter,
} from "@ega/domain";
