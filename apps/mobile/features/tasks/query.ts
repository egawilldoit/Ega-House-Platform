import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { listMobileGoals } from '@/lib/api/goals';
import { listMobileProjects } from '@/lib/api/projects';
import {
  cancelMobileTaskReminder,
  createMobileTask,
  createMobileTaskReminder,
  getMobileTaskById,
  listMobileTasks,
  type ListMobileTasksParams,
  updateMobileTask,
} from '@/lib/api/tasks';
import type {
  CreateTaskInput,
  MobileTaskListItemView,
  MobileTaskListViewResponse,
  UpdateTaskInput,
} from '@/types/tasks';

const DEFAULT_TASK_QUERY_DUE = 'all' as const;
const DEFAULT_TASK_QUERY_SORT = 'updated_desc' as const;

type NormalizedTaskListParams = {
  status: ListMobileTasksParams['status'];
  projectId: ListMobileTasksParams['projectId'];
  goalId: ListMobileTasksParams['goalId'];
  due: NonNullable<ListMobileTasksParams['due']>;
  sort: NonNullable<ListMobileTasksParams['sort']>;
  limit: ListMobileTasksParams['limit'];
};

function normalizeTaskListParams(params: ListMobileTasksParams = {}): NormalizedTaskListParams {
  return {
    status: params.status ?? null,
    projectId: params.projectId ?? null,
    goalId: params.goalId ?? null,
    due: params.due ?? DEFAULT_TASK_QUERY_DUE,
    sort: params.sort ?? DEFAULT_TASK_QUERY_SORT,
    limit: params.limit ?? null,
  };
}

export const taskQueryKeys = {
  all: ['tasks'] as const,
  lists: () => ['tasks', 'list'] as const,
  list: (params: ListMobileTasksParams = {}) =>
    ['tasks', 'list', normalizeTaskListParams(params)] as const,
  details: () => ['tasks', 'detail'] as const,
  detail: (taskId: string) => ['tasks', 'detail', taskId] as const,
  formOptions: () => ['tasks', 'form-options'] as const,
};

function upsertTaskInList(task: MobileTaskListItemView, list: MobileTaskListItemView[]) {
  const existingIndex = list.findIndex((item) => item.id === task.id);
  if (existingIndex === -1) {
    return [task, ...list];
  }

  return list.map((item) => (item.id === task.id ? task : item));
}

function applyTaskToTaskListCaches(
  previous: MobileTaskListViewResponse | undefined,
  task: MobileTaskListItemView,
): MobileTaskListViewResponse | undefined {
  if (!previous) {
    return previous;
  }

  return {
    ...previous,
    tasks: upsertTaskInList(task, previous.tasks),
  };
}

export function applyTaskToTaskCaches(queryClient: QueryClient, task: MobileTaskListItemView) {
  queryClient.setQueriesData<MobileTaskListViewResponse | undefined>(
    { queryKey: taskQueryKeys.lists() },
    (previous) => applyTaskToTaskListCaches(previous, task),
  );

  queryClient.setQueryData(taskQueryKeys.detail(task.id), task);
}

export function useTaskListQuery(params: ListMobileTasksParams = {}) {
  const normalized = normalizeTaskListParams(params);

  return useQuery({
    queryKey: taskQueryKeys.list(normalized),
    queryFn: () => listMobileTasks(normalized),
  });
}

export function useTaskByIdQuery(taskId: string) {
  return useQuery({
    enabled: Boolean(taskId),
    queryKey: taskQueryKeys.detail(taskId),
    queryFn: async () => {
      const response = await getMobileTaskById(taskId);
      return response.task;
    },
  });
}

export function useTaskFormOptionsQuery() {
  return useQuery({
    queryKey: taskQueryKeys.formOptions(),
    queryFn: async () => {
      const [projects, goals] = await Promise.all([
        listMobileProjects(),
        listMobileGoals(),
      ]);
      return {
        projects: projects.projects.map((project) => ({ id: project.id, name: project.name })),
        goals: goals.goals.map((goal) => ({ id: goal.id, title: goal.title })),
      };
    },
  });
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateTaskInput) => createMobileTask(input),
    onSuccess: (response) => {
      applyTaskToTaskCaches(queryClient, response.task);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.lists() }).catch(() => {
        // Best-effort background refresh.
      });
      queryClient.invalidateQueries({ queryKey: ['today'] }).catch(() => {
        // Best-effort background refresh.
      });
    },
  });
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, input }: { taskId: string; input: UpdateTaskInput }) =>
      updateMobileTask(taskId, input),
    onSuccess: (response) => {
      applyTaskToTaskCaches(queryClient, response.task);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.lists() }).catch(() => {
        // Best-effort background refresh.
      });
      queryClient.invalidateQueries({ queryKey: ['today'] }).catch(() => {
        // Best-effort background refresh.
      });
    },
  });
}

export function useCreateTaskReminderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, remindAt }: { taskId: string; remindAt: string }) =>
      createMobileTaskReminder(taskId, { remindAt }),
    onSuccess: (response) => {
      applyTaskToTaskCaches(queryClient, response.task);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.lists() }).catch(() => {
        // Best-effort background refresh.
      });
    },
  });
}

export function useCancelTaskReminderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, reminderId }: { taskId: string; reminderId: string }) =>
      cancelMobileTaskReminder(taskId, { reminderId }),
    onSuccess: (response) => {
      applyTaskToTaskCaches(queryClient, response.task);
      queryClient.invalidateQueries({ queryKey: taskQueryKeys.lists() }).catch(() => {
        // Best-effort background refresh.
      });
    },
  });
}
