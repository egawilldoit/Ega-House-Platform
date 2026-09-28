import { getShutdownData } from "@/lib/services/shutdown-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";

export type ShutdownSearchParams = { actionError?: string; actionSuccess?: string };

export async function getShutdownPageModel(searchParams: ShutdownSearchParams) {
  const actionError = searchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = searchParams.actionSuccess?.slice(0, 180) ?? null;
  // Shutdown day boundaries follow the owner's canonical local date from Time
  // Context so they agree with Today/Timer on the calendar day.
  const accountLocalDate = (await getWebTimeContext().catch(() => null))?.localDate;
  const shutdownResult = await getShutdownData({ localDate: accountLocalDate });
  return { actionError, actionSuccess, shutdownResult };
}

export type ShutdownPageModel = Awaited<ReturnType<typeof getShutdownPageModel>>;
