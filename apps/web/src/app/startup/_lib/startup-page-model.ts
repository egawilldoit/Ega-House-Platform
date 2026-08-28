import { getStartupPlannerData } from "@/lib/services/startup-planner-service";

export type StartupSearchParams = { actionError?: string; actionSuccess?: string };

export async function getStartupPageModel(searchParams: StartupSearchParams) {
  const actionError = searchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = searchParams.actionSuccess?.slice(0, 180) ?? null;
  const startupResult = await getStartupPlannerData();
  return { actionError, actionSuccess, startupResult };
}

export type StartupPageModel = Awaited<ReturnType<typeof getStartupPageModel>>;
