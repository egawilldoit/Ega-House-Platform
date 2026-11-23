import { authorizeCronRequest, runCronOperation } from "@/lib/cron/route-runtime";
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

  return runCronOperation(
    async () => {
      const recovery = await runWebCalendarRecovery(origin);
      const legacy = await processPendingCalendarSyncJobs({
        supabase: getSupabaseServiceClient() as never,
      });

      return {
        ok: recovery.ok && legacy.ok,
        recovery: recovery.ok
          ? recovery.data
          : { error: recovery.errorMessage },
        legacy,
      };
    },
    "Failed to process Calendar sync jobs.",
  );
}
