import { createClient } from "@/lib/supabase/server";
import type { ExecutionEvidenceSessionRow, ExecutionEvidenceWindow } from "@/lib/services/execution-evidence-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) return supabase;
  return createClient();
}

export async function getWorkAnalyticsSessionsForWindow(args: {
  ownerUserId: string;
  window: ExecutionEvidenceWindow;
  supabase?: SupabaseServerClient;
}) {
  const supabase = await resolveSupabaseClient(args.supabase);
  const { data, error } = await supabase
    .from("task_sessions")
    .select("task_id, started_at, ended_at, duration_seconds, tasks(id, title, project_id, projects(id, name), goals(id, title))")
    .eq("owner_user_id", args.ownerUserId)
    .lt("started_at", args.window.endIso)
    .or(`ended_at.is.null,ended_at.gte.${args.window.startIso}`)
    .order("started_at", { ascending: false });

  if (error) {
    return { data: null, errorMessage: `Failed to load work analytics sessions: ${error.message}` };
  }

  return { data: (data ?? []) as ExecutionEvidenceSessionRow[], errorMessage: null };
}

export type WorkAnalyticsTaskCounts = {
  completedCount: number;
  createdCount: number;
  blockedCount: number;
};

export async function getWorkAnalyticsTaskCounts(args: {
  ownerUserId: string;
  window: ExecutionEvidenceWindow;
  supabase?: SupabaseServerClient;
}): Promise<{ data: WorkAnalyticsTaskCounts | null; errorMessage: string | null }> {
  const supabase = await resolveSupabaseClient(args.supabase);

  const { data, error } = await supabase
    .from("tasks")
    .select("status, completed_at, blocked_reason")
    .eq("owner_user_id", args.ownerUserId)
    .lt("created_at", args.window.endIso)
    .or(`completed_at.is.null,completed_at.gte.${args.window.startIso}`);

  if (error) {
    return { data: null, errorMessage: `Failed to load work analytics task counts: ${error.message}` };
  }

  const tasks = data ?? [];
  let completedCount = 0;
  let createdCount = 0;
  let blockedCount = 0;

  for (const task of tasks) {
    // Count tasks created within the window
    createdCount++;

    // Count completed tasks (where completed_at falls within window or task status is done)
    if (task.status === "done") {
      completedCount++;
    }

    // Count blocked tasks
    if (task.blocked_reason || task.status === "blocked") {
      blockedCount++;
    }
  }

  return { data: { completedCount, createdCount, blockedCount }, errorMessage: null };
}
