/**
 * Unit tests for the mobile goal API wrappers (lib/api/goals.ts).
 * A fake @ega/api-client is injected through the test seam, so the suite
 * proves the wrappers delegate to the right client method, pass arguments
 * through, and normalize errors — with zero network access.
 */
import type {
  ApiResult,
  CreateGoalInput,
  GoalFormValues,
  GoalHealth,
  GoalStatus,
  GoalsReadModel,
} from '@ega/api-client';
import { setMobileEgaApiClientForTesting } from '@/lib/api/ega';
import {
  archiveMobileGoal,
  createMobileGoal,
  listMobileGoals,
  unarchiveMobileGoal,
  updateMobileGoalHealth,
  updateMobileGoalNextStep,
  updateMobileGoalStatus,
} from '@/lib/api/goals';

const GOALS_READ_MODEL: GoalsReadModel = {
  projects: [{ id: 'p-1', name: 'Launch' }],
  goals: [
    {
      id: 'g-1',
      title: 'Ship v1',
      description: null,
      nextStep: 'Review PR',
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

const GOAL_FORM_VALUES: GoalFormValues = {
  title: 'Ship v1',
  projectId: 'p-1',
  description: '',
  nextStep: '',
  health: 'on_track',
  status: 'active',
  slug: 'ship-v1',
};

function makeFakeGoalsApi() {
  return {
    list: jest.fn(async (): Promise<ApiResult<GoalsReadModel>> => ({ ok: true as const, data: GOALS_READ_MODEL })),
    create: jest.fn(async (): Promise<ApiResult<{ values: GoalFormValues }>> => ({ ok: true as const, data: { values: GOAL_FORM_VALUES } })),
    updateStatus: jest.fn(async (): Promise<ApiResult<{ ok: true }>> => ({ ok: true as const, data: { ok: true as const } })),
    updateHealth: jest.fn(async (): Promise<ApiResult<{ ok: true }>> => ({ ok: true as const, data: { ok: true as const } })),
    updateNextStep: jest.fn(async (): Promise<ApiResult<{ ok: true }>> => ({ ok: true as const, data: { ok: true as const } })),
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
    today: {
      get: jest.fn(), plan: jest.fn(), remove: jest.fn(), updateStatus: jest.fn(), clearCompleted: jest.fn(),
    },
    weeklyReview: {
      get: jest.fn(),
    },
    notifications: {
      list: jest.fn(), unreadCount: jest.fn(), markRead: jest.fn(), markOpened: jest.fn(), markAllRead: jest.fn(), registerDevice: jest.fn(), unregisterDevice: jest.fn(), preferences: jest.fn(), updatePreferences: jest.fn(),
    },
  };
}

describe('mobile goal API wrappers', () => {
  let fakeGoals: ReturnType<typeof makeFakeGoalsApi>;

  beforeEach(() => {
    fakeGoals = makeFakeGoalsApi();
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
      projects: {
        list: jest.fn(),
        getBySlug: jest.fn(),
        create: jest.fn(),
        updateStatus: jest.fn(),
        archive: jest.fn(),
        unarchive: jest.fn(),
      },
      goals: fakeGoals,
      ...makeWave2Apis(),
    });
  });

  afterEach(() => {
    setMobileEgaApiClientForTesting(null);
  });

  it('listMobileGoals delegates to goals.list and returns the read model', async () => {
    const result = await listMobileGoals('all');
    expect(fakeGoals.list).toHaveBeenCalledWith('all');
    expect(result).toEqual(GOALS_READ_MODEL);
  });

  it('listMobileGoals forwards an omitted view', async () => {
    await listMobileGoals();
    expect(fakeGoals.list).toHaveBeenCalledWith(undefined);
  });

  it('createMobileGoal delegates and returns the echoed form values', async () => {
    const input: CreateGoalInput = {
      title: 'Ship v1',
      projectId: 'p-1',
      description: null,
      nextStep: null,
      health: 'on_track',
      status: 'active',
      slug: 'ship-v1',
    };
    const result = await createMobileGoal(input);
    expect(fakeGoals.create).toHaveBeenCalledWith(input);
    expect(result).toEqual(GOAL_FORM_VALUES);
  });

  it('updateMobileGoalStatus delegates with the id and status', async () => {
    const status: GoalStatus = 'done';
    await updateMobileGoalStatus('g-1', status);
    expect(fakeGoals.updateStatus).toHaveBeenCalledWith('g-1', status);
  });

  it('updateMobileGoalHealth delegates including null health', async () => {
    const health: GoalHealth = 'at_risk';
    await updateMobileGoalHealth('g-1', health);
    await updateMobileGoalHealth('g-1', null);
    expect(fakeGoals.updateHealth).toHaveBeenCalledWith('g-1', health);
    expect(fakeGoals.updateHealth).toHaveBeenCalledWith('g-1', null);
  });

  it('updateMobileGoalNextStep delegates including null next step', async () => {
    await updateMobileGoalNextStep('g-1', 'Write tests');
    await updateMobileGoalNextStep('g-1', null);
    expect(fakeGoals.updateNextStep).toHaveBeenCalledWith('g-1', 'Write tests');
    expect(fakeGoals.updateNextStep).toHaveBeenCalledWith('g-1', null);
  });

  it('archive and unarchive delegate to their endpoints', async () => {
    await archiveMobileGoal('g-1');
    await unarchiveMobileGoal('g-1');
    expect(fakeGoals.archive).toHaveBeenCalledWith('g-1');
    expect(fakeGoals.unarchive).toHaveBeenCalledWith('g-1');
  });

  it('throws the server message when the client returns an error', async () => {
    fakeGoals.list.mockResolvedValueOnce({
      ok: false as const,
      error: { code: 'NOT_FOUND', message: 'Goals not found.', status: 404 },
    } as ApiResult<GoalsReadModel>);
    await expect(listMobileGoals()).rejects.toThrow('Goals not found.');
  });
});
