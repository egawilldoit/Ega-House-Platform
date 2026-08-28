import type {
  AuthenticatedActor,
  FrictionGoalRow,
  FrictionRepository,
  FrictionTaskRow,
  RepositoryResult,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type TaskRow = {
  id: unknown;
  title: unknown;
  blocked_reason: unknown;
  status: unknown;
  updated_at: unknown;
  project_id: unknown;
  goal_id: unknown;
  archived_at: unknown;
};

type GoalRow = {
  id: unknown;
  title: unknown;
  status: unknown;
  updated_at: unknown;
  project_id: unknown;
};

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function failure<T>(error: { code?: string; message?: string } | null): RepositoryResult<T> {
  return { ok: false, error: sanitizeSupabaseError(error) };
}

/**
 * Owner-scoped friction repository — queries are always filtered by
 * `owner_user_id = actor.userId` so RLS and application scoping agree.
 * Business rules (archived/completed filtering, stale threshold) remain in
 * the application read model; this adapter only projects raw rows.
 */
export class SupabaseFrictionRepository implements FrictionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listTasks(actor: AuthenticatedActor): Promise<RepositoryResult<FrictionTaskRow[]>> {
    const result = await this.supabase
      .from("tasks")
      .select("id,title,blocked_reason,status,updated_at,project_id,goal_id,archived_at")
      .eq("owner_user_id", actor.userId)
      .order("updated_at", { ascending: false });

    if (result.error) return failure(result.error);

    const rows = (result.data ?? []) as TaskRow[];
    return {
      ok: true,
      value: rows.map(
        (row): FrictionTaskRow => ({
          id: String(row.id),
          title: String(row.title),
          blockedReason: asNullableString(row.blocked_reason),
          status: String(row.status),
          updatedAt: String(row.updated_at),
          projectId: String(row.project_id),
          goalId: asNullableString(row.goal_id),
          archivedAt: asNullableString(row.archived_at),
        }),
      ),
    };
  }

  async listGoals(actor: AuthenticatedActor): Promise<RepositoryResult<FrictionGoalRow[]>> {
    const result = await this.supabase
      .from("goals")
      .select("id,title,status,updated_at,project_id")
      .eq("owner_user_id", actor.userId)
      .order("updated_at", { ascending: false });

    if (result.error) return failure(result.error);

    const rows = (result.data ?? []) as GoalRow[];
    return {
      ok: true,
      value: rows.map(
        (row): FrictionGoalRow => ({
          id: String(row.id),
          title: String(row.title),
          status: String(row.status),
          updatedAt: String(row.updated_at),
          projectId: String(row.project_id),
        }),
      ),
    };
  }
}
