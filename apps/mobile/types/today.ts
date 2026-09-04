import type { MobileTodayTaskItem } from "@ega/contracts/mobile";

export type MobileTodayDueBucket = MobileTodayTaskItem["dueBucket"];
export type MobileTodayTask = MobileTodayTaskItem;
export type {
  MobileTodayClearCompletedResponse,
  MobileTodayResponse,
  MobileTodaySummary,
  MobileTodayTaskMutationResponse,
  MobileTodayTaskStatusMutationResponse,
} from "@ega/contracts/mobile";
export type { OperatorSnapshotDto, OperatorSignalsDto } from "@ega/contracts/operator";
