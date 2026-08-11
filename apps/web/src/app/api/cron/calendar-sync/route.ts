import { NextResponse } from "next/server";

import { processPendingCalendarSyncJobs } from "@/lib/services/calendar-sync-service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { authorizeCronRequest } from "../_lib/runtime";

export async function POST(request: Request) {
  const authorizationFailure = authorizeCronRequest(request);
  if (authorizationFailure) {
    return authorizationFailure;
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
