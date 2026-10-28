import type { TaskActivityItem } from "@/lib/task-activity";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedUserId } from "./task-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type TaskActivityPage = {
  items: TaskActivityItem[];
  hasMore: boolean;
  errorMessage: string | null;
};

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

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
};

/** Human-readable line for one activity row; pure and unit-tested. */
export function describeTaskActivity(item: {
  kind: TaskActivityItem["kind"];
  fromStatus?: string | null;
  toStatus?: string | null;
  delta?: Record<string, { from?: unknown; to?: unknown }> | null;
  excerpt?: string | null;
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
    case "commented": {
      const excerpt = item.excerpt?.trim();
      return excerpt ? `Commented: ${excerpt}` : "Commented";
    }
    case "session":
      return "Timer session recorded";
    default: {
      const entries = Object.entries(item.delta ?? {}).filter(([, value]) => value);
      if (entries.length === 0) return "Task updated";
      return entries
        .map(([field, value]) => {
          const label = FIELD_LABELS[field] ?? field.replace(/_/g, " ");
          if (field === "title" || field === "description") return `${label} edited`;
          return `${label}: ${formatValue(value.from)} → ${formatValue(value.to)}`;
        })
        .join(" · ");
    }
  }
}

/**
 * Owner-scoped activity read model.
 *
 * Unions the canonical status ledger, the field-change ledger and timer session
 * evidence, then orders by `occurred_at` descending with the row id as a stable
 * tie-breaker. Pagination is offset-based over that deterministic order.
 */
export async function getTaskActivity(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; limit?: number; offset?: number },
): Promise<TaskActivityPage> {
  const supabase = options?.supabase ?? (await createClient());
  const ownerUserId = await getAuthenticatedUserId(supabase);
  if (!ownerUserId) return { items: [], hasMore: false, errorMessage: "Task was not found." };

  const limit = Math.min(Math.max(options?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(options?.offset ?? 0, 0);

  const [statusEvents, fieldEvents, sessions] = await Promise.all([
    supabase
      .from("task_status_events")
      .select("id, from_status, to_status, occurred_at")
      .eq("task_id", taskId)
      .eq("owner_user_id", ownerUserId)
      .order("occurred_at", { ascending: false })
      .limit(limit + offset + 1),
    supabase
      .from("task_activity_events")
      .select("id, actor_kind, actor_label, event_kind, delta, occurred_at")
      .eq("task_id", taskId)
      .eq("owner_user_id", ownerUserId)
      .order("occurred_at", { ascending: false })
      .limit(limit + offset + 1),
    supabase
      .from("task_sessions")
      .select("id, started_at, ended_at")
      .eq("task_id", taskId)
      .eq("owner_user_id", ownerUserId)
      .order("started_at", { ascending: false })
      .limit(limit + offset + 1),
  ]);

  if (statusEvents.error || fieldEvents.error || sessions.error) {
    return { items: [], hasMore: false, errorMessage: "Unable to load task activity right now." };
  }

  const items: TaskActivityItem[] = [
    ...(statusEvents.data ?? []).map((row) => ({
      id: `status-${row.id}`,
      kind: "status" as const,
      occurredAt: row.occurred_at,
      actorKind: "owner" as const,
      actorLabel: "Owner",
      summary: describeTaskActivity({
        kind: "status",
        fromStatus: row.from_status,
        toStatus: row.to_status,
      }),
    })),
    ...(fieldEvents.data ?? []).map((row) => ({
      id: `field-${row.id}`,
      kind: row.event_kind as TaskActivityItem["kind"],
      occurredAt: row.occurred_at,
      actorKind: row.actor_kind as TaskActivityItem["actorKind"],
      actorLabel: row.actor_label,
      summary: describeTaskActivity({
        kind: row.event_kind as TaskActivityItem["kind"],
        delta: (row.delta ?? {}) as Record<string, { from?: unknown; to?: unknown }>,
        excerpt:
          typeof (row.delta as Record<string, unknown> | null)?.excerpt === "string"
            ? String((row.delta as Record<string, unknown>).excerpt)
            : null,
      }),
    })),
    ...(sessions.data ?? []).map((row) => ({
      id: `session-${row.id}`,
      kind: "session" as const,
      occurredAt: row.started_at,
      actorKind: "owner" as const,
      actorLabel: "Owner",
      summary: row.ended_at ? "Timer session recorded" : "Timer session started",
    })),
  ].sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) {
      return right.occurredAt.localeCompare(left.occurredAt);
    }
    return right.id.localeCompare(left.id);
  });

  const page = items.slice(offset, offset + limit);
  return { items: page, hasMore: items.length > offset + limit, errorMessage: null };
}

export async function getProjectTaskActivity(
  taskIds: string[],
  options?: { supabase?: SupabaseServerClient; limit?: number },
): Promise<TaskActivityItem[]> {
  if (taskIds.length === 0) return [];
  const supabase = options?.supabase ?? (await createClient());
  const ownerUserId = await getAuthenticatedUserId(supabase);
  if (!ownerUserId) return [];

  const limit = Math.min(Math.max(options?.limit ?? 5, 1), 20);
  const [fieldEvents, statusEvents] = await Promise.all([
    supabase
      .from("task_activity_events")
      .select("id, task_id, actor_kind, actor_label, event_kind, delta, occurred_at")
      .in("task_id", taskIds)
      .eq("owner_user_id", ownerUserId)
      .order("occurred_at", { ascending: false })
      .limit(limit),
    supabase
      .from("task_status_events")
      .select("id, task_id, from_status, to_status, occurred_at")
      .in("task_id", taskIds)
      .eq("owner_user_id", ownerUserId)
      .order("occurred_at", { ascending: false })
      .limit(limit),
  ]);

  if (fieldEvents.error || statusEvents.error) return [];

  return [
    ...(fieldEvents.data ?? []).map((row) => ({
      id: `field-${row.id}`,
      taskId: row.task_id,
      kind: row.event_kind as TaskActivityItem["kind"],
      occurredAt: row.occurred_at,
      actorKind: row.actor_kind as TaskActivityItem["actorKind"],
      actorLabel: row.actor_label,
      summary: describeTaskActivity({
        kind: row.event_kind as TaskActivityItem["kind"],
        delta: (row.delta ?? {}) as Record<string, { from?: unknown; to?: unknown }>,
        excerpt:
          typeof (row.delta as Record<string, unknown> | null)?.excerpt === "string"
            ? String((row.delta as Record<string, unknown>).excerpt)
            : null,
      }),
    })),
    ...(statusEvents.data ?? []).map((row) => ({
      id: `status-${row.id}`,
      taskId: row.task_id,
      kind: "status" as const,
      occurredAt: row.occurred_at,
      actorKind: "owner" as const,
      actorLabel: "Owner",
      summary: describeTaskActivity({
        kind: "status",
        fromStatus: row.from_status,
        toStatus: row.to_status,
      }),
    })),
  ]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, limit);
}
