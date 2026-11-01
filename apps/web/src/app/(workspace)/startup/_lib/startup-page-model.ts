import { getStartupPlannerData } from "@/lib/services/startup-planner-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";

export type StartupSearchParams = { actionError?: string; actionSuccess?: string };

export async function getStartupPageModel(searchParams: StartupSearchParams) {
  const actionError = searchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = searchParams.actionSuccess?.slice(0, 180) ?? null;
  // Startup day boundaries follow the owner's canonical local date from Time
  // Context so they agree with Today/Timer on the calendar day.
  const accountLocalDate = (await getWebTimeContext().catch(() => null))?.localDate;
  const startupResult = await getStartupPlannerData({ localDate: accountLocalDate });
  return { actionError, actionSuccess, startupResult };
}

export type StartupPageModel = Awaited<ReturnType<typeof getStartupPageModel>>;
