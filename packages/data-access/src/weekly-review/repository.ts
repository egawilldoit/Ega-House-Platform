import type {
  AuthenticatedActor,
  RepositoryResult,
  WeeklyReviewRepository,
  WeeklyReviewRow,
  WeeklyReviewTaskRepository,
  WeeklyReviewTaskActivityRow,
  ExecutionEvidenceWindow,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  return (value ?? []) as Row[];
}

function failure<T>(error: { code?: string; message?: string } | null): RepositoryResult<T> {
  return { ok: false, error: sanitizeSupabaseError(error) };
}

function mapReviewRow(row: Row): WeeklyReviewRow {
  return {
    id: String(row.id),
    weekStart: String(row.week_start),
    weekEnd: String(row.week_end),
    summary: row.summary !== null && row.summary !== undefined ? String(row.summary) : null,
    wins: row.wins !== null && row.wins !== undefined ? String(row.wins) : null,
    blockers: row.blockers !== null && row.blockers !== undefined ? String(row.blockers) : null,
    nextSteps: row.next_steps !== null && row.next_steps !== undefined ? String(row.next_steps) : null,
    createdAt: String(row.created_at),
    updatedAt: row.updated_at !== null && row.updated_at !== undefined ? String(row.updated_at) : null,
    officialEmailStatus:
      row.official_email_status !== null && row.official_email_status !== undefined
        ? String(row.official_email_status)
        : null,
    officialEmailSentAt:
      row.official_email_sent_at !== null && row.official_email_sent_at !== undefined
        ? String(row.official_email_sent_at)
        : null,
  };
}

function mapTaskActivity(row: Row): WeeklyReviewTaskActivityRow {
  const projects = row.projects as { name?: string | null } | null | undefined;
  const goals = row.goals as { title?: string | null } | null | undefined;
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    blockedReason:
      row.blocked_reason !== null && row.blocked_reason !== undefined ? String(row.blocked_reason) : null,
    estimateMinutes:
      typeof row.estimate_minutes === "number" ? (row.estimate_minutes as number) : null,
    completedAt:
      row.completed_at !== null && row.completed_at !== undefined ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at),
    projectName: projects?.name ?? null,
    goalTitle: goals?.title ?? null,
  };
}

export class SupabaseWeeklyReviewRepository implements WeeklyReviewRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getSavedReview(
    actor: AuthenticatedActor,
    weekStart: string,
    weekEnd: string,
  ): Promise<RepositoryResult<WeeklyReviewRow | null>> {
    const result = await this.supabase
      .from("week_reviews")
      .select(
        "id, week_start, week_end, summary, wins, blockers, next_steps, created_at, updated_at, official_email_status, official_email_sent_at",
      )
      .eq("owner_user_id", actor.userId)
      .eq("week_start", weekStart)
      .eq("week_end", weekEnd)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapReviewRow(result.data as Row) };
  }

  async listPastReviews(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<WeeklyReviewRow[]>> {
    const result = await this.supabase
      .from("week_reviews")
      .select(
        "id, week_start, week_end, summary, wins, blockers, next_steps, created_at, updated_at, official_email_status, official_email_sent_at",
      )
      .eq("owner_user_id", actor.userId)
      .order("week_start", { ascending: false })
      .limit(limit);

    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapReviewRow) };
  }

  async getPreviousReview(
    actor: AuthenticatedActor,
    weekStart: string,
  ): Promise<RepositoryResult<WeeklyReviewRow | null>> {
    const result = await this.supabase
      .from("week_reviews")
      .select(
        "id, week_start, week_end, summary, wins, blockers, next_steps, created_at, updated_at, official_email_status, official_email_sent_at",
      )
      .eq("owner_user_id", actor.userId)
      .lt("week_start", weekStart)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) return failure(result.error);
    if (!result.data) return { ok: true, value: null };
    return { ok: true, value: mapReviewRow(result.data as Row) };
  }
}

