import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';

import type { MobileTaskListResponse, TimerWorkspaceState } from '@ega/contracts/mobile';
import TimerScreen from '../timer';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('expo-blur', () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

jest.mock('@/lib/api/timer', () => ({
  fetchTimerWorkspace: jest.fn(),
  startTimerForTask: jest.fn(),
  stopTimerSession: jest.fn(),
}));

jest.mock('@/lib/api/tasks', () => ({
  listMobileTasks: jest.fn(),
}));

import {
  fetchTimerWorkspace,
  startTimerForTask,
  stopTimerSession,
} from '@/lib/api/timer';
import { listMobileTasks } from '@/lib/api/tasks';

const mock = <T extends (...args: never[]) => unknown>(fn: T) => fn as jest.MockedFunction<T>;

const TASK_LIST: MobileTaskListResponse = {
  ok: true as const,
  tasks: [
    {
      id: 'task-1',
      title: 'Write incident review',
      description: null,
      blockedReason: null,
      status: 'todo' as const,
      priority: 'high' as const,
      dueDate: null,
      estimateMinutes: null,
      updatedAt: '2026-08-21T10:00:00.000Z',
      focusRank: null,
      trackedDurationSeconds: 0,
      project: { id: 'p-1', name: 'Ops', slug: 'ops' },
      goal: null,
      reminders: [],
      recurrence: null,
    },
    {
      id: 'task-2',
      title: 'Archive old project',
      description: null,
      blockedReason: null,
      status: 'done' as const,
      priority: 'low' as const,
      dueDate: null,
      estimateMinutes: null,
      updatedAt: '2026-08-20T10:00:00.000Z',
      focusRank: null,
      trackedDurationSeconds: 0,
      project: { id: 'p-1', name: 'Ops', slug: 'ops' },
      goal: null,
      reminders: [],
      recurrence: null,
    },
  ],
  counters: {
    total: 2,
    byStatus: { todo: 1, in_progress: 0, done: 1, blocked: 0 },
    byPriority: { low: 1, medium: 0, high: 1, urgent: 0 },
    pinned: 0,
    overdue: 0,
    dueToday: 0,
  },
  filters: {
    status: null,
    projectId: null,
    goalId: null,
    priority: null,
    due: 'all',
    sort: 'updated_desc',
    limit: null,
  },
  projects: [],
  goals: [],
};

function makeWorkspace(overrides: Partial<TimerWorkspaceState> = {}): TimerWorkspaceState {
  return {
    activeSession: null,
    summary: {
      trackedTodaySeconds: 0,
      trackedTodayLabel: '0m',
      trackedTotalSeconds: 0,
      trackedTotalLabel: '0m',
      sessionsTodayCount: 0,
      longestSessionSeconds: null,
      longestSessionLabel: null,
      longestSessionTaskTitle: null,
    },
    ...overrides,
  };
}

function runningWorkspace(startedAtIso: string, taskTitle = 'Server task'): TimerWorkspaceState {
  return makeWorkspace({
    activeSession: {
      sessionId: 'session-1',
      taskId: 'task-9',
      startedAt: startedAtIso,
      elapsedLabel: 'server label',
      taskTitle,
    },
    summary: {
      trackedTodaySeconds: 60,
      trackedTodayLabel: '1m',
      trackedTotalSeconds: 120,
      trackedTotalLabel: '2m',
      sessionsTodayCount: 1,
      longestSessionSeconds: 60,
      longestSessionLabel: '1m',
      longestSessionTaskTitle: taskTitle,
    },
  });
}

const mountedTrees: Array<ReturnType<typeof create>> = [];
const mountedQueryClients: QueryClient[] = [];

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <TimerScreen />
      </QueryClientProvider>,
    );
  });
  mountedTrees.push(tree);
  mountedQueryClients.push(queryClient);

  return { tree, queryClient };
}

type RenderNode = {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: Array<string | number | RenderNode>;
};

function collectText(node: unknown, into: string[]) {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return;
  }

  if (typeof node === 'string' || typeof node === 'number') {
    into.push(String(node));
    return;
  }

  const current = node as RenderNode;
  for (const child of current.children ?? []) {
    collectText(child, into);
  }
}

function textIncludes(tree: ReturnType<typeof create>, fragment: string) {
  const texts: string[] = [];
  collectText(tree.toJSON(), texts);
  return texts.join('\n').includes(fragment);
}

