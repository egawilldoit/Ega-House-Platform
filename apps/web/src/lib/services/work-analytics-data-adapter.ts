import { createClient } from "@/lib/supabase/server";
import type { ExecutionEvidenceSessionRow, ExecutionEvidenceWindow } from "@/lib/services/execution-evidence-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function resolveSupabaseClient(supabase?: SupabaseServerClient) {
  if (supabase) return supabase;
  return createClient();
}

function isValidWindowIso(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

export async function getWorkAnalyticsSessionsForWindow(args: {
  ownerUserId: string;
  window: ExecutionEvidenceWindow;
  supabase?: SupabaseServerClient;
}) {
  if (!isValidWindowIso(args.window.startIso) || !isValidWindowIso(args.window.endIso)) {
    return { data: null, errorMessage: "Invalid window for work analytics." };
  }
  const supabase = await resolveSupabaseClient(args.supabase);
  const { data, error } = await supabase
    .from("task_sessions")
    .select("task_id, started_at, ended_at, duration_seconds, tasks(id, title, project_id, estimate_minutes, projects(id, name, areas(id, name)), goals(id, title))")
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

/**
 * Count tasks completed inside a canonical window.
 *
 * Single owner for the "completed in this window" rule used by Analytics and
 * Home. It counts the durable `completed_at` timestamp (maintained by the task
 * status trigger) and deliberately does not filter `archived_at`, so historical
 * completion totals survive archiving.
 */
export async function getCompletedTaskCountForWindow(args: {
  ownerUserId: string;
  window: ExecutionEvidenceWindow;
  supabase?: SupabaseServerClient;
}): Promise<{ data: number | null; errorMessage: string | null }> {
  const supabase = await resolveSupabaseClient(args.supabase);
  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", args.ownerUserId)
    .eq("status", "done")
    .gte("completed_at", args.window.startIso)
    .lt("completed_at", args.window.endIso);

  if (error) {
    return { data: null, errorMessage: `Failed to load completed task count: ${error.message}` };
  }

  return { data: count ?? 0, errorMessage: null };
}

export async function getWorkAnalyticsTaskCounts(args: {
  ownerUserId: string;
  window: ExecutionEvidenceWindow;
  supabase?: SupabaseServerClient;
}): Promise<{ data: WorkAnalyticsTaskCounts | null; errorMessage: string | null }> {
  const supabase = await resolveSupabaseClient(args.supabase);

  // Count tasks created within the window: created_at >= start AND created_at < end
  const { count: createdCountRaw, error: createdError } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", args.ownerUserId)
    .gte("created_at", args.window.startIso)
    .lt("created_at", args.window.endIso);

  if (createdError) {
    return { data: null, errorMessage: `Failed to load work analytics task counts: ${createdError.message}` };
  }
  const createdCount = createdCountRaw ?? 0;

  // Count tasks completed within the window through the shared rule.
  const completedResult = await getCompletedTaskCountForWindow({
    ownerUserId: args.ownerUserId,
    window: args.window,
    supabase,
  });

  if (completedResult.errorMessage || completedResult.data === null) {
    return {
      data: null,
      errorMessage:
        completedResult.errorMessage ??
        "Failed to load work analytics task counts: completed count unavailable.",
    };
  }
  const completedCount = completedResult.data;

  // Count tasks that are currently blocked within scope:
  // completed_at IS NULL AND (blocked_reason IS NOT NULL OR status = 'blocked')
  // AND created_at < window.endIso (tasks that existed within the window)
  const { count: blockedCountRaw, error: blockedError } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("owner_user_id", args.ownerUserId)
    .is("completed_at", null)
    .or(`blocked_reason.not.is.null,status.eq.blocked`)
    .lt("created_at", args.window.endIso);

  if (blockedError) {
    return { data: null, errorMessage: `Failed to load work analytics task counts: ${blockedError.message}` };
  }
  const blockedCount = blockedCountRaw ?? 0;

  return { data: { completedCount, createdCount, blockedCount }, errorMessage: null };
}