export class SupabaseWeeklyReviewTaskRepository implements WeeklyReviewTaskRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async countTasksCreatedForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
  ): Promise<RepositoryResult<number>> {
    const result = await this.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", actor.userId)
      .gte("created_at", window.startIso)
      .lt("created_at", window.endIso);

    if (result.error) return failure(result.error);
    return { ok: true, value: result.count ?? 0 };
  }

  async listGoalsTouchedForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
  ): Promise<RepositoryResult<Array<{ status: string }>>> {
    const result = await this.supabase
      .from("goals")
      .select("status")
      .eq("owner_user_id", actor.userId)
      .gte("updated_at", window.startIso)
      .lt("updated_at", window.endIso);

    if (result.error) return failure(result.error);
    return {
      ok: true,
      value: asRows(result.data).map((row) => ({ status: String(row.status) })),
    };
  }

  async listBlockedTasks(
    actor: AuthenticatedActor,
    limit: number,
  ): Promise<RepositoryResult<Array<{ id: string; title: string; blockedReason: string | null; updatedAt: string }>>> {
    // Mirrors previous web getTasksForReview: current blocked tasks, not window-bounded
    const result = await this.supabase
      .from("tasks")
      .select("id, title, blocked_reason, updated_at, status")
      .eq("owner_user_id", actor.userId)
      .is("archived_at", null)
      .or("blocked_reason.not.is.null,status.eq.blocked")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (result.error) return failure(result.error);
    return {
      ok: true,
      value: asRows(result.data).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        blockedReason:
          row.blocked_reason !== null && row.blocked_reason !== undefined
            ? String(row.blocked_reason)
            : null,
        updatedAt: String(row.updated_at),
      })),
    };
  }

  async listCompletedTasksForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
    limit: number,
  ): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>> {
    const result = await this.supabase
      .from("tasks")
      .select(
        "id, title, status, blocked_reason, estimate_minutes, completed_at, updated_at, projects(name), goals(title)",
      )
      .eq("owner_user_id", actor.userId)
      .eq("status", "done")
      .lt("updated_at", window.endIso)
      .or(`completed_at.gte.${window.startIso},updated_at.gte.${window.startIso}`)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (result.error) return failure(result.error);
    const filtered = asRows(result.data).filter((row) => {
      const completedAt = row.completed_at !== null && row.completed_at !== undefined ? String(row.completed_at) : null;
      const updatedAt = String(row.updated_at);
      if (completedAt) {
        return completedAt >= window.startIso && completedAt < window.endIso;
      }
      return updatedAt >= window.startIso && updatedAt < window.endIso;
    });
    return { ok: true, value: filtered.map(mapTaskActivity) };
  }

  async listCarriedTasksForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
    limit: number,
  ): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>> {
    const result = await this.supabase
      .from("tasks")
      .select(
        "id, title, status, blocked_reason, estimate_minutes, completed_at, updated_at, projects(name), goals(title)",
      )
      .eq("owner_user_id", actor.userId)
      .is("archived_at", null)
      .neq("status", "done")
      .lt("created_at", window.endIso)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (result.error) return failure(result.error);
    return { ok: true, value: asRows(result.data).map(mapTaskActivity) };
  }

  async listBlockedTasksForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
    limit: number,
  ): Promise<RepositoryResult<WeeklyReviewTaskActivityRow[]>> {
    const result = await this.supabase
      .from("tasks")
      .select(
        "id, title, status, blocked_reason, estimate_minutes, completed_at, updated_at, projects(name), goals(title)",
      )
      .eq("owner_user_id", actor.userId)
      .is("archived_at", null)
      .eq("status", "blocked")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (result.error) return failure(result.error);
    // Original draft service does not filter blocked tasks by window; keep same
    return { ok: true, value: asRows(result.data).map(mapTaskActivity).slice(0, limit) };
  }
}
