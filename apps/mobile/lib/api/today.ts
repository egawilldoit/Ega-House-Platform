import { mobileApiFetch } from '@/lib/api/client';
import type {
  MobileTodayClearCompletedResponse,
  MobileTodayResponse,
  MobileTodayTaskMutationResponse,
  MobileTodayTaskStatusMutationResponse,
} from '@/types/today';
import type { MobileTaskStatus } from '@/types/tasks';

export async function fetchMobileToday() {
  return mobileApiFetch<MobileTodayResponse>('/api/mobile/today', {
    method: 'GET',
    auth: true,
  });
}

export async function updateMobileTodayTaskStatus(taskId: string, status: MobileTaskStatus) {
  return mobileApiFetch<MobileTodayTaskStatusMutationResponse>(`/api/mobile/today/tasks/${taskId}/status`, {
    method: 'POST',
    auth: true,
    body: JSON.stringify({ status }),
  });
}

export async function addMobileTaskToToday(taskId: string) {
  return mobileApiFetch<MobileTodayTaskMutationResponse>(`/api/mobile/today/tasks/${taskId}/add`, {
    method: 'POST',
    auth: true,
  });
}

export async function removeMobileTaskFromToday(taskId: string) {
  return mobileApiFetch<MobileTodayTaskMutationResponse>(`/api/mobile/today/tasks/${taskId}/remove`, {
    method: 'POST',
    auth: true,
  });
}

export async function clearMobileTodayCompletedTasks() {
  return mobileApiFetch<MobileTodayClearCompletedResponse>('/api/mobile/today/clear-completed', {
    method: 'POST',
    auth: true,
  });
}
