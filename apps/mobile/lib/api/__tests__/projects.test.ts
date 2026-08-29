/**
 * Unit tests for the mobile project API wrappers (lib/api/projects.ts).
 * A fake @ega/api-client is injected through the test seam, so the suite
 * proves the wrappers delegate to the right client method, pass arguments
 * through, and normalize errors — with zero network access.
 */
import type {
  ApiResult,
  ProjectFormValues,
  ProjectIdentityReadModel,
  ProjectStatus,
  ProjectsReadModel,
} from '@ega/api-client';
import { setMobileEgaApiClientForTesting } from '@/lib/api/ega';
import {
  archiveMobileProject,
  createMobileProject,
  getMobileProjectBySlug,
  listMobileProjects,
  unarchiveMobileProject,
  updateMobileProjectStatus,
} from '@/lib/api/projects';

const PROJECTS_READ_MODEL: ProjectsReadModel = {
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

const PROJECT_IDENTITY: ProjectIdentityReadModel = {
  project: {
    id: 'p-1',
    name: 'Launch',
    slug: 'launch',
    description: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  goals: [{ id: 'g-1', title: 'Ship v1', projectId: 'p-1' }],
};

const PROJECT_FORM_VALUES: ProjectFormValues = {
  name: 'Launch',
  slug: 'launch',
  description: '',
};

function makeFakeProjectsApi() {
  return {
    list: jest.fn(async (): Promise<ApiResult<ProjectsReadModel>> => ({ ok: true as const, data: PROJECTS_READ_MODEL })),
    getBySlug: jest.fn(async (): Promise<ApiResult<ProjectIdentityReadModel>> => ({ ok: true as const, data: PROJECT_IDENTITY })),
    create: jest.fn(async (): Promise<ApiResult<{ values: ProjectFormValues }>> => ({ ok: true as const, data: { values: PROJECT_FORM_VALUES } })),
    updateStatus: jest.fn(async (): Promise<ApiResult<{ ok: true }>> => ({ ok: true as const, data: { ok: true as const } })),
    archive: jest.fn(async (): Promise<ApiResult<{ ok: true }>> => ({ ok: true as const, data: { ok: true as const } })),
    unarchive: jest.fn(async (): Promise<ApiResult<{ ok: true }>> => ({ ok: true as const, data: { ok: true as const } })),
  };
}

function makeWave2Apis() {
  return {
    tasks: {
      list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), unarchive: jest.fn(),
      createReminder: jest.fn(), cancelReminder: jest.fn(), setRecurrence: jest.fn(), clearRecurrence: jest.fn(), pin: jest.fn(), unpin: jest.fn(),
    },
    inbox: {
      list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), archive: jest.fn(), restore: jest.fn(), convert: jest.fn(),
    },
    today: {
      get: jest.fn(), plan: jest.fn(), remove: jest.fn(), updateStatus: jest.fn(), clearCompleted: jest.fn(),
    },
    timeContext: {
      get: jest.fn(),
    },
    notifications: {
      list: jest.fn(), unreadCount: jest.fn(), markRead: jest.fn(), markOpened: jest.fn(), markAllRead: jest.fn(), registerDevice: jest.fn(), unregisterDevice: jest.fn(), preferences: jest.fn(), updatePreferences: jest.fn(),
    },
  };
}

describe('mobile project API wrappers', () => {
  let fakeProjects: ReturnType<typeof makeFakeProjectsApi>;

  beforeEach(() => {
    fakeProjects = makeFakeProjectsApi();
    setMobileEgaApiClientForTesting({
      health: jest.fn(),
      auth: {
        login: jest.fn(),
        refresh: jest.fn(),
        logout: jest.fn(),
      },
      timer: {
        workspace: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      },
      projects: fakeProjects,
      goals: {
        list: jest.fn(),
        create: jest.fn(),
        updateStatus: jest.fn(),
        updateHealth: jest.fn(),
        updateNextStep: jest.fn(),
        archive: jest.fn(),
        unarchive: jest.fn(),
      },
      ...makeWave2Apis(),
    });
  });

  afterEach(() => {
    setMobileEgaApiClientForTesting(null);
  });

  it('listMobileProjects delegates to projects.list and returns the read model', async () => {
    const result = await listMobileProjects('archived');
    expect(fakeProjects.list).toHaveBeenCalledWith('archived');
    expect(result).toEqual(PROJECTS_READ_MODEL);
  });

  it('listMobileProjects forwards an omitted view', async () => {
    await listMobileProjects();
    expect(fakeProjects.list).toHaveBeenCalledWith(undefined);
  });

  it('getMobileProjectBySlug delegates to projects.getBySlug', async () => {
    const result = await getMobileProjectBySlug('launch');
    expect(fakeProjects.getBySlug).toHaveBeenCalledWith('launch');
    expect(result).toEqual(PROJECT_IDENTITY);
  });

  it('createMobileProject delegates and returns the echoed form values', async () => {
    const input = { name: 'Launch', slug: 'launch', description: null };
    const result = await createMobileProject(input);
    expect(fakeProjects.create).toHaveBeenCalledWith(input);
    expect(result).toEqual(PROJECT_FORM_VALUES);
  });

  it('updateMobileProjectStatus delegates with the id and status', async () => {
    const status: ProjectStatus = 'done';
    await updateMobileProjectStatus('p-1', status);
    expect(fakeProjects.updateStatus).toHaveBeenCalledWith('p-1', status);
  });

  it('archive and unarchive delegate to their endpoints', async () => {
    await archiveMobileProject('p-1');
    await unarchiveMobileProject('p-1');
    expect(fakeProjects.archive).toHaveBeenCalledWith('p-1');
    expect(fakeProjects.unarchive).toHaveBeenCalledWith('p-1');
  });

  it('throws the server message when the client returns an error', async () => {
    fakeProjects.list.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.', status: 401 },
    } as ApiResult<ProjectsReadModel>);
    await expect(listMobileProjects()).rejects.toThrow('Authentication required.');
  });
});
