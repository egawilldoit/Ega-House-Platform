import { authorizeCronRequest, runCronOperation } from "@/lib/cron/route-runtime";
import { processPendingCalendarSyncJobs } from "@/lib/services/calendar-sync-service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  return runCronOperation(
    () =>
      processPendingCalendarSyncJobs({
        supabase: getSupabaseServiceClient() as never,
      }),
    "Failed to process Calendar sync jobs.",
  );
}
