import { mobileApiFetch } from '@/lib/api/client';
import type {
  CreateTaskInput,
  MobileTaskDueFilter,
  MobileTaskListResponse,
  MobileTaskMutationResponse,
  MobileTaskSortValue,
  MobileTaskStatus,
  UpdateTaskInput,
} from '@/types/tasks';

export type ListMobileTasksParams = {
  status?: MobileTaskStatus | null;
  projectId?: string | null;
  goalId?: string | null;
  due?: MobileTaskDueFilter;
  sort?: MobileTaskSortValue;
  limit?: number | null;
};

function buildTaskListQuery(params: ListMobileTasksParams = {}) {
  const searchParams = new URLSearchParams();

  if (params.status) {
    searchParams.set('status', params.status);
  }

  if (params.projectId) {
    searchParams.set('projectId', params.projectId);
  }

  if (params.goalId) {
    searchParams.set('goalId', params.goalId);
  }

  if (params.due) {
    searchParams.set('due', params.due);
  }

  if (params.sort) {
    searchParams.set('sort', params.sort);
  }

  if (typeof params.limit === 'number') {
    searchParams.set('limit', String(params.limit));
  }

  const query = searchParams.toString();
  return query ? `/api/mobile/tasks?${query}` : '/api/mobile/tasks';
}

export async function listMobileTasks(params: ListMobileTasksParams = {}) {
  return mobileApiFetch<MobileTaskListResponse>(buildTaskListQuery(params), {
    method: 'GET',
    auth: true,
  });
}

export async function createMobileTask(input: CreateTaskInput) {
  return mobileApiFetch<MobileTaskMutationResponse>('/api/mobile/tasks', {
    method: 'POST',
    auth: true,
    body: JSON.stringify(input),
  });
}

export async function getMobileTaskById(taskId: string) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/mobile/tasks/${taskId}`, {
    method: 'GET',
    auth: true,
  });
}

export async function updateMobileTask(taskId: string, input: UpdateTaskInput) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/mobile/tasks/${taskId}`, {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify(input),
  });
}
