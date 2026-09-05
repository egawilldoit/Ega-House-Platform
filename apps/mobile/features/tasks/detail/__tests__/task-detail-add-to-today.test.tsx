import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestRenderer, { act } from 'react-test-renderer';
import { useLocalSearchParams, useRouter } from 'expo-router';

import type { MobileTaskListItem } from '@/types/tasks';
import * as todayApi from '@/lib/api/today';
import { todayQueryKeys } from '@/features/today/query';
import * as todayQuery from '@/features/today/query';
import * as tasksQuery from '@/features/tasks/query';
import { TaskDetailScreen } from '../TaskDetailScreen';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('@/lib/notifications/provider', () => ({
  useNotifications: jest.fn(),
}));

jest.mock('@/features/tasks/query', () => {
  const actual = jest.requireActual('@/features/tasks/query');
  return {
    ...actual,
    useTaskByIdQuery: jest.fn(),
    useUpdateTaskMutation: jest.fn(),
    useCreateTaskReminderMutation: jest.fn(),
    useCancelTaskReminderMutation: jest.fn(),
  };
});

jest.mock('@/lib/api/today', () => {
  const actual = jest.requireActual('@/lib/api/today');
  return {
    ...actual,
    addMobileTaskToToday: jest.fn(),
  };
});

const mock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as jest.MockedFunction<T>;

const TASK: MobileTaskListItem = {
  id: 't-1',
  title: 'Write the recovery plan',
  description: null,
  blockedReason: null,
  status: 'todo',
  priority: 'high',
  dueDate: null,
  plannedForDate: null,
  archivedAt: null,
  estimateMinutes: null,
  updatedAt: '2026-09-04T00:00:00.000Z',
  focusRank: null,
  trackedDurationSeconds: 0,
  project: { id: 'p-1', name: 'Launch', slug: 'launch' },
  goal: null,
  reminders: [],
  recurrence: null,
};

function setup() {
  (useLocalSearchParams as unknown as jest.Mock).mockReturnValue({ id: 't-1' });
  (useRouter as unknown as jest.Mock).mockReturnValue({
    back: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
  });
  mock(tasksQuery.useTaskByIdQuery).mockReturnValue({
    data: TASK,
    refetch: jest.fn().mockResolvedValue({ data: TASK }),
  } as never);
  const idleMutation = { isPending: false, mutateAsync: jest.fn() };
  mock(tasksQuery.useUpdateTaskMutation).mockReturnValue(idleMutation as never);
  mock(tasksQuery.useCreateTaskReminderMutation).mockReturnValue(idleMutation as never);
  mock(tasksQuery.useCancelTaskReminderMutation).mockReturnValue(idleMutation as never);
  const { useNotifications } = jest.requireMock('@/lib/notifications/provider') as {
    useNotifications: jest.Mock;
  };
  useNotifications.mockReturnValue({
    permissionStatus: 'granted',
    requestPermissionAndRegister: jest.fn(),
  });
}

async function renderScreen(queryClient: QueryClient) {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <TaskDetailScreen />
      </QueryClientProvider>,
    );
  });
  if (!renderer) {
    throw new Error('failed to render TaskDetailScreen');
  }
  return renderer;
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}

function findAddButton(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findByProps({ testID: 'task-detail-add-to-today' });
}

describe('TaskDetailScreen Add to Today', () => {
  const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
  const mountedClients: QueryClient[] = [];

  async function renderTrackedScreen() {
    const queryClient = createQueryClient();
    mountedClients.push(queryClient);
    const renderer = await renderScreen(queryClient);
    mountedTrees.push(renderer);
    return { renderer, queryClient };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setup();
  });

  afterEach(async () => {
    await act(async () => {
      while (mountedTrees.length > 0) {
        mountedTrees.pop()?.unmount();
      }
    });
    while (mountedClients.length > 0) {
      mountedClients.pop()?.clear();
    }
    jest.restoreAllMocks();
  });

  it('offers an Add to Today action for the loaded task', async () => {
    const { renderer } = await renderTrackedScreen();
    const button = findAddButton(renderer);
    expect(button.props.title).toBe('Add to Today');
  });

  it('invokes the canonical Today mutation and confirms success', async () => {
    const { renderer, queryClient } = await renderTrackedScreen();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    mock(todayApi.addMobileTaskToToday).mockResolvedValue({ ok: true, taskId: 't-1' });

    await act(async () => {
      await findAddButton(renderer).props.onPress();
    });

    expect(todayApi.addMobileTaskToToday).toHaveBeenCalledWith('t-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: todayQueryKeys.all });
    expect(
      renderer.root.findAllByProps({ children: 'Added to Today.' }).length,
    ).toBeGreaterThan(0);
  });

  it('disables the action while the mutation is in flight', async () => {
    const pendingSpy = jest
      .spyOn(todayQuery, 'useAddTaskToTodayMutation')
      .mockReturnValue({ isPending: true, mutateAsync: jest.fn() } as never);
    const { renderer } = await renderTrackedScreen();

    const button = findAddButton(renderer);
    expect(button.props.title).toBe('Adding...');
    expect(button.props.disabled ?? button.props.loading).toBe(true);
    pendingSpy.mockRestore();
  });

  it('surfaces a recoverable error when the mutation fails', async () => {
    const { renderer } = await renderTrackedScreen();
    mock(todayApi.addMobileTaskToToday).mockRejectedValue(new Error('Today is unavailable'));

    await act(async () => {
      await findAddButton(renderer).props.onPress();
    });

    expect(
      renderer.root.findAllByProps({ children: 'Today is unavailable' }).length,
    ).toBeGreaterThan(0);
    expect(findAddButton(renderer).props.disabled).not.toBe(true);
  });
});
