import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TestRenderer, { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import type { ProjectIdentityReadModel } from '@ega/api-client';
import ProjectDetailScreen from '../../../app/(app)/projects/[slug]';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-blur', () => ({
  BlurView: ({ children }: { children?: ReactNode }) => children ?? null,
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));

jest.mock('@/lib/api/projects', () => ({
  archiveMobileProject: jest.fn(),
  createMobileProject: jest.fn(),
  getMobileProjectBySlug: jest.fn(),
  listMobileProjects: jest.fn(),
  unarchiveMobileProject: jest.fn(),
  updateMobileProjectStatus: jest.fn(),
}));

import {
  archiveMobileProject,
  getMobileProjectBySlug,
  listMobileProjects,
  unarchiveMobileProject,
  updateMobileProjectStatus,
} from '@/lib/api/projects';

const mock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as jest.MockedFunction<T>;

const DETAIL: ProjectIdentityReadModel = {
  project: {
    id: 'p-1',
    name: 'Launch',
    slug: 'launch',
    description: 'Ship the first release',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  goals: [{ id: 'g-1', title: 'Prove the loop', projectId: 'p-1' }],
};

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

function textIncludes(tree: ReturnType<typeof create>, fragment: string) {
  return collectText(tree.root).join('\n').includes(fragment);
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

async function flushAll(turns = 8) {
  for (let index = 0; index < turns; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const mountedTrees: Array<ReturnType<typeof create>> = [];
const mountedQueryClients: QueryClient[] = [];

async function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <ProjectDetailScreen />
      </QueryClientProvider>,
    );
  });
  mountedTrees.push(tree);
  mountedQueryClients.push(queryClient);

  return tree;
}

async function openActionsSheet(tree: ReturnType<typeof create>) {
  const actionsButton = findPressableByText(tree, 'Actions');
  expect(actionsButton).not.toBeNull();
  await act(async () => {
    actionsButton?.onPress?.();
  });
}

describe('ProjectDetailScreen status actions (ws10 port)', () => {
  const useParamsMock = useLocalSearchParams as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    useParamsMock.mockReturnValue({ slug: 'launch' });
    mock(getMobileProjectBySlug).mockResolvedValue(DETAIL);
    mock(listMobileProjects).mockResolvedValue({
      projects: [],
      summary: { total: 1, active: 1, completed: 0, archived: 0 },
    });
    mock(updateMobileProjectStatus).mockResolvedValue(undefined);
    mock(archiveMobileProject).mockResolvedValue(undefined);
    mock(unarchiveMobileProject).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => {
      while (mountedTrees.length > 0) {
        mountedTrees.pop()?.unmount();
      }
    });
    // Unmounting schedules each cached query's default 5-minute gc timer;
    // clearing the client destroys the queries and cancels those handles so
    // Jest can exit without --forceExit.
    while (mountedQueryClients.length > 0) {
      mountedQueryClients.pop()?.clear();
    }
  });

  it('renders the project summary and linked goals when loaded', async () => {
    const tree = await renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'Launch')).toBe(true);
    expect(textIncludes(tree, 'Ship the first release')).toBe(true);
    expect(textIncludes(tree, 'Prove the loop')).toBe(true);
    expect(textIncludes(tree, 'Actions')).toBe(true);
  });

  it('updates the project status through the canonical wrapper from the actions sheet', async () => {
    const tree = await renderScreen();
    await flushAll();

    await openActionsSheet(tree);

    const doneItem = findPressableByText(tree, 'done');
    expect(doneItem).not.toBeNull();

    await act(async () => {
      doneItem?.onPress?.();
    });
    await flushAll();

    expect(updateMobileProjectStatus).toHaveBeenCalledWith('p-1', 'done');
  });

  it('does not call the API for the current status option', async () => {
    const tree = await renderScreen();
    await flushAll();

    await openActionsSheet(tree);

    const currentItem = findPressableByText(tree, 'active');
    expect(currentItem).not.toBeNull();

    await act(async () => {
      currentItem?.onPress?.();
    });
    await flushAll();

    expect(updateMobileProjectStatus).not.toHaveBeenCalled();
  });

  it('archives an active project through the actions sheet', async () => {
    const tree = await renderScreen();
    await flushAll();

    await openActionsSheet(tree);

    const archiveItem = findPressableByText(tree, 'Archive project');
    expect(archiveItem).not.toBeNull();

    await act(async () => {
      archiveItem?.onPress?.();
    });
    await flushAll();

    expect(archiveMobileProject).toHaveBeenCalledWith('p-1');
    expect(unarchiveMobileProject).not.toHaveBeenCalled();
  });

  it('offers unarchive instead of archive for archived projects', async () => {
    mock(getMobileProjectBySlug).mockResolvedValue({
      ...DETAIL,
      project: { ...DETAIL.project, status: 'archived' },
    });

    const tree = await renderScreen();
    await flushAll();

    await openActionsSheet(tree);

    expect(textIncludes(tree, 'Unarchive project')).toBe(true);

    const unarchiveItem = findPressableByText(tree, 'Unarchive project');
    await act(async () => {
      unarchiveItem?.onPress?.();
    });
    await flushAll();

    expect(unarchiveMobileProject).toHaveBeenCalledWith('p-1');
    expect(archiveMobileProject).not.toHaveBeenCalled();
  });

  it('surfaces a mutation failure next to the header', async () => {
    mock(updateMobileProjectStatus).mockRejectedValue(new Error('Status rejected'));

    const tree = await renderScreen();
    await flushAll();

    await openActionsSheet(tree);

    const doneItem = findPressableByText(tree, 'done');
    await act(async () => {
      doneItem?.onPress?.();
    });
    await flushAll();

    expect(updateMobileProjectStatus).toHaveBeenCalledWith('p-1', 'done');
    expect(textIncludes(tree, 'Status rejected')).toBe(true);
  });

  it('keeps the loading skeleton until the detail query resolves', async () => {
    mock(getMobileProjectBySlug).mockImplementation(() => new Promise(() => {}));

    const tree = await renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'Launch')).toBe(false);
  });

  it('keeps the error state with retry when the detail query fails', async () => {
    mock(getMobileProjectBySlug).mockRejectedValue(new Error('Load failed'));

    const tree = await renderScreen();
    await flushAll();

    expect(textIncludes(tree, 'Load failed')).toBe(true);
    expect(textIncludes(tree, 'Retry')).toBe(true);
  });
});
