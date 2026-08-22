import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { taskQueryKeys } from '@/features/tasks/query';
import { todayQueryKeys } from '@/features/today/query';
import { fetchTimerWorkspace, startTimerForTask, stopTimerSession } from '@/lib/api/timer';

export const timerQueryKeys = {
  all: ['timer'] as const,
  workspace: () => ['timer', 'workspace'] as const,
};

function invalidateTimerDependentCaches(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: timerQueryKeys.all }).catch(() => {
    // Best-effort background refresh.
  });
  queryClient.invalidateQueries({ queryKey: todayQueryKeys.all }).catch(() => {
    // Best-effort background refresh.
  });
  queryClient.invalidateQueries({ queryKey: taskQueryKeys.lists() }).catch(() => {
    // Best-effort background refresh.
  });
}

function reconcileTimerWorkspace(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: timerQueryKeys.workspace() }).catch(() => {
    // Adopt the server-authoritative session after a failed mutation.
  });
}

export function useTimerWorkspaceQuery() {
  return useQuery({
    queryKey: timerQueryKeys.workspace(),
    queryFn: fetchTimerWorkspace,
  });
}

export function useStartTimerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (taskId: string) => startTimerForTask(taskId),
    onSuccess: () => {
      invalidateTimerDependentCaches(queryClient);
    },
    onError: () => {
      reconcileTimerWorkspace(queryClient);
    },
  });
}

export function useStopTimerMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string | undefined) => stopTimerSession(sessionId),
    onSuccess: () => {
      invalidateTimerDependentCaches(queryClient);
    },
    onError: () => {
      reconcileTimerWorkspace(queryClient);
    },
  });
}
