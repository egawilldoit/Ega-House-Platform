import { mobileApiFetch } from '@/lib/api/client';
import type {
  CancelTaskReminderInput,
  CreateTaskInput,
  CreateTaskReminderInput,
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

export async function getMobileTaskById(taskId: string) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/mobile/tasks/${taskId}`, {
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

export async function updateMobileTask(taskId: string, input: UpdateTaskInput) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/mobile/tasks/${taskId}`, {
    method: 'PATCH',
    auth: true,
    body: JSON.stringify(input),
  });
}

export async function createMobileTaskReminder(taskId: string, input: CreateTaskReminderInput) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/mobile/tasks/${taskId}/reminders`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify(input),
  });
}

export async function archiveMobileTask(taskId: string) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/tasks/${taskId}/archive`, {
    method: 'POST',
    auth: true,
  });
}

export async function unarchiveMobileTask(taskId: string) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/tasks/${taskId}/unarchive`, {
    method: 'POST',
    auth: true,
  });
}

export async function pinMobileTask(taskId: string) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/mobile/tasks/${taskId}/pin`, {
    method: 'POST',
    auth: true,
  });
}

export async function unpinMobileTask(taskId: string) {
  return mobileApiFetch<MobileTaskMutationResponse>(`/api/mobile/tasks/${taskId}/unpin`, {
    method: 'POST',
    auth: true,
  });
}

export async function cancelMobileTaskReminder(taskId: string, input: CancelTaskReminderInput) {
  return mobileApiFetch<MobileTaskMutationResponse>(
    `/api/mobile/tasks/${taskId}/reminders/${input.reminderId}`,
    {
      method: 'PATCH',
      auth: true,
      body: JSON.stringify({ status: 'cancelled' }),
    },
  );
}
