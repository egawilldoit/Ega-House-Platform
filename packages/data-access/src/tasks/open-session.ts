import type { RepositoryResult } from "@ega/application";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Keep `in` filters well below PostgREST URL limits. */
const TASK_ID_CHUNK = 200;

function asIds(value: unknown): string[] {
  return ((value ?? []) as Array<{ id?: unknown }>).map((row) => String(row.id ?? ""));
}

/**
 * Whether the owner currently has a running session on a task inside the
 * project or goal scope. Archiving a parent hides its children from active
 * surfaces, so it must refuse while work is attached to it — the same rule
 * that already blocks archiving an individual task with an open timer.
 */
export async function hasOpenTaskSessionForScope(
  supabase: SupabaseClient,
  ownerUserId: string,
  scope: { projectId: string } | { goalId: string },
): Promise<RepositoryResult<boolean>> {
  const column = "projectId" in scope ? "project_id" : "goal_id";
  const value = "projectId" in scope ? scope.projectId : scope.goalId;

  const tasks = await supabase
    .from("tasks")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .eq(column, value);

  if (tasks.error) return { ok: false, error: { code: "unknown" } };

  const taskIds = asIds(tasks.data).filter(Boolean);

  for (let index = 0; index < taskIds.length; index += TASK_ID_CHUNK) {
    const chunk = taskIds.slice(index, index + TASK_ID_CHUNK);
    const sessions = await supabase
      .from("task_sessions")
      .select("id")
      .eq("owner_user_id", ownerUserId)
      .in("task_id", chunk)
      .is("ended_at", null)
      .limit(1);

    if (sessions.error) return { ok: false, error: { code: "unknown" } };
    if (((sessions.data ?? []) as unknown[]).length > 0) {
      return { ok: true, value: true };
    }
  }

  return { ok: true, value: false };
}
