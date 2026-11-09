import { getShutdownData } from "@/lib/services/shutdown-service";
import { getWebDailyCheckin } from "@/lib/services/checkin-service";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";

export type ShutdownSearchParams = { actionError?: string; actionSuccess?: string };

export async function getShutdownPageModel(searchParams: ShutdownSearchParams) {
  const actionError = searchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = searchParams.actionSuccess?.slice(0, 180) ?? null;
  // Shutdown day boundaries and timer totals follow the owner's canonical
  // Time Context so they agree with Today/Timer on the same calendar day.
  const [timeContext, user] = await Promise.all([
    getWebTimeContext().catch(() => null),
    getCurrentUser().catch(() => null),
  ]);
  const shutdownResult = await getShutdownData({
    localDate: timeContext?.localDate,
    timezone: timeContext?.timezone,
    ownerUserId: user?.id,
  });
  const checkinResult = timeContext?.localDate
    ? await getWebDailyCheckin({ localDate: timeContext.localDate }).catch(() => ({
        checkin: null as null,
        errorMessage: null as string | null,
      }))
    : { checkin: null as null, errorMessage: null as string | null };
  return { actionError, actionSuccess, shutdownResult, checkinResult };
}

export type ShutdownPageModel = Awaited<ReturnType<typeof getShutdownPageModel>>;
