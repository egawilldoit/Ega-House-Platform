import { executeCalendarSyncCron } from "@/lib/cron/calendar-sync-cron";
import { authorizeCronRequest } from "@/lib/cron/route-runtime";
import { processPendingCalendarSyncJobs } from "@/lib/services/calendar-sync-service";
import { runWebCalendarRecovery } from "@/lib/services/calendar-sync-engine";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Scheduled recovery for the durable Calendar queue. The v2 engine resumes
 * unfinished scans, reclaims expired leases and drains destination-bound
 * jobs. The legacy drain keeps pre-v2 scheduled-sync jobs working.
 */
export async function POST(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) return unauthorized;

  const origin = new URL(request.url).origin;
  return executeCalendarSyncCron(origin, {
    runRecovery: runWebCalendarRecovery,
    processLegacy: () =>
      processPendingCalendarSyncJobs({
        supabase: getSupabaseServiceClient() as never,
      }),
  });
}
