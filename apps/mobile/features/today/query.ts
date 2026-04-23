import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addMobileTaskToToday,
  clearMobileTodayCompletedTasks,
  fetchMobileToday,
  removeMobileTaskFromToday,
  updateMobileTodayTaskStatus,
} from '@/lib/api/today';
import { taskQueryKeys } from '@/features/tasks/query';
import type { MobileTaskStatus } from '@/types/tasks';

export const todayQueryKeys = {
  all: ['today'] as const,
  workspace: () => ['today', 'workspace'] as const,
};

function invalidateTodayAndTaskCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: todayQueryKeys.all }).catch(() => {
    // Best-effort background refresh.
  });
  queryClient.invalidateQueries({ queryKey: taskQueryKeys.lists() }).catch(() => {
    // Best-effort background refresh.
  });
}

export function useTodayWorkspaceQuery() {
  return useQuery({
    queryKey: todayQueryKeys.workspace(),
    queryFn: fetchMobileToday,
  });
}

export function useUpdateTodayTaskStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: MobileTaskStatus }) =>
      updateMobileTodayTaskStatus(taskId, status),
    onSuccess: (response) => {
      invalidateTodayAndTaskCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.detail(response.taskId) }).catch(() => {
        // Best-effort background refresh.
      });
    },
  });
}

export function useAddTaskToTodayMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => addMobileTaskToToday(taskId),
    onSuccess: (response) => {
      invalidateTodayAndTaskCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.detail(response.taskId) }).catch(() => {
        // Best-effort background refresh.
      });
    },
  });
}

export function useRemoveTaskFromTodayMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => removeMobileTaskFromToday(taskId),
    onSuccess: (response) => {
      invalidateTodayAndTaskCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.detail(response.taskId) }).catch(() => {
        // Best-effort background refresh.
      });
    },
  });
}

export function useClearTodayCompletedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clearMobileTodayCompletedTasks,
    onSuccess: () => {
      invalidateTodayAndTaskCaches(queryClient);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.details() }).catch(() => {
        // Best-effort background refresh.
      });
    },
  });
}
