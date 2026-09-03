import * as ReactQuery from '@tanstack/react-query';

import type { MobileTaskListResponse } from '@ega/contracts/mobile';
import * as tasksApi from '@/lib/api/tasks';
import {
  taskQueryKeys,
  useCreateTaskMutation,
  useArchiveTaskMutation,
  useUnarchiveTaskMutation,
  useTaskByIdQuery,
  useTaskFormOptionsQuery,
  useTaskListQuery,
} from '../query';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock('@/lib/api/tasks', () => ({
  listMobileTasks: jest.fn(),
  getMobileTaskById: jest.fn(),
  createMobileTask: jest.fn(),
  archiveMobileTask: jest.fn(),
  unarchiveMobileTask: jest.fn(),
}));

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;

const LIST_RESPONSE: MobileTaskListResponse = {
  ok: true,
  tasks: [
    {
      id: 'task-1',
      title: 'Ship enrichment',
      description: null,
      blockedReason: null,
      status: 'todo',
      priority: 'urgent',
      dueDate: '2026-08-22',
      plannedForDate: null,
      archivedAt: null,
      estimateMinutes: 30,
      updatedAt: '2026-08-22T00:00:00.000Z',
      focusRank: null,
      trackedDurationSeconds: 0,
      project: { id: 'p-1', name: 'Launch', slug: 'launch' },
      goal: { id: 'g-1', title: 'Ship v1' },
      reminders: [],
      recurrence: null,
    },
  ],
  counters: {
    total: 1,
    byStatus: { todo: 1, in_progress: 0, done: 0, blocked: 0 },
    byPriority: { low: 0, medium: 0, high: 0, urgent: 1 },
    pinned: 0,
    overdue: 0,
    dueToday: 1,
  },
  filters: {
    status: null,
    projectId: null,
    goalId: null,
    priority: null,
    due: 'all',
    sort: 'updated_desc',
    plannedForDate: null,
    includeArchived: false,
    limit: null,
  },
  projects: [{ id: 'p-1', name: 'Launch', slug: 'launch' }],
  goals: [{ id: 'g-1', title: 'Ship v1' }],
};

type QueryOptions = { queryKey: unknown[]; queryFn: () => Promise<unknown> };

let queryCall: QueryOptions | null = null;

function installCapture() {
  queryCall = null;
  (ReactQuery.useQuery as unknown as jest.Mock).mockImplementation((options: QueryOptions) => {
    queryCall = options;
    return { data: undefined };
  });
}

