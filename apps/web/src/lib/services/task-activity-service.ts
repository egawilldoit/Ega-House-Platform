import {
  buildTaskActivity,
  latestTaskActivity,
  paginateTaskActivity,
  taskActivityActorFromColumns,
  taskActivityEventKindFromColumn,
  type TaskActivityLedgerSource,
  type TaskActivitySessionSource,
  type TaskActivityStatusSource,
} from "@ega/application";
import type { TaskActivityItem } from "@ega/domain";
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

const STATUS_EVENT_COLUMNS =
  "id, task_id, from_status, to_status, occurred_at, actor_kind, actor_user_id, actor_agent_id, actor_label";
const LEDGER_EVENT_COLUMNS =
  "id, task_id, actor_kind, actor_user_id, actor_agent_id, actor_label, event_kind, delta, occurred_at";
const SESSION_COLUMNS =
  "id, task_id, started_at, ended_at, actor_kind, actor_user_id, actor_agent_id, actor_label";

/** Display summary shared with the rest of the app. */
export { describeTaskActivity } from "@ega/application";

type StatusEventRow = {
  id: string;
  task_id: string | null;
  from_status: string | null;
  to_status: string;
  occurred_at: string;
  actor_kind: string | null;
  actor_user_id: string | null;
  actor_agent_id: string | null;
  actor_label: string | null;
};

type LedgerEventRow = {
  id: string;
  task_id: string | null;
  actor_kind: string | null;
  actor_user_id: string | null;
  actor_agent_id: string | null;
  actor_label: string | null;
  event_kind: string;
  delta: unknown;
  occurred_at: string;
};

type SessionRow = {
  id: string;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  actor_kind: string | null;
  actor_user_id: string | null;
  actor_agent_id: string | null;
  actor_label: string | null;
};

function toStatusSources(rows: readonly StatusEventRow[]): TaskActivityStatusSource[] {
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    occurredAt: row.occurred_at,
    actor: taskActivityActorFromColumns(row),
  }));
}

function toLedgerSources(rows: readonly LedgerEventRow[]): TaskActivityLedgerSource[] {
  return rows.flatMap((row) => {
    const kind = taskActivityEventKindFromColumn(row.event_kind);
    if (!kind) return [];
    return [{
      id: row.id,
      taskId: row.task_id,
      kind,
      occurredAt: row.occurred_at,
      actor: taskActivityActorFromColumns(row),
      delta: (row.delta ?? {}) as TaskActivityLedgerSource["delta"],
    }];
  });
}

function toSessionSources(rows: readonly SessionRow[]): TaskActivitySessionSource[] {
  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    actor: taskActivityActorFromColumns(row),
  }));
}

function clampLimit(value: number | undefined, fallback: number): number {
  return Math.min(Math.max(value ?? fallback, 1), MAX_LIMIT);
}

/**
 * Owner-scoped activity read model.
 *
 * Unions the canonical status ledger, the field/reminder/comment ledger and
 * timer session evidence, then orders by `occurred_at` descending with the row
 * id as a stable tie-breaker. Pagination is offset-based over that deterministic
 * order; callers can show the honest "older changes exist" state from
 * `hasMore`.
 */
export async function getTaskActivity(
  taskId: string,
  options?: { supabase?: SupabaseServerClient; limit?: number; offset?: number },
): Promise<TaskActivityPage> {
  const supabase = options?.supabase ?? (await createClient());
  const ownerUserId = await getAuthenticatedUserId(supabase);
  if (!ownerUserId) return { items: [], hasMore: false, errorMessage: "Task was not found." };

  const limit = clampLimit(options?.limit, DEFAULT_LIMIT);
  const offset = Math.max(options?.offset ?? 0, 0);
  const fetchLimit = limit + offset + 1;

  const [statusEvents, fieldEvents, sessions] = await Promise.all([
    supabase
      .from("task_status_events")
      .select(STATUS_EVENT_COLUMNS)
      .eq("task_id", taskId)
      .eq("owner_user_id", ownerUserId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(fetchLimit),
    supabase
      .from("task_activity_events")
      .select(LEDGER_EVENT_COLUMNS)
      .eq("task_id", taskId)
      .eq("owner_user_id", ownerUserId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(fetchLimit),
    supabase
      .from("task_sessions")
      .select(SESSION_COLUMNS)
      .eq("task_id", taskId)
      .eq("owner_user_id", ownerUserId)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(fetchLimit),
  ]);

  if (statusEvents.error || fieldEvents.error || sessions.error) {
    return { items: [], hasMore: false, errorMessage: "Unable to load task activity right now." };
  }

  const merged = buildTaskActivity({
    statusEvents: toStatusSources((statusEvents.data ?? []) as unknown as StatusEventRow[]),
    ledgerEvents: toLedgerSources((fieldEvents.data ?? []) as unknown as LedgerEventRow[]),
    sessions: toSessionSources((sessions.data ?? []) as unknown as SessionRow[]),
  });
  const page = paginateTaskActivity(merged, { limit, offset });
  return { ...page, errorMessage: null };
}

/** Newest project-wide rows for the project overview card. */
export async function getProjectTaskActivity(
  taskIds: string[],
  options?: { supabase?: SupabaseServerClient; limit?: number },
): Promise<TaskActivityItem[]> {
  if (taskIds.length === 0) return [];
  const supabase = options?.supabase ?? (await createClient());
  const ownerUserId = await getAuthenticatedUserId(supabase);
  if (!ownerUserId) return [];

  const limit = clampLimit(options?.limit ?? 5, 5);
  const [fieldEvents, statusEvents] = await Promise.all([
    supabase
      .from("task_activity_events")
      .select(LEDGER_EVENT_COLUMNS)
      .in("task_id", taskIds)
      .eq("owner_user_id", ownerUserId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit),
    supabase
      .from("task_status_events")
      .select(STATUS_EVENT_COLUMNS)
      .in("task_id", taskIds)
      .eq("owner_user_id", ownerUserId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit),
  ]);

  if (fieldEvents.error || statusEvents.error) return [];

  return latestTaskActivity(
    {
      ledgerEvents: toLedgerSources((fieldEvents.data ?? []) as unknown as LedgerEventRow[]),
      statusEvents: toStatusSources((statusEvents.data ?? []) as unknown as StatusEventRow[]),
    },
    limit,
  );
}
