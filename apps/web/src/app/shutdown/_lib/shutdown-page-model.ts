import { getShutdownData } from "@/lib/services/shutdown-service";

export type ShutdownSearchParams = { actionError?: string; actionSuccess?: string };

export async function getShutdownPageModel(searchParams: ShutdownSearchParams) {
  const actionError = searchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = searchParams.actionSuccess?.slice(0, 180) ?? null;
  const shutdownResult = await getShutdownData();
  return { actionError, actionSuccess, shutdownResult };
}

export type ShutdownPageModel = Awaited<ReturnType<typeof getShutdownPageModel>>;
