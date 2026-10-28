/** Shared activity row shape for the drawer and project read model. */
export type TaskActivityKind =
  | "status"
  | "created"
  | "field_change"
  | "archived"
  | "restored"
  | "session";

export type TaskActivityActorKind = "owner" | "agent" | "system" | "unknown";

export type TaskActivityItem = {
  id: string;
  /** Present on project-wide rows so the UI can name the task. */
  taskId?: string | null;
  kind: TaskActivityKind;
  occurredAt: string;
  actorKind: TaskActivityActorKind;
  actorLabel: string | null;
  summary: string;
};
