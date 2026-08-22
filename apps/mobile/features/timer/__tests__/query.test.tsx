import * as ReactQuery from '@tanstack/react-query';

import type { TimerStartResponse, TimerWorkspaceState } from '@ega/contracts/mobile';
import * as timerApi from '@/lib/api/timer';
import {
  useStartTimerMutation,
  useStopTimerMutation,
  useTimerWorkspaceQuery,
} from '../query';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock('@/lib/api/timer', () => ({
  fetchTimerWorkspace: jest.fn(),
  startTimerForTask: jest.fn(),
  stopTimerSession: jest.fn(),
}));

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;

const WORKSPACE: TimerWorkspaceState = {
  activeSession: {
    sessionId: 'session-1',
    taskId: 'task-1',
    startedAt: '2026-08-22T10:00:00.000Z',
    elapsedLabel: '5m',
    taskTitle: 'Ship canonical timer',
  },
  summary: {
    trackedTodaySeconds: 300,
    trackedTodayLabel: '5m',
    trackedTotalSeconds: 300,
    trackedTotalLabel: '5m',
    sessionsTodayCount: 1,
    longestSessionSeconds: 300,
    longestSessionLabel: '5m',
    longestSessionTaskTitle: 'Ship canonical timer',
  },
};

const START_RESPONSE: TimerStartResponse = { ok: true, activeSession: WORKSPACE.activeSession! };

type QueryOptions = { queryKey: unknown[]; queryFn: () => Promise<unknown> };
type MutationOptions = {
  mutationFn: (input: unknown) => Promise<unknown>;
  onSuccess?: (data: unknown) => void;
  onError?: (error: unknown) => void;
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
    return { isPending: false, mutateAsync: jest.fn() };
  });
}

function installQueryClient() {
  const invalidateQueries = jest.fn().mockResolvedValue(undefined);
  (ReactQuery.useQueryClient as unknown as jest.Mock).mockReturnValue({ invalidateQueries });
  return invalidateQueries;
}

function invalidatedKeys(invalidateQueries: jest.Mock) {
  return invalidateQueries.mock.calls.map((call) => call[0].queryKey);
}

describe('timer query hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installCapture();
    installQueryClient();
  });

  it('useTimerWorkspaceQuery targets the canonical server workspace', async () => {
    mock(timerApi.fetchTimerWorkspace).mockResolvedValue(WORKSPACE);

    useTimerWorkspaceQuery();

    expect(queryCall?.queryKey).toEqual(['timer', 'workspace']);
    await expect(queryCall?.queryFn()).resolves.toBe(WORKSPACE);
    expect(timerApi.fetchTimerWorkspace).toHaveBeenCalledTimes(1);
  });

  it('start success invalidates timer, today, and tracked-task caches', async () => {
    mock(timerApi.startTimerForTask).mockResolvedValue(START_RESPONSE);
    const invalidateQueries = installQueryClient();

    useStartTimerMutation();

    await mutationCalls[0].mutationFn('task-1');
    expect(timerApi.startTimerForTask).toHaveBeenCalledWith('task-1');

    mutationCalls[0].onSuccess?.(START_RESPONSE);
    const keys = invalidatedKeys(invalidateQueries);
    expect(keys).toContainEqual(['timer']);
    expect(keys).toContainEqual(['today']);
    expect(keys).toContainEqual(['tasks', 'list']);
  });

  it('a rejected start reconciles against server truth so a concurrent session is adopted', async () => {
    mock(timerApi.startTimerForTask).mockRejectedValue(
      new Error('A timer is already running. Stop it before starting a new one.'),
    );
    const invalidateQueries = installQueryClient();

    useStartTimerMutation();

    await expect(mutationCalls[0].mutationFn('task-1')).rejects.toThrow(
      'A timer is already running.',
    );

    mutationCalls[0].onError?.(new Error('A timer is already running.'));
    const keys = invalidatedKeys(invalidateQueries);
    expect(keys).toContainEqual(['timer', 'workspace']);
    expect(keys).not.toContainEqual(['today']);
  });

  it('stop success invalidates timer, today, and tracked-task caches', async () => {
    mock(timerApi.stopTimerSession).mockResolvedValue({
      ok: true as const,
      sessionId: 'session-1',
      taskId: 'task-1',
    });
    const invalidateQueries = installQueryClient();

    useStopTimerMutation();

    await mutationCalls[0].mutationFn('session-1');
    expect(timerApi.stopTimerSession).toHaveBeenCalledWith('session-1');

    mutationCalls[0].onSuccess?.({});
    const keys = invalidatedKeys(invalidateQueries);
    expect(keys).toContainEqual(['timer']);
    expect(keys).toContainEqual(['today']);
  });

  it('a rejected stop (no matching session) reconciles the workspace without touching other caches', async () => {
    mock(timerApi.stopTimerSession).mockRejectedValue(
      new Error('No running timer session matches this request.'),
    );
    const invalidateQueries = installQueryClient();

    useStopTimerMutation();

    await expect(mutationCalls[0].mutationFn('session-gone')).rejects.toThrow(
      'No running timer session matches this request.',
    );

    mutationCalls[0].onError?.(new Error('No running timer session matches this request.'));
    expect(invalidatedKeys(invalidateQueries)).toEqual([['timer', 'workspace']]);
  });
});
