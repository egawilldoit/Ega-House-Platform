/**
 * Compatibility re-export for existing web imports. The contract now lives in
 * `@ega/domain` so web, application and future mobile/comment producers share
 * one actor and event-kind shape.
 */
export type {
  TaskActivityActor,
  TaskActivityActorKind,
  TaskActivityEventKind,
  TaskActivityItem,
  TaskActivityKind,
} from "@ega/domain";

export {
  TASK_ACTIVITY_EVENT_KINDS,
  TASK_ACTIVITY_READ_KINDS,
  isTaskActivityActorKind,
  isTaskActivityEventKind,
  taskActivityActorLabel,
} from "@ega/domain";

export {
  TASK_ACTIVITY_EVENT_KINDS,
  TASK_ACTIVITY_READ_KINDS,
  isTaskActivityActorKind,
  isTaskActivityEventKind,
  taskActivityActorLabel,
} from "@ega/domain";