describe('tasks query hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installCapture();
  });

  it('useTaskListQuery fetches the enriched canonical list with normalized params', async () => {
    mock(tasksApi.listMobileTasks).mockResolvedValue(LIST_RESPONSE);

    useTaskListQuery({ priority: 'urgent' });

    expect(queryCall?.queryKey).toEqual(
      taskQueryKeys.list({
        status: null,
        projectId: null,
      goalId: null,
      priority: 'urgent',
      plannedForDate: null,
      due: 'all',
      sort: 'updated_desc',
      includeArchived: false,
      limit: null,
      }),
    );
    await expect(queryCall?.queryFn()).resolves.toBe(LIST_RESPONSE);
    expect(tasksApi.listMobileTasks).toHaveBeenCalledWith({
      status: null,
      projectId: null,
      goalId: null,
      priority: 'urgent',
      plannedForDate: null,
      due: 'all',
      sort: 'updated_desc',
      includeArchived: false,
      limit: null,
    });
  });

  it('distinct priorities produce distinct cache keys so views do not collide', () => {
    useTaskListQuery({ priority: 'urgent' });
    const urgentKey = queryCall?.queryKey;

    useTaskListQuery();
    const allKey = queryCall?.queryKey;

    expect(urgentKey).not.toEqual(allKey);
  });

  it('does not use an active placeholder while the archive scope changes', () => {
    useTaskListQuery({ includeArchived: true });

    const placeholder = (queryCall as unknown as { placeholderData: (data: MobileTaskListResponse) => unknown })
      ?.placeholderData;
    expect(placeholder(LIST_RESPONSE)).toBeUndefined();
  });

  it('useTaskByIdQuery unwraps the enriched task item', async () => {
    mock(tasksApi.getMobileTaskById).mockResolvedValue({ ok: true as const, task: LIST_RESPONSE.tasks[0] });

    useTaskByIdQuery('task-1');

    await expect(queryCall?.queryFn()).resolves.toMatchObject({
      project: { id: 'p-1', name: 'Launch', slug: 'launch' },
      goal: { id: 'g-1', title: 'Ship v1' },
    });
  });

  it('useTaskFormOptionsQuery reuses the enriched response projects and goals', async () => {
    mock(tasksApi.listMobileTasks).mockResolvedValue(LIST_RESPONSE);

    useTaskFormOptionsQuery();

    await expect(queryCall?.queryFn()).resolves.toEqual({
      projects: LIST_RESPONSE.projects,
      goals: LIST_RESPONSE.goals,
    });
    expect(tasksApi.listMobileTasks).toHaveBeenCalledWith({ limit: 1 });
  });

  it('create success upserts the enriched item into caches and invalidates lists', async () => {
    const queryClient = {
      setQueriesData: jest.fn(),
      setQueryData: jest.fn(),
      invalidateQueries: jest.fn().mockResolvedValue(undefined),
    };
    (ReactQuery.useQueryClient as unknown as jest.Mock).mockReturnValue(queryClient);
    mock(tasksApi.createMobileTask).mockResolvedValue({ ok: true as const, task: LIST_RESPONSE.tasks[0] });

    let mutationOptions:
      | { mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: (data: unknown) => void }
      | null = null;
    (ReactQuery.useMutation as unknown as jest.Mock).mockImplementation((options: never) => {
      mutationOptions = options;
      return { isPending: false, mutateAsync: jest.fn() };
    });

    useCreateTaskMutation();

    await mutationOptions!.mutationFn({ title: 'Ship enrichment' });
    mutationOptions!.onSuccess?.({ ok: true, task: LIST_RESPONSE.tasks[0] });

    expect(queryClient.setQueriesData).toHaveBeenCalledWith(
      { queryKey: ['tasks', 'list'] },
      expect.any(Function),
    );
    expect(queryClient.setQueryData).toHaveBeenCalledWith(
      ['tasks', 'detail', 'task-1'],
      LIST_RESPONSE.tasks[0],
    );
    const keys = queryClient.invalidateQueries.mock.calls.map((call) => call[0].queryKey);
    expect(keys).toContainEqual(['tasks', 'list']);
    expect(keys).toContainEqual(['today']);
  });

  it('archive transitions call the canonical API and refresh task views', async () => {
    const queryClient = {
      setQueriesData: jest.fn(),
      setQueryData: jest.fn(),
      invalidateQueries: jest.fn().mockResolvedValue(undefined),
    };
    (ReactQuery.useQueryClient as unknown as jest.Mock).mockReturnValue(queryClient);
    const response = { ok: true as const, task: { ...LIST_RESPONSE.tasks[0], archivedAt: '2026-08-22T12:00:00.000Z' } };
    mock(tasksApi.archiveMobileTask).mockResolvedValue(response);
    mock(tasksApi.unarchiveMobileTask).mockResolvedValue({ ...response, task: { ...response.task, archivedAt: null } });

    const mutationOptions: Array<{ mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: (data: unknown) => void }> = [];
    (ReactQuery.useMutation as unknown as jest.Mock).mockImplementation((options: never) => {
      mutationOptions.push(options);
      return { isPending: false, mutateAsync: jest.fn() };
    });

    useArchiveTaskMutation();
    useUnarchiveTaskMutation();
    await mutationOptions[0].mutationFn('task-1');
    mutationOptions[0].onSuccess?.(response);
    await mutationOptions[1].mutationFn('task-1');
    mutationOptions[1].onSuccess?.({ ...response, task: { ...response.task, archivedAt: null } });

    expect(tasksApi.archiveMobileTask).toHaveBeenCalledWith('task-1');
    expect(tasksApi.unarchiveMobileTask).toHaveBeenCalledWith('task-1');
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['tasks', 'detail', 'task-1'], expect.anything());
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['today'] });
  });
});
