import { NextResponse } from "next/server";

import { processPendingCalendarSyncJobs } from "@/lib/services/calendar-sync-service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

function missingEnvResponse(missing: string[]) {
  return NextResponse.json(
    { ok: false, error: `Missing required environment variable(s): ${missing.join(", ")}` },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return missingEnvResponse(["CRON_SECRET"]);
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processPendingCalendarSyncJobs({
      supabase: getSupabaseServiceClient() as never,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to process Calendar sync jobs." },
      { status: 500 },
    );
  }
}
