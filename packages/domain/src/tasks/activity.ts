/**
 * Durable task-activity contract (EGA-784).
 *
 * One ledger shape serves every surface: owner writes from web/Hono/mobile,
 * agent writes through MCP OAuth clients or scoped agent tokens, and system
 * writes from jobs. Actor provenance is derived from a verified server context
 * and snapshotted onto the event, so revoking or rotating a credential never
 * rewrites history.
 */

/** Who performed a recorded change, as observed by the server. */
export type TaskActivityActorKind = "owner" | "agent" | "system" | "unknown";

export type TaskActivityActor = {
  kind: TaskActivityActorKind;
  /** Authenticated owner of the task when the event recorded one. */
  userId?: string | null;
  /**
   * Stable agent identity, independent of the credential secret: the MCP OAuth
   * client id or the scoped-agent token id. Null for owner/system/unknown.
   */
  agentId?: string | null;
  /** Display label captured at write time (never re-derived from credentials). */
  label?: string | null;
};

/**
 * Event kinds written to `task_activity_events`.
 *
 * `status` and `session` are display kinds produced by the read model from the
 * status ledger and timer-session evidence; they are never stored in the
 * activity table. `comment` is the shared contract EGA-783's producer writes;
 * this issue owns the contract, not comment storage.
 */
export const TASK_ACTIVITY_EVENT_KINDS = [
  "created",
  "field_change",
  "archived",
  "restored",
  "reminder_scheduled",
  "reminder_updated",
  "reminder_cancelled",
  "comment",
  "attachment_added",
  "attachment_removed",
] as const;

export type TaskActivityEventKind = (typeof TASK_ACTIVITY_EVENT_KINDS)[number];

export const TASK_ACTIVITY_READ_KINDS = [
  ...TASK_ACTIVITY_EVENT_KINDS,
  "status",
  "session",
] as const;

export type TaskActivityKind = (typeof TASK_ACTIVITY_READ_KINDS)[number];

export function isTaskActivityEventKind(value: string): value is TaskActivityEventKind {
  return (TASK_ACTIVITY_EVENT_KINDS as readonly string[]).includes(value);
}

export function isTaskActivityActorKind(value: string): value is TaskActivityActorKind {
  return value === "owner" || value === "agent" || value === "system" || value === "unknown";
}

/**
 * One display row shared by the task drawer and the project activity card.
 * `occurredAt` is an ISO timestamp; ordering is timestamp descending with the
 * stable `id` as the tie-breaker.
 */
export type TaskActivityItem = {
  id: string;
  /** Present on project-wide rows so the UI can name the task. */
  taskId?: string | null;
  kind: TaskActivityKind;
  occurredAt: string;
  actor: TaskActivityActor;
  summary: string;
};

/** Human label for an actor row. Never invents an identity for missing proof. */
export function taskActivityActorLabel(actor: TaskActivityActor): string {
  switch (actor.kind) {
    case "owner":
      return "You";
    case "agent": {
      const label = actor.label?.trim();
      return label ? label : "Agent";
    }
    case "system":
      return "System";
    default:
      return "Unknown actor";
  }
}
