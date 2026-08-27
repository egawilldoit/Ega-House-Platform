/**
 * Mobile task API — typed wrappers over the @ega/api-client tasks surface
 * (canonical Hono transport), bound to the mobile session token.
 *
 *   GET    /api/tasks?status&priority&projectId&goalId&due&sort&limit
 *   GET    /api/tasks/:id
 *   POST   /api/tasks
 *   PATCH  /api/tasks/:id
 *   POST   /api/tasks/:id/reminders
 *   PATCH  /api/tasks/:id/reminders/:reminderId
 *
 * Responses speak the enriched mobile contract (counters, filters, project/
 * goal form options, full task items). Errors are thrown as `Error` with the
 * server envelope message (see `unwrapApiResult` in `lib/api/ega.ts`).
 */
import type {
  CreateTaskInput,
  MobileTaskListResponse,
  MobileTaskMutationResponse,
  TaskDueFilter,
  TaskPriority,
  TaskSortValue,
  TaskStatus,
} from '@ega/api-client';
import { getMobileEgaApiClient, unwrapApiResult } from '@/lib/api/ega';

export type ListMobileTasksParams = {
  status?: TaskStatus | null;
  projectId?: string | null;
  goalId?: string | null;
  priority?: TaskPriority | null;
  due?: TaskDueFilter;
  sort?: TaskSortValue;
  limit?: number | null;
};

function listQuery(params: ListMobileTasksParams) {
  return {
    status: params.status ?? undefined,
    projectId: params.projectId ?? undefined,
    goalId: params.goalId ?? undefined,
    priority: params.priority ?? undefined,
    due: params.due ?? undefined,
    sort: params.sort ?? undefined,
    limit: typeof params.limit === 'number' ? params.limit : undefined,
  };
}

export async function listMobileTasks(
  params: ListMobileTasksParams = {},
): Promise<MobileTaskListResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().tasks.list(listQuery(params)));
}

export async function getMobileTaskById(taskId: string): Promise<MobileTaskMutationResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().tasks.get(taskId));
}

export async function createMobileTask(
  input: CreateTaskInput,
): Promise<MobileTaskMutationResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().tasks.create(input));
}

export async function updateMobileTask(
  taskId: string,
  input: Record<string, unknown>,
): Promise<MobileTaskMutationResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().tasks.update(taskId, input));
}

export async function createMobileTaskReminder(
  taskId: string,
  input: { remindAt: string; deliveryMode?: 'push' | 'email' | 'both' },
): Promise<MobileTaskMutationResponse> {
  return unwrapApiResult(await getMobileEgaApiClient().tasks.createReminder(taskId, input.remindAt, input.deliveryMode));
}

export async function cancelMobileTaskReminder(
  taskId: string,
  input: { reminderId: string },
): Promise<MobileTaskMutationResponse> {
  return unwrapApiResult(
    await getMobileEgaApiClient().tasks.cancelReminder(taskId, input.reminderId),
  );
}
