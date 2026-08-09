import * as ReactQuery from '@tanstack/react-query';

import type { ProjectsReadModel, ProjectStatus } from '@ega/api-client';
import * as projectsApi from '@/lib/api/projects';
import {
  useArchiveProjectMutation,
  useCreateProjectMutation,
  useProjectBySlugQuery,
  useProjectListQuery,
  useUnarchiveProjectMutation,
  useUpdateProjectStatusMutation,
} from '../query';

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock('@/lib/api/projects', () => ({
  archiveMobileProject: jest.fn(),
  createMobileProject: jest.fn(),
  getMobileProjectBySlug: jest.fn(),
  listMobileProjects: jest.fn(),
  unarchiveMobileProject: jest.fn(),
  updateMobileProjectStatus: jest.fn(),
}));

const mock = <T extends (...args: never[]) => unknown>(fn: T) =>
  fn as jest.MockedFunction<T>;

const READ_MODEL: ProjectsReadModel = {
  projects: [
    {
      id: 'p-1',
      name: 'Launch',
      slug: 'launch',
      description: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      taskCount: 2,
      completedTaskCount: 1,
      progressPercent: 50,
      statusCounts: [{ status: 'done', count: 1 }],
      recentTasks: [],
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

describe('project query hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installCapture();
    mockInvalidations();
  });

  it('useProjectListQuery targets the requested view', async () => {
    mock(projectsApi.listMobileProjects).mockResolvedValue(READ_MODEL);

    useProjectListQuery('archived');

    expect(queryCall?.queryKey).toEqual(['projects', 'list', 'archived']);
    await expect(queryCall?.queryFn()).resolves.toBe(READ_MODEL);
    expect(projectsApi.listMobileProjects).toHaveBeenCalledWith('archived');
  });

  it('useProjectBySlugQuery targets the slug detail', async () => {
    mock(projectsApi.getMobileProjectBySlug).mockResolvedValue({
      project: READ_MODEL.projects[0],
      goals: [],
    });

    useProjectBySlugQuery('launch');

    expect(queryCall?.queryKey).toEqual(['projects', 'detail', 'launch']);
    await expect(queryCall?.queryFn()).resolves.toMatchObject({
      project: expect.objectContaining({ slug: 'launch' }),
    });
  });

  it('useCreateProjectMutation delegates and invalidates project lists', async () => {
    mock(projectsApi.createMobileProject).mockResolvedValue({
      name: 'Launch',
      slug: 'launch',
      description: '',
    });
    const invalidateQueries = mockInvalidations();

    useCreateProjectMutation();

    await mutationCalls[0].mutationFn({ name: 'Launch', slug: 'launch', description: '' });
    expect(projectsApi.createMobileProject).toHaveBeenCalledWith({
      name: 'Launch',
      slug: 'launch',
      description: '',
    });

    mutationCalls[0].onSuccess?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects', 'list'] });
  });

  it('useUpdateProjectStatusMutation invalidates lists and details', async () => {
    mock(projectsApi.updateMobileProjectStatus).mockResolvedValue(undefined);
    const invalidateQueries = mockInvalidations();

    useUpdateProjectStatusMutation();

    await mutationCalls[0].mutationFn({ projectId: 'p-1', status: 'paused' as ProjectStatus });
    expect(projectsApi.updateMobileProjectStatus).toHaveBeenCalledWith('p-1', 'paused');

    mutationCalls[0].onSuccess?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects', 'list'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects', 'detail'] });
  });

  it('archive and unarchive mutations invalidate lists', async () => {
    mock(projectsApi.archiveMobileProject).mockResolvedValue(undefined);
    mock(projectsApi.unarchiveMobileProject).mockResolvedValue(undefined);
    const invalidateQueries = mockInvalidations();

    useArchiveProjectMutation();
    useUnarchiveProjectMutation();

    await mutationCalls[0].mutationFn('p-1');
    expect(projectsApi.archiveMobileProject).toHaveBeenCalledWith('p-1');

    await mutationCalls[1].mutationFn('p-1');
    expect(projectsApi.unarchiveMobileProject).toHaveBeenCalledWith('p-1');

    mutationCalls[0].onSuccess?.({});
    mutationCalls[1].onSuccess?.({});
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects', 'list'] });
  });
});
