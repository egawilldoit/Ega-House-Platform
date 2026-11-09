import { getShutdownData } from "@/lib/services/shutdown-service";
import { getWebDailyCheckin, listWebDailyCheckins } from "@/lib/services/checkin-service";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";
import { countWeeklyRunSessions, ROUTINE_WEEKLY_RUN_TARGET } from "@ega/domain/checkins";
import { getWeekWindow } from "@ega/domain/time-context";

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
    ? await getWebDailyCheckin({ localDate: timeContext.localDate, timezone: timeContext?.timezone }).catch(() => ({
        checkin: null as null,
        errorMessage: null as string | null,
      }))
    : { checkin: null as null, errorMessage: null as string | null };
  // Weekly run derivation from the daily records (PO-10): explicit
  // completions only, never timer sessions or inferred minutes.
  let weeklyRun: { completedSessions: number; totalRunMinutes: number; target: number } | null = null;
  if (timeContext?.localDate && timeContext?.timezone) {
    try {
      const week = getWeekWindow(timeContext.timezone, timeContext.localDate);
      const listed = await listWebDailyCheckins(week.weekStart, week.weekEnd);
      if (!listed.errorMessage) {
        const counted = countWeeklyRunSessions(listed.checkins, week.weekStart, week.weekEnd);
        weeklyRun = { ...counted, target: ROUTINE_WEEKLY_RUN_TARGET };
      }
    } catch {
      weeklyRun = null;
    }
  }
  return { actionError, actionSuccess, shutdownResult, checkinResult, weeklyRun };
}

export type ShutdownPageModel = Awaited<ReturnType<typeof getShutdownPageModel>>;