async function flushAll(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function findPressableByText(tree: ReturnType<typeof create>, fragment: string) {
  const matches: Array<{ onPress?: () => void }> = [];

  function collectText(instance: unknown, into: string[], depth: number) {
    if (!instance || typeof instance !== 'object' || depth > 30) {
      return;
    }

    const current = instance as { props?: Record<string, unknown>; children?: unknown[] };
    for (const child of current.children ?? []) {
      if (typeof child === 'string' || typeof child === 'number') {
        into.push(String(child));
      } else {
        collectText(child, into, depth + 1);
      }
    }
  }

  const candidates = tree.root.findAll((instance) => {
    const onPress = instance.props?.onPress as unknown;
    return typeof onPress === 'function';
  });

  for (const candidate of candidates) {
    const texts: string[] = [];
    collectText(candidate, texts, 0);
    if (texts.join('\n').includes(fragment)) {
      matches.push(candidate.props as { onPress?: () => void });
    }
  }

  return matches.at(-1) ?? null;
}

describe('TimerScreen (canonical server projection)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mock(listMobileTasks).mockResolvedValue(TASK_LIST);
    mock(startTimerForTask).mockRejectedValue(new Error('start should not fire unexpectedly'));
    mock(stopTimerSession).mockRejectedValue(new Error('stop should not fire unexpectedly'));
  });

  afterEach(async () => {
    await act(async () => {
      while (mountedTrees.length > 0) {
        mountedTrees.pop()?.unmount();
      }
      focusManager.setFocused(true);
    });
    // Unmounting schedules each cached query's default 5-minute gc timer;
    // clearing the clients destroys the queries and cancels those handles so
    // Jest can exit without --forceExit.
    while (mountedQueryClients.length > 0) {
      mountedQueryClients.pop()?.clear();
    }
  });

  it('cold start with no active session shows the picker without inventing a timer', async () => {
    mock(fetchTimerWorkspace).mockResolvedValue(makeWorkspace());

    const { tree } = renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'Pick a task to time')).toBe(true);
    expect(textIncludes(tree, 'Write incident review')).toBe(true);
    expect(textIncludes(tree, 'Running')).toBe(false);
    expect(fetchTimerWorkspace).toHaveBeenCalled();
  });

  it('excludes completed tasks from the picker candidates', async () => {
    mock(fetchTimerWorkspace).mockResolvedValue(makeWorkspace());

    const { tree } = renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'Write incident review')).toBe(true);
    expect(textIncludes(tree, 'Archive old project')).toBe(false);
  });

  it('adopts the authoritative server session on cold start and projects elapsed from startedAt', async () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();
    mock(fetchTimerWorkspace).mockResolvedValue(runningWorkspace(startedAt));

    const { tree } = renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'Server task')).toBe(true);
    expect(textIncludes(tree, '01:05')).toBe(true);
    expect(textIncludes(tree, 'Stop timer')).toBe(true);
    expect(textIncludes(tree, 'Pick a task to time')).toBe(false);
  });

  it('falls back to the server label when the local clock cannot parse the timestamp', async () => {
    mock(fetchTimerWorkspace).mockResolvedValue(
      runningWorkspace('not-a-real-timestamp'),
    );

    const { tree } = renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'server label')).toBe(true);
  });

  it('start success adopts the returned server session through refetch, never local state', async () => {
    mock(fetchTimerWorkspace)
      .mockResolvedValueOnce(makeWorkspace())
      .mockResolvedValueOnce(runningWorkspace(new Date().toISOString(), 'Started task'));

    mock(startTimerForTask).mockResolvedValue({
      ok: true,
      activeSession: {
        sessionId: 'session-1',
        taskId: 'task-1',
        startedAt: new Date().toISOString(),
        elapsedLabel: '0s',
        taskTitle: 'Started task',
      },
    });

    const { tree } = renderScreen();
    await flushAll();

    const row = findPressableByText(tree, 'Write incident review');
    expect(row).not.toBeNull();

    await act(async () => {
      row!.onPress?.();
    });
    await flushAll(2);

    const startButton = findPressableByText(tree, 'Start timer');
    expect(startButton).not.toBeNull();

    await act(async () => {
      startButton!.onPress?.();
    });
    await flushAll();

    expect(startTimerForTask).toHaveBeenCalledWith('task-1');
    expect(textIncludes(tree, 'Started task')).toBe(true);
    expect(textIncludes(tree, 'Stop timer')).toBe(true);
  });

  it('a duplicate-start conflict surfaces the server message and reconciles to one session', async () => {
    mock(fetchTimerWorkspace)
      .mockResolvedValueOnce(makeWorkspace())
      .mockResolvedValue(runningWorkspace(new Date().toISOString()));

    mock(startTimerForTask).mockRejectedValue(
      new Error('A timer is already running. Stop it before starting a new one.'),
    );

    const { tree } = renderScreen();
    await flushAll();

    const row = findPressableByText(tree, 'Write incident review');
    await act(async () => {
      row!.onPress?.();
    });
    await flushAll(2);

    const startButton = findPressableByText(tree, 'Start timer');
    await act(async () => {
      startButton!.onPress?.();
    });
    await flushAll();

    expect(startTimerForTask).toHaveBeenCalledTimes(1);
    expect(textIncludes(tree, 'A timer is already running.')).toBe(true);

    const texts: string[] = [];
    collectText(tree.toJSON() as RenderNode, texts);
    expect(texts.filter((line) => line === 'Stop timer')).toHaveLength(1);
  });

  it('stop success clears to the empty picker via server truth', async () => {
    mock(fetchTimerWorkspace)
      .mockResolvedValueOnce(runningWorkspace(new Date().toISOString()))
      .mockResolvedValue(makeWorkspace());
    mock(stopTimerSession).mockResolvedValue({ ok: true, sessionId: 'session-1', taskId: 'task-9' });

    const { tree } = renderScreen();
    await flushAll();

    const stopButton = findPressableByText(tree, 'Stop timer');
    await act(async () => {
      stopButton!.onPress?.();
    });
    await flushAll();

    expect(stopTimerSession).toHaveBeenCalledWith('session-1');
    expect(textIncludes(tree, 'Pick a task to time')).toBe(true);
  });

  it('stopping when nothing is running shows the server error and keeps the authoritative state', async () => {
    mock(fetchTimerWorkspace).mockResolvedValue(runningWorkspace(new Date().toISOString()));
    mock(stopTimerSession).mockRejectedValue(
      new Error('No running timer session matches this request.'),
    );

    const { tree } = renderScreen();
    await flushAll();

    const stopButton = findPressableByText(tree, 'Stop timer');
    await act(async () => {
      stopButton!.onPress?.();
    });
    await flushAll(4);

    expect(textIncludes(tree, 'No running timer session matches this request.')).toBe(true);
    expect(textIncludes(tree, 'Server task')).toBe(true);
  });

  it('foreground reconciliation replaces the local projection with fresh server truth', async () => {
    const beforeStart = new Date(Date.now() - 30_000).toISOString();
    const afterStart = new Date(Date.now() - 3_600_000).toISOString();
    mock(fetchTimerWorkspace)
      .mockResolvedValueOnce(runningWorkspace(beforeStart, 'Before resume'))
      .mockResolvedValueOnce(runningWorkspace(afterStart, 'After resume'));

    const { tree } = renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'Before resume')).toBe(true);

    await act(async () => {
      focusManager.setFocused(false);
    });
    await act(async () => {
      focusManager.setFocused(true);
    });
    await flushAll();

    expect(fetchTimerWorkspace).toHaveBeenCalledTimes(2);
    expect(textIncludes(tree, 'After resume')).toBe(true);
    expect(textIncludes(tree, 'Before resume')).toBe(false);
  });

  it('shows an explicit offline error with retry when the workspace cannot load', async () => {
    mock(fetchTimerWorkspace).mockRejectedValue(new Error('Network request failed.'));

    const { tree } = renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'Network request failed.')).toBe(true);
    expect(textIncludes(tree, 'Retry')).toBe(true);
    expect(textIncludes(tree, 'Pick a task to time')).toBe(false);
  });

  it('a failed background sync keeps stale data visible behind an explicit stale banner', async () => {
    mock(fetchTimerWorkspace)
      .mockResolvedValueOnce(runningWorkspace(new Date().toISOString(), 'Synced task'))
      .mockRejectedValue(new Error('Network request failed.'));

    const { tree, queryClient } = renderScreen();
    await flushAll();

    await act(async () => {
      await queryClient.refetchQueries().catch(() => undefined);
    });
    await flushAll();

    expect(textIncludes(tree, "Can't reach the server")).toBe(true);
    expect(textIncludes(tree, 'Synced task')).toBe(true);
  });
});
