import type { ReactNode } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import type { GoalReadModel } from '@ega/api-client';
import GoalDetailScreen from '../../../app/(app)/goals/[id]';
import * as goalsQuery from '../query';

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

jest.mock('../query', () => ({
  useGoalDetailQuery: jest.fn(),
  useArchiveGoalMutation: jest.fn(),
  useUnarchiveGoalMutation: jest.fn(),
  useUpdateGoalHealthMutation: jest.fn(),
  useUpdateGoalNextStepMutation: jest.fn(),
  useUpdateGoalStatusMutation: jest.fn(),
}));

const mock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as jest.MockedFunction<T>;

const GOAL: GoalReadModel = {
  id: 'g-1',
  title: 'Ship the dashboard',
  description: 'Launch the analytics surface',
  nextStep: 'Draft spec',
  health: 'on_track',
  status: 'active',
  updatedAt: '2026-01-02T00:00:00.000Z',
  projectName: 'Launch',
  linkedTasks: [{ id: 't-1', title: 'Write spec', status: 'done', goalId: 'g-1' }],
  progressPercent: 40,
};

function mockDetailQuery(state: {
  data?: GoalReadModel | null;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
}) {
  mock(goalsQuery.useGoalDetailQuery).mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.error ?? null,
    isFetching: false,
    refetch: jest.fn().mockResolvedValue(undefined),
  } as never);
}

function mockMutationsAsIdle() {
  const idle = { isPending: false, mutate: jest.fn(), mutateAsync: jest.fn() };
  mock(goalsQuery.useArchiveGoalMutation).mockReturnValue(idle as never);
  mock(goalsQuery.useUnarchiveGoalMutation).mockReturnValue(idle as never);
  mock(goalsQuery.useUpdateGoalHealthMutation).mockReturnValue(idle as never);
  mock(goalsQuery.useUpdateGoalNextStepMutation).mockReturnValue(idle as never);
  mock(goalsQuery.useUpdateGoalStatusMutation).mockReturnValue(idle as never);
}

function collectText(node: TestRenderer.ReactTestInstance): string[] {
  if (node.type === Text) {
    const children = node.props.children;
    if (typeof children === 'string') {
      return [children];
    }
    if (Array.isArray(children)) {
      return children.filter((child): child is string => typeof child === 'string');
    }
    return [];
  }
  return node.children.flatMap((child) =>
    typeof child === 'object' && child !== null ? collectText(child) : [],
  );
}

async function renderScreen() {
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<GoalDetailScreen />);
  });
  return renderer!;
}

describe('GoalDetailScreen', () => {
  const useParamsMock = useLocalSearchParams as unknown as jest.Mock;
  const useRouterMock = useRouter as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useParamsMock.mockReturnValue({ id: 'g-1' });
    useRouterMock.mockReturnValue({ back: jest.fn(), push: jest.fn() });
    mockMutationsAsIdle();
  });

  it('renders goal summary, progress, and linked tasks when loaded', async () => {
    mockDetailQuery({ data: GOAL });

    const renderer = await renderScreen();
    const text = collectText(renderer.root).join('\n');

    expect(text).toContain('Ship the dashboard');
    expect(text).toContain('LAUNCH');
    expect(text).toContain('Launch the analytics surface');
    const nextStepInputs = renderer.root.findAll(
      (node) => node.props?.value === 'Draft spec',
    );
    expect(nextStepInputs.length).toBeGreaterThan(0);
    expect(text).toContain('40%');
    expect(text).toContain('Linked tasks (1)');
    expect(text).toContain('Write spec');
  });

  it('renders the not-found empty state for an unknown goal', async () => {
    mockDetailQuery({ data: null });

    const renderer = await renderScreen();
    const text = collectText(renderer.root).join('\n');

    expect(text).toContain('Goal not found');
  });

  it('renders loading skeletons while the detail query is pending', async () => {
    mockDetailQuery({ data: undefined, isLoading: true });

    const renderer = await renderScreen();
    const text = collectText(renderer.root).join('\n');

    expect(text).not.toContain(GOAL.title);
    expect(text).toContain('Goal details');
  });

  it('renders an error state with retry when the query fails', async () => {
    mockDetailQuery({ data: undefined, isError: true, error: new Error('Network down') });

    const renderer = await renderScreen();
    const text = collectText(renderer.root).join('\n');

    expect(text).toContain('Network down');
    expect(text).toContain('Retry');
  });

  it('renders the missing-id state when no id param exists', async () => {
    useParamsMock.mockReturnValue({});
    mockDetailQuery({ data: GOAL });

    const renderer = await renderScreen();
    const text = collectText(renderer.root).join('\n');

    expect(text).toContain('Goal id is missing.');
  });
});
