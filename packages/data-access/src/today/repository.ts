import type {
  AuthenticatedActor,
  RepositoryResult,
  TodayActiveTimer,
  TodayReadPort,
  TodaySourceTask,
  TodayTimerSnapshot,
} from "@ega/application";
import { getSessionOverlapSeconds } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type Row = Record<string, unknown>;

const TASK_SELECT = [
  "id",
  "title",
  "description",
  "blocked_reason",
  "status",
  "priority",
  "due_date",
  "estimate_minutes",
  "scheduled_start_at",
  "scheduled_end_at",
  "focus_rank",
  "planned_for_date",
  "updated_at",
  "completed_at",
  "projects(name, slug)",
  "goals(title)",
].join(",");

const SESSION_SELECT = "id, task_id, started_at, ended_at, duration_seconds, tasks(title)";

function asRows(value: unknown): Row[] {
  return (value ?? []) as Row[];
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number"
    ? value
    : value === null || value === undefined
      ? null
      : Number(value);
}

function mapTask(row: Row): TodaySourceTask {
  const projects = row.projects as { name?: string | null; slug?: string | null } | null | undefined;
  const goals = row.goals as { title?: string | null } | null | undefined;
  return {
    id: String(row.id),
    title: String(row.title),
    description: asNullableString(row.description),
    blockedReason: asNullableString(row.blocked_reason),
    status: String(row.status),
    priority: String(row.priority),
    dueDate: asNullableString(row.due_date),
    estimateMinutes: asNullableNumber(row.estimate_minutes),
    scheduledStartAt: asNullableString(row.scheduled_start_at),
    scheduledEndAt: asNullableString(row.scheduled_end_at),
    focusRank: asNullableNumber(row.focus_rank),
    plannedForDate: asNullableString(row.planned_for_date),
    updatedAt: String(row.updated_at),
    completedAt: asNullableString(row.completed_at),
    projectName: projects?.name ?? null,
    projectSlug: projects?.slug ?? null,
    goalTitle: goals?.title ?? null,
  };
}

export class SupabaseTodayReadPort implements TodayReadPort {
  constructor(private readonly supabase: SupabaseClient) {}

  async listSelectedTasks(
    actor: AuthenticatedActor,
    input: Readonly<{ today: string; windowStartIso?: string; windowEndIso?: string }>,
  ): Promise<RepositoryResult<TodaySourceTask[]>> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.today)) {
      return { ok: false, error: { code: "unknown" } };
    }
    // Canonical day window for scheduled_start_at — prefers caller-provided ResolvedTimeContext.dayWindow
    // (server-TZ independent). Falls back to UTC midnight for legacy callers.
    let dayStartIso: string;
    let nextDayStartIso: string;
    if (input.windowStartIso && input.windowEndIso) {
      const s = new Date(input.windowStartIso).getTime();
      const e = new Date(input.windowEndIso).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
        return { ok: false, error: { code: "unknown" } };
      }
      dayStartIso = new Date(s).toISOString();
      nextDayStartIso = new Date(e).toISOString();
    } else {
      const dayStart = new Date(`${input.today}T00:00:00.000Z`);
      if (Number.isNaN(dayStart.valueOf())) {
        return { ok: false, error: { code: "unknown" } };
      }
      const nextDayStart = new Date(dayStart);
      nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);
      dayStartIso = dayStart.toISOString();
      nextDayStartIso = nextDayStart.toISOString();
    }

    const result = await this.supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("owner_user_id", actor.userId)
      .is("archived_at", null)
      .or(
        `planned_for_date.eq.${input.today},due_date.eq.${input.today},and(scheduled_start_at.gte.${dayStartIso},scheduled_start_at.lt.${nextDayStartIso})`,
      )
      .order("updated_at", { ascending: false })
      .limit(240);

    if (result.error) return { ok: false, error: sanitizeSupabaseError(result.error) };
    return { ok: true, value: asRows(result.data).map(mapTask) };
  }

  async listPinnedSuggestions(
    actor: AuthenticatedActor,
    input: Readonly<{ limit: number }>,
  ): Promise<RepositoryResult<TodaySourceTask[]>> {
    const result = await this.supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("owner_user_id", actor.userId)
      .is("archived_at", null)
      .not("focus_rank", "is", null)
      .neq("status", "done")
      .order("focus_rank", { ascending: true })
      .order("updated_at", { ascending: false })
      .limit(input.limit);

    if (result.error) return { ok: false, error: sanitizeSupabaseError(result.error) };
    return { ok: true, value: asRows(result.data).map(mapTask) };
  }

  async listInProgressSuggestions(
    actor: AuthenticatedActor,
    input: Readonly<{ limit: number }>,
  ): Promise<RepositoryResult<TodaySourceTask[]>> {
    const result = await this.supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("owner_user_id", actor.userId)
      .is("archived_at", null)
      .eq("status", "in_progress")
      .order("updated_at", { ascending: false })
      .limit(input.limit);

    if (result.error) return { ok: false, error: sanitizeSupabaseError(result.error) };
    return { ok: true, value: asRows(result.data).map(mapTask) };
  }

  async getTodayTimerSnapshot(
    actor: AuthenticatedActor,
    input: Readonly<{ nowIso: string; windowStartIso: string }>,
  ): Promise<RepositoryResult<TodayTimerSnapshot>> {
    const [openResult, recentResult] = await Promise.all([
      this.supabase
        .from("task_sessions")
        .select(SESSION_SELECT)
        .eq("owner_user_id", actor.userId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1),
      this.supabase
        .from("task_sessions")
        .select(SESSION_SELECT)
        .eq("owner_user_id", actor.userId)
        .order("started_at", { ascending: false })
        .limit(150),
    ]);

    if (openResult.error) return { ok: false, error: sanitizeSupabaseError(openResult.error) };
    if (recentResult.error) return { ok: false, error: sanitizeSupabaseError(recentResult.error) };

    const openSession = asRows(openResult.data)[0];
    const activeTimer: TodayActiveTimer | null = openSession
      ? { sessionId: String(openSession.id), taskId: String(openSession.task_id) }
      : null;

    // Canonical: use caller-provided windowStartIso (derived from ResolvedTimeContext.dayWindow or @ega/domain).
    // This is server-TZ independent; the window is [dayStartUtc, nowIso).
    const window = {
      startIso: input.windowStartIso,
      endIso: input.nowIso,
    };
    const trackedTodaySeconds = asRows(recentResult.data).reduce((sum, rawRow) => {
      const row = rawRow as Record<string, unknown>;
      return (
        sum +
        getSessionOverlapSeconds(
          {
            startedAt: String(row.started_at),
            endedAt:
              row.ended_at === null || row.ended_at === undefined ? null : String(row.ended_at),
            durationSeconds:
              typeof row.duration_seconds === "number" ? row.duration_seconds : null,
          },
          window,
          input.nowIso,
        )
      );
    }, 0);

    return { ok: true, value: { activeTimer, trackedTodaySeconds } };
  }
}
