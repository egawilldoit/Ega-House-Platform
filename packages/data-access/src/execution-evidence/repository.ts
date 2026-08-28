import type {
  AuthenticatedActor,
  ExecutionEvidenceRepository,
  ExecutionEvidenceSessionRow,
  ExecutionEvidenceWindow,
  RepositoryResult,
} from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizeSupabaseError } from "../supabase/errors";

type Row = Record<string, unknown>;

/**
 * Canonical Supabase implementation of ExecutionEvidenceRepository.
 * Owner-scoped and bounded to the explicit window — never reads across
 * owners and never widens the window implicitly.
 */
export class SupabaseExecutionEvidenceRepository implements ExecutionEvidenceRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async listSessionsForWindow(
    actor: AuthenticatedActor,
    window: ExecutionEvidenceWindow,
    options: Readonly<{ limit?: number }> = {},
  ): Promise<RepositoryResult<ExecutionEvidenceSessionRow[]>> {
    const limit = options.limit ?? 2000;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = this.supabase
      .from("task_sessions")
      .select(
        "id, task_id, started_at, ended_at, duration_seconds, tasks(id, title, project_id, goal_id, estimate_minutes, projects(id, name), goals(id, title))",
      )
      .eq("owner_user_id", actor.userId)
      .lt("started_at", window.endIso)
      .or(`ended_at.is.null,ended_at.gte.${window.startIso}`)
      .order("started_at", { ascending: true })
      .order("task_id", { ascending: true })
      .limit(limit);

    const result = await query;

    if (result.error) {
      return { ok: false, error: sanitizeSupabaseError(result.error) };
    }

    const rows = (result.data ?? []) as Row[];
    const mapped: ExecutionEvidenceSessionRow[] = rows.map((row) => {
      const tasks = row.tasks as
        | {
            id?: string | null;
            title?: string | null;
            project_id?: string | null;
            goal_id?: string | null;
            estimate_minutes?: number | null;
            projects?: { id?: string | null; name?: string | null } | null;
            goals?: { id?: string | null; title?: string | null } | null;
          }
        | null
        | undefined;

      return {
        id: row.id !== undefined && row.id !== null ? String(row.id) : undefined,
        task_id: String(row.task_id),
        started_at: String(row.started_at),
        ended_at: row.ended_at === null || row.ended_at === undefined ? null : String(row.ended_at),
        duration_seconds:
          typeof row.duration_seconds === "number" ? (row.duration_seconds as number) : null,
        tasks: tasks ?? null,
      };
    });

    return { ok: true, value: mapped };
  }
}
