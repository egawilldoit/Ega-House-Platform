/**
 * Mobile Today API — typed wrappers over the @ega/api-client today surface
 * (canonical Hono transport), bound to the mobile session token.
 *
 *   GET    /api/today[?date]                 -> MobileTodayResponse
 *   POST   /api/today/tasks/:id              -> { ok, taskId }        (plan)
 *   DELETE /api/today/tasks/:id              -> { ok, taskId }        (remove)
 *   PATCH  /api/today/tasks/:id/status       -> { ok, taskId, status }
 *   POST   /api/today/clear-completed        -> { ok }
 *
 * Errors are thrown as `Error` with the server envelope message (see
 * `unwrapApiResult` in `lib/api/ega.ts`).
 */
import type {
  MobileTodayClearCompletedResponse,
  MobileTodayTaskMutationResponse,
  MobileTodayTaskStatusMutationResponse,
  MobileTodayResponse,
  TaskStatus,
} from '@ega/api-client';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';

export async function fetchMobileToday(): Promise<MobileTodayResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().today.get());
}

export async function updateMobileTodayTaskStatus(
  taskId: string,
  status: TaskStatus,
): Promise<MobileTodayTaskStatusMutationResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().today.updateStatus(taskId, status));
}

export async function addMobileTaskToToday(
  taskId: string,
): Promise<MobileTodayTaskMutationResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().today.plan(taskId));
}

export async function removeMobileTaskFromToday(
  taskId: string,
): Promise<MobileTodayTaskMutationResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().today.remove(taskId));
}

export async function clearMobileTodayCompletedTasks(): Promise<MobileTodayClearCompletedResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().today.clearCompleted());
}
