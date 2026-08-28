import type { MobileTodayTaskItem } from "@ega/contracts/mobile";
import type { OperatorSnapshotDto } from "@ega/contracts/operator";

export type MobileTodayDueBucket = MobileTodayTaskItem["dueBucket"];
export type MobileTodayTask = MobileTodayTaskItem;
export type MobileTodayResponse = OperatorSnapshotDto;

export type {
  MobileTodayClearCompletedResponse,
  MobileTodaySummary,
  MobileTodayTaskMutationResponse,
  MobileTodayTaskStatusMutationResponse,
} from "@ega/contracts/mobile";
export type { OperatorSnapshotDto, OperatorSignalsDto } from "@ega/contracts/operator";
