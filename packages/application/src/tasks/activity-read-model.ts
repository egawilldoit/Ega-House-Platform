/**
 * Task-activity read model (EGA-784).
 *
 * The durable ledger is split by authority so existing analytics stay correct:
 * status transitions live in `task_status_events`, observable field/reminder/
 * comment changes live in `task_activity_events`, and timer evidence lives in
 * `task_sessions`. This module merges those authoritative sources into one
 * deterministic, owner-scoped display stream. It is pure so web, future mobile
 * consumers and tests share exactly one ordering and pagination contract.
 */

import {
  isTaskActivityActorKind,
  isTaskActivityEventKind,
  type TaskActivityActor,
  type TaskActivityEventKind,
  type TaskActivityItem,
} from "@ega/domain";

export type TaskActivityDelta = Record<
  string,
  { from?: unknown; to?: unknown } | null | undefined
>;

export type TaskActivityStatusSource = {
  id: string;
  taskId?: string | null;
  fromStatus: string | null;
  toStatus: string;
  occurredAt: string;
  actor: TaskActivityActor;
};

export type TaskActivityLedgerSource = {
  id: string;
  taskId?: string | null;
  kind: TaskActivityEventKind;
  occurredAt: string;
  actor: TaskActivityActor;
  delta?: TaskActivityDelta | null;
};

export type TaskActivitySessionSource = {
  id: string;
  taskId?: string | null;
  startedAt: string;
  endedAt: string | null;
  actor: TaskActivityActor;
};

export type TaskActivitySources = {
  statusEvents?: readonly TaskActivityStatusSource[];
  ledgerEvents?: readonly TaskActivityLedgerSource[];
  sessions?: readonly TaskActivitySessionSource[];
};

export type TaskActivityPage = {
  items: TaskActivityItem[];
  hasMore: boolean;
};

export type TaskActivityRowActorColumns = {
  actor_kind: string | null;
  actor_user_id?: string | null;
  actor_agent_id?: string | null;
  actor_label?: string | null;
};

/**
 * Map stored actor columns to the shared contract. Unknown or malformed values
 * fall back to `unknown` instead of guessing an owner or agent identity.
 */
export function taskActivityActorFromColumns(
  row: TaskActivityRowActorColumns,
): TaskActivityActor {
  const kind = (row.actor_kind ?? "unknown").trim();
  if (!isTaskActivityActorKind(kind)) return { kind: "unknown" };
  if (kind === "owner") {
    return { kind, userId: row.actor_user_id ?? null, label: row.actor_label ?? null };
  }
  if (kind === "agent") {
    return {
      kind,
      userId: row.actor_user_id ?? null,
      agentId: row.actor_agent_id ?? null,
      label: row.actor_label ?? null,
    };
  }
  return { kind };
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "string") {
    const date = /^\d{4}-\d{2}-\d{2}/.test(value) ? new Date(value) : null;
    if (date && !Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
    }
    return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  }
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  priority: "Priority",
  due_date: "Due date",
  planned_for_date: "Planned for",
  project_id: "Project",
  goal_id: "Goal",
  estimate_minutes: "Estimate",
  scheduled_start_at: "Scheduled start",
  scheduled_end_at: "Scheduled end",
  calendar_sync_enabled: "Calendar sync",
  calendar_reminder_minutes: "Calendar reminder",
  blocked_reason: "Blocked reason",
  focus_rank: "Focus pin",
  archived_at: "Archive state",
  remind_at: "Reminder",
  channel: "Reminder channel",
};

/** Human-readable line for one activity row; pure and unit-tested. */
export function describeTaskActivity(item: {
  kind: TaskActivityItem["kind"];
  fromStatus?: string | null;
  toStatus?: string | null;
  delta?: TaskActivityDelta | null;
}): string {
  switch (item.kind) {
    case "status":
      return item.fromStatus
        ? `Status changed from ${item.fromStatus.replace(/_/g, " ")} to ${(item.toStatus ?? "").replace(/_/g, " ")}`
        : `Marked ${(item.toStatus ?? "").replace(/_/g, " ")}`;
    case "created":
      return "Task created";
    case "archived":
      return "Task archived";
    case "restored":
      return "Task restored";
    case "session":
      return "Timer session recorded";
    case "reminder_scheduled":
      return describeReminderScheduled(item.delta);
    case "reminder_updated":
      return describeFieldDelta(item.delta, "Reminder updated");
    case "reminder_cancelled":
      return "Reminder cancelled";
    case "comment":
      return "Comment added";
    default:
      return describeFieldDelta(item.delta, "Task updated");
  }
}

