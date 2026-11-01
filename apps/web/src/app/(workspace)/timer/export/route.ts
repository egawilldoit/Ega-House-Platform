import { createClient } from "@/lib/supabase/server";
import { captureServerException } from "@/lib/monitoring/capture-server-exception";
import { buildTimerExportCsv } from "@/lib/timer-export";

export const dynamic = "force-dynamic";

const EXPORT_PAGE_SIZE = 500;

export async function GET() {
  const supabase = await createClient();
  const {
    data: authData,
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authData?.user) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const ownerUserId = authData.user.id;
  const rows: Array<Parameters<typeof buildTimerExportCsv>[0][number]> = [];

  let offset = 0;
  // Page explicitly so large accounts do not depend on PostgREST's default
  // max_rows cap and the query can use the owner-scoped index.
  while (true) {
    const { data, error } = await supabase
      .from("task_sessions")
      .select(
        "id, task_id, started_at, ended_at, duration_seconds, created_at, updated_at, tasks(title, status, priority, goals(title), projects(name, slug))",
      )
      .eq("owner_user_id", ownerUserId)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + EXPORT_PAGE_SIZE - 1);

    if (error) {
      captureServerException(error, {
        area: "route.timer-export",
        operation: "load_sessions",
        extras: { offset },
      });
      return Response.json(
        { error: "Unable to export timer sessions right now." },
        { status: 500 },
      );
    }

    const pageRows = (data ?? []) as Array<Parameters<typeof buildTimerExportCsv>[0][number]>;
    rows.push(...pageRows);

    if (pageRows.length < EXPORT_PAGE_SIZE) {
      break;
    }

    offset += EXPORT_PAGE_SIZE;
  }

  const csv = buildTimerExportCsv(rows);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="timer-sessions.csv"',
      "cache-control": "no-store",
    },
  });
}
