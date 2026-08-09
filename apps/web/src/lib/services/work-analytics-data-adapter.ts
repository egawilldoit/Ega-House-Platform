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
    .select("task_id, started_at, ended_at, duration_seconds, tasks(id, title, project_id, estimate_minutes, projects(id, name), goals(id, title))")
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

  // Count tasks created within the window: created_at >= start AND created_at < end
  const { data: createdData, error: createdError } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", args.ownerUserId)
    .gte("created_at", args.window.startIso)
    .lt("created_at", args.window.endIso);

  if (createdError) {
    return { data: null, errorMessage: `Failed to load work analytics task counts: ${createdError.message}` };
  }
  const createdCount = createdData?.length ?? 0;

  // Count tasks completed within the window: completed_at >= start AND completed_at < end AND status = 'done'
  const { data: completedData, error: completedError } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", args.ownerUserId)
    .eq("status", "done")
    .gte("completed_at", args.window.startIso)
    .lt("completed_at", args.window.endIso);

  if (completedError) {
    return { data: null, errorMessage: `Failed to load work analytics task counts: ${completedError.message}` };
  }
  const completedCount = completedData?.length ?? 0;

  // Count tasks that are currently blocked within scope:
  // completed_at IS NULL AND (blocked_reason IS NOT NULL OR status = 'blocked')
  // AND created_at < window.endIso (tasks that existed within the window)
  const { data: blockedData, error: blockedError } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", args.ownerUserId)
    .is("completed_at", null)
    .or(`blocked_reason.not.is.null,status.eq.blocked`)
    .lt("created_at", args.window.endIso);

  if (blockedError) {
    return { data: null, errorMessage: `Failed to load work analytics task counts: ${blockedError.message}` };
  }
  const blockedCount = blockedData?.length ?? 0;

  return { data: { completedCount, createdCount, blockedCount }, errorMessage: null };
}
