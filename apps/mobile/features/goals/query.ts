import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type {
  CreateGoalInput,
  GoalHealth,
  GoalReadModel,
  GoalStatus,
  GoalViewFilter,
  GoalsReadModel,
} from '@ega/api-client';
import {
  archiveMobileGoal,
  createMobileGoal,
  listMobileGoals,
  unarchiveMobileGoal,
  updateMobileGoalHealth,
  updateMobileGoalNextStep,
  updateMobileGoalStatus,
} from '@/lib/api/goals';

export const goalQueryKeys = {
  all: ['goals'] as const,
  lists: () => ['goals', 'list'] as const,
  list: (view: GoalViewFilter = 'active') => ['goals', 'list', view] as const,
  detail: (goalId: string) => ['goals', 'detail', goalId] as const,
};

export function useGoalListQuery(view: GoalViewFilter = 'active') {
  return useQuery({
    queryKey: goalQueryKeys.list(view),
    queryFn: () => listMobileGoals(view),
    // Same placeholder rationale as ProjectsListView: keep previous view visible + Refreshing banner until network.
    // Hides view switch briefly, but avoids blank flash; error banner + Refreshing keeps feedback visible.
    placeholderData: (previousData) => previousData,
  });
}

export function useGoalDetailQuery(goalId: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: goalQueryKeys.detail(goalId),
    queryFn: async (): Promise<GoalReadModel | null> => {
      const readModel = await listMobileGoals('all');
      return readModel.goals.find((goal) => goal.id === goalId) ?? null;
    },
    initialData: () => {
      const cached = queryClient.getQueryData<GoalsReadModel>(goalQueryKeys.list('all'));
      return cached?.goals.find((goal) => goal.id === goalId);
    },
    enabled: goalId.length > 0,
  });
}

function invalidateGoalLists(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: goalQueryKeys.lists() }).catch(() => {
    // Best-effort background refresh.
  });
  // Goal detail views derive from the canonical goals list.
  queryClient.invalidateQueries({ queryKey: ['goals', 'detail'] }).catch(() => {
    // Best-effort background refresh.
  });
  // Goals surface inside project detail views.
  queryClient.invalidateQueries({ queryKey: ['projects', 'detail'] }).catch(() => {
    // Best-effort background refresh.
  });
}

export function useCreateGoalMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateGoalInput) => createMobileGoal(input),
    onSuccess: () => {
      invalidateGoalLists(queryClient);
    },
  });
}

export function useUpdateGoalStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ goalId, status }: { goalId: string; status: GoalStatus }) =>
      updateMobileGoalStatus(goalId, status),
    onSuccess: () => {
      invalidateGoalLists(queryClient);
    },
  });
}

export function useUpdateGoalHealthMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ goalId, health }: { goalId: string; health: GoalHealth | null }) =>
      updateMobileGoalHealth(goalId, health),
    onSuccess: () => {
      invalidateGoalLists(queryClient);
    },
  });
}

export function useUpdateGoalNextStepMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ goalId, nextStep }: { goalId: string; nextStep: string | null }) =>
      updateMobileGoalNextStep(goalId, nextStep),
    onSuccess: () => {
      invalidateGoalLists(queryClient);
    },
  });
}

export function useArchiveGoalMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goalId: string) => archiveMobileGoal(goalId),
    onSuccess: () => {
      invalidateGoalLists(queryClient);
    },
  });
}

export function useUnarchiveGoalMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goalId: string) => unarchiveMobileGoal(goalId),
    onSuccess: () => {
      invalidateGoalLists(queryClient);
    },
  });
}
