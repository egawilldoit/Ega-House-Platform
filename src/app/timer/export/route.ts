import { createClient } from "@/lib/supabase/server";
import { buildTimerExportCsv } from "@/lib/timer-export";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_sessions")
    .select(
      "id, task_id, started_at, ended_at, duration_seconds, created_at, updated_at, tasks(title, status, priority, goals(title), projects(name, slug))",
    )
    .order("started_at", { ascending: false });

  if (error) {
    return Response.json({ error: "Unable to export timer sessions right now." }, { status: 500 });
  }

  const csv = buildTimerExportCsv(data ?? []);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="timer-sessions.csv"',
      "cache-control": "no-store",
    },
  });
}
