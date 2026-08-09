import * as ReactQuery from '@tanstack/react-query';

import type { GoalsReadModel } from '@ega/api-client';
import * as goalsApi from '@/lib/api/goals';
import {
  useArchiveGoalMutation,
  useCreateGoalMutation,
  useGoalListQuery,
  useUnarchiveGoalMutation,
  useUpdateGoalHealthMutation,
  useUpdateGoalNextStepMutation,
  useUpdateGoalStatusMutation,
} from '../query';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock('@/lib/api/goals', () => ({
  archiveMobileGoal: jest.fn(),
  createMobileGoal: jest.fn(),
  listMobileGoals: jest.fn(),
  unarchiveMobileGoal: jest.fn(),
  updateMobileGoalHealth: jest.fn(),
  updateMobileGoalNextStep: jest.fn(),
  updateMobileGoalStatus: jest.fn(),
}));

const mock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as jest.MockedFunction<T>;

const READ_MODEL: GoalsReadModel = {
  projects: [{ id: 'p-1', name: 'Launch' }],
  goals: [
    {
      id: 'g-1',
      title: 'Ship the dashboard',
      description: null,
      nextStep: 'Draft spec',
      health: 'on_track',
      status: 'active',
      updatedAt: '2026-01-02T00:00:00.000Z',
      projectName: 'Launch',
      linkedTasks: [],
      progressPercent: 40,
    },
  ],
  summary: { total: 1, active: 1, completed: 0, archived: 0 },
};

type QueryOptions = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
};

type MutationOptions = {
  mutationFn: (input: unknown) => Promise<unknown>;
  onSuccess?: (data: unknown) => void;
};

let mutationCalls: MutationOptions[] = [];
let queryCall: QueryOptions | null = null;

function installCapture() {
  mutationCalls = [];
  queryCall = null;
  (ReactQuery.useQuery as unknown as jest.Mock).mockImplementation((options: QueryOptions) => {
    queryCall = options;
    return { data: undefined };
  });
  (ReactQuery.useMutation as unknown as jest.Mock).mockImplementation((options: MutationOptions) => {
    mutationCalls.push(options);
    return { isPending: false, mutate: jest.fn() };
  });
}

function mockInvalidations() {
  const invalidateQueries = jest.fn().mockResolvedValue(undefined);
  mock(ReactQuery.useQueryClient).mockReturnValue({ invalidateQueries } as never);
  return invalidateQueries;
}

describe('goal query hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installCapture();
    mockInvalidations();
  });

  it('useGoalListQuery targets the requested view', async () => {
    mock(goalsApi.listMobileGoals).mockResolvedValue(READ_MODEL);

    useGoalListQuery('all');

    expect(queryCall?.queryKey).toEqual(['goals', 'list', 'all']);
    await expect(queryCall?.queryFn()).resolves.toBe(READ_MODEL);
    expect(goalsApi.listMobileGoals).toHaveBeenCalledWith('all');
  });

  it('useCreateGoalMutation delegates and invalidates goal lists and project details', async () => {
    mock(goalsApi.createMobileGoal).mockResolvedValue({
      title: 'Ship the dashboard',
      projectId: 'p-1',
      description: '',
      nextStep: '',
      health: 'on_track',
      status: 'active',
      slug: '',
    });
    const invalidateQueries = mockInvalidations();

    useCreateGoalMutation();

    await mutationCalls[0].mutationFn({
      title: 'Ship the dashboard',
      projectId: 'p-1',
      description: null,
      nextStep: null,
      health: 'on_track',
      status: 'active',
      slug: null,
    });
    expect(goalsApi.createMobileGoal).toHaveBeenCalledTimes(1);

    mutationCalls[0].onSuccess?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['goals', 'list'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects', 'detail'] });
  });

  it('status, health, and next-step mutations invalidate lists', async () => {
    mock(goalsApi.updateMobileGoalStatus).mockResolvedValue(undefined);
    mock(goalsApi.updateMobileGoalHealth).mockResolvedValue(undefined);
    mock(goalsApi.updateMobileGoalNextStep).mockResolvedValue(undefined);
    const invalidateQueries = mockInvalidations();

    useUpdateGoalStatusMutation();
    useUpdateGoalHealthMutation();
    useUpdateGoalNextStepMutation();

    await mutationCalls[0].mutationFn({ goalId: 'g-1', status: 'paused' });
    expect(goalsApi.updateMobileGoalStatus).toHaveBeenCalledWith('g-1', 'paused');

    await mutationCalls[1].mutationFn({ goalId: 'g-1', health: 'at_risk' });
    expect(goalsApi.updateMobileGoalHealth).toHaveBeenCalledWith('g-1', 'at_risk');

    await mutationCalls[2].mutationFn({ goalId: 'g-1', nextStep: 'Write the brief' });
    expect(goalsApi.updateMobileGoalNextStep).toHaveBeenCalledWith('g-1', 'Write the brief');

    mutationCalls[0].onSuccess?.({});
    mutationCalls[1].onSuccess?.({});
    mutationCalls[2].onSuccess?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['goals', 'list'] });
  });

  it('archive and unarchive mutations invalidate lists', async () => {
    mock(goalsApi.archiveMobileGoal).mockResolvedValue(undefined);
    mock(goalsApi.unarchiveMobileGoal).mockResolvedValue(undefined);
    const invalidateQueries = mockInvalidations();

    useArchiveGoalMutation();
    useUnarchiveGoalMutation();

    await mutationCalls[0].mutationFn('g-1');
    expect(goalsApi.archiveMobileGoal).toHaveBeenCalledWith('g-1');

    await mutationCalls[1].mutationFn('g-1');
    expect(goalsApi.unarchiveMobileGoal).toHaveBeenCalledWith('g-1');

    mutationCalls[0].onSuccess?.({});
    mutationCalls[1].onSuccess?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['goals', 'list'] });
  });
});
