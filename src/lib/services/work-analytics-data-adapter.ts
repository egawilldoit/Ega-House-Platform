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
