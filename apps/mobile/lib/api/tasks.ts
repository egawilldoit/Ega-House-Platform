import { mobileApiFetch } from '@/lib/api/client';
import type { MobileTaskListResponse } from '@/types/tasks';

export async function fetchMobileTasks() {
  return mobileApiFetch<MobileTaskListResponse>('/api/mobile/tasks', {
    method: 'GET',
    auth: true,
  });
}