function describeReminderScheduled(delta: TaskActivityDelta | null | undefined): string {
  const remindAt = delta?.remind_at?.to;
  return remindAt === undefined || remindAt === null
    ? "Reminder set"
    : `Reminder set for ${formatValue(remindAt)}`;
}

function describeFieldDelta(
  delta: TaskActivityDelta | null | undefined,
  fallback: string,
): string {
  const entries = Object.entries(delta ?? {}).filter(([, value]) => value);
  if (entries.length === 0) return fallback;
  return entries
    .map(([field, value]) => {
      const label = FIELD_LABELS[field] ?? field.replace(/_/g, " ");
      if (field === "title" || field === "description") return `${label} edited`;
      return `${label}: ${formatValue(value?.from)} → ${formatValue(value?.to)}`;
    })
    .join(" · ");
}

function timestampOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Newest first; equal instants fall back to the stable row id, descending. */
export function compareTaskActivityItems(
  left: TaskActivityItem,
  right: TaskActivityItem,
): number {
  const byTime = timestampOf(right.occurredAt) - timestampOf(left.occurredAt);
  if (byTime !== 0) return byTime;
  if (left.id === right.id) return 0;
  return left.id < right.id ? 1 : -1;
}

/**
 * Merge authoritative sources into one ordered stream. Duplicate stable ids are
 * collapsed so a source that is both unioned and appended cannot double-count.
 */
export function buildTaskActivity(sources: TaskActivitySources): TaskActivityItem[] {
  const items: TaskActivityItem[] = [
    ...(sources.statusEvents ?? []).map((row) => ({
      id: `status-${row.id}`,
      taskId: row.taskId ?? null,
      kind: "status" as const,
      occurredAt: row.occurredAt,
      actor: row.actor,
      summary: describeTaskActivity({
        kind: "status",
        fromStatus: row.fromStatus,
        toStatus: row.toStatus,
      }),
    })),
    ...(sources.ledgerEvents ?? []).map((row) => ({
      id: `field-${row.id}`,
      taskId: row.taskId ?? null,
      kind: row.kind,
      occurredAt: row.occurredAt,
      actor: row.actor,
      summary: describeTaskActivity({ kind: row.kind, delta: row.delta ?? {} }),
    })),
    ...(sources.sessions ?? []).map((row) => ({
      id: `session-${row.id}`,
      taskId: row.taskId ?? null,
      kind: "session" as const,
      occurredAt: row.startedAt,
      actor: row.actor,
      summary: row.endedAt ? "Timer session recorded" : "Timer session started",
    })),
  ];

  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort(compareTaskActivityItems);
}

export type TaskActivityPagination = { limit: number; offset?: number };

/** Offset pagination over the deterministic merged order. */
export function paginateTaskActivity(
  items: readonly TaskActivityItem[],
  pagination: TaskActivityPagination,
): TaskActivityPage {
  const limit = Math.max(1, Math.trunc(pagination.limit));
  const offset = Math.max(0, Math.trunc(pagination.offset ?? 0));
  return {
    items: items.slice(offset, offset + limit),
    hasMore: items.length > offset + limit,
  };
}

/** Latest rows for a project card, newest first with a stable tie-break. */
export function latestTaskActivity(
  sources: TaskActivitySources,
  limit: number,
): TaskActivityItem[] {
  return buildTaskActivity(sources).slice(0, Math.max(1, Math.trunc(limit)));
}

/** Narrowing helper for stored rows whose kind is untrusted text. */
export function taskActivityEventKindFromColumn(value: string): TaskActivityEventKind | null {
  return isTaskActivityEventKind(value) ? value : null;
}
