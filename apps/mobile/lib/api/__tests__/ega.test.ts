/**
 * Unit tests for the mobile @ega/api-client binding (lib/api/ega.ts).
 * Covers result unwrapping and the singleton test seam; the token provider
 * is exercised through the configured session handlers.
 */
import { configureMobileApiClient, getMobileSessionAccessToken } from '@/lib/api/client';
import {
  getMobileEgaApiClient,
  setMobileEgaApiClientForTesting,
  unwrapApiResult,
} from '@/lib/api/ega';
import {
  type ApiResult,
  type EgaApiClient,
} from '@ega/api-client';
import type { OperatorSnapshotDto } from '@ega/contracts/operator';

const EMPTY_TODAY_RESPONSE: OperatorSnapshotDto = {
  ok: true,
  date: '2026-08-10',
  timezone: 'UTC',
  timeContextId: '2026-08-10::UTC::2026-08-10T00:00:00.000Z',
  dayWindow: { startUtcIso: '2026-08-10T00:00:00.000Z', endUtcIso: '2026-08-11T00:00:00.000Z' },
  plannedToday: [],
  sections: { planned: [], inProgress: [], blocked: [], completed: [] },
  focus: { startHere: null, queue: [] },
  schedule: { blocks: [], flexible: [] },
  suggestions: { pinned: [], inProgress: [] },
  summary: {
    plannedCount: 0,
    inProgressCount: 0,
    blockedCount: 0,
    completedCount: 0,
    selectedCount: 0,
    clearableCompletedCount: 0,
    overdueCount: 0,
    dueTodayCount: 0,
    totalEstimateMinutes: 0,
    trackedTodaySeconds: 0,
    trackedTodayLabel: '0m',
  },
  activeTimer: null,
  signals: { health: null, friction: null, inbox: null, weeklyObjective: null },
};

function makeFakeClient(): EgaApiClient {
  return {
    health: jest.fn(async () => ({ ok: true as const, data: { status: 'ok' as const } })),
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
      list: jest.fn(async () => ({ ok: true as const, data: { projects: [], summary: { total: 0, active: 0, completed: 0, archived: 0 } } })),
      getBySlug: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
      archive: jest.fn(),
      unarchive: jest.fn(),
      remove: jest.fn(),
      getPurgePreview: jest.fn(),
      purge: jest.fn(),
    },
    goals: {
      list: jest.fn(async () => ({ ok: true as const, data: { projects: [], goals: [], summary: { total: 0, active: 0, completed: 0, archived: 0 } } })),
      create: jest.fn(),
      updateStatus: jest.fn(),
      updateHealth: jest.fn(),
      updateNextStep: jest.fn(),
      archive: jest.fn(),
      unarchive: jest.fn(),
    },
    tasks: {
      list: jest.fn(async () => ({
        ok: true as const,
        data: {
          ok: true as const,
          tasks: [],
          counters: {
            total: 0,
            byStatus: { todo: 0, in_progress: 0, done: 0, blocked: 0 },
            byPriority: { low: 0, medium: 0, high: 0, urgent: 0 },
            pinned: 0,
            overdue: 0,
            dueToday: 0,
          },
          filters: {
            status: null,
            projectId: null,
            goalId: null,
            priority: null,
            due: 'all' as const,
            sort: 'updated_desc' as const,
            plannedForDate: null,
            includeArchived: false,
            limit: null,
          },
          projects: [],
          goals: [],
        },
      })),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      unarchive: jest.fn(),
      createReminder: jest.fn(),
      cancelReminder: jest.fn(),
      setRecurrence: jest.fn(),
      clearRecurrence: jest.fn(),
      pin: jest.fn(),
      unpin: jest.fn(),
    },
    inbox: {
      list: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      archive: jest.fn(),
      restore: jest.fn(),
      convert: jest.fn(),
    },
    today: {
      get: jest.fn(async (): Promise<ApiResult<OperatorSnapshotDto>> => ({ ok: true as const, data: EMPTY_TODAY_RESPONSE })),
      plan: jest.fn(),
      remove: jest.fn(),
      updateStatus: jest.fn(),
      clearCompleted: jest.fn(),
    },
    operator: {
      create: jest.fn(),
      revise: jest.fn(),
      approve: jest.fn(),
      apply: jest.fn(),
      dismiss: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
    },
    weeklyReview: {
      get: jest.fn(),
    },
    healthSnapshot: {
      getSnapshot: jest.fn(),
    },
    friction: {
      radar: jest.fn(async () => ({
        ok: true as const,
        data: {
          ok: true as const,
          generatedAt: "2026-08-27T12:00:00.000Z",
          thresholdDays: 7,
          blocked: [],
          staleTasks: [],
          staleGoals: [],
          estimateSignals: [],
          contextSwitch: {
            switchCount: 0,
            threshold: 6,
            highThreshold: 10,
            severity: "none" as const,
            isFriction: false,
            transitionsCount: 0,
            distinctTaskCount: 0,
            window: { startIso: "2026-08-27T00:00:00.000Z", endIso: "2026-08-27T12:00:00.000Z" },
          },
          neglectedGoals: [],
          workloadImbalance: {
            isImbalance: false,
            severity: "none" as const,
            totalTrackedSeconds: 0,
            totalTrackedMinutes: 0,
            projectCount: 0,
            dominantProjectId: null,
            dominantProjectName: null,
            dominantTrackedSeconds: 0,
            dominantSharePercent: 0,
            threshold: 60,
            highThreshold: 75,
            minTotalMinutes: 120,
            minForHighMinutes: 240,
            window: { startIso: "2026-08-27T00:00:00.000Z", endIso: "2026-08-27T12:00:00.000Z" },
          },
          evidenceWindow: null,
        },
      })),
    },
    timeContext: {
      get: jest.fn(),
    },
    notifications: {
      list: jest.fn(),
      unreadCount: jest.fn(),
      markRead: jest.fn(),
      markOpened: jest.fn(),
      markAllRead: jest.fn(),
      registerDevice: jest.fn(),
      unregisterDevice: jest.fn(),
      preferences: jest.fn(),
      updatePreferences: jest.fn(),
    },
  };
}

describe('unwrapApiResult', () => {
  it('returns data for ok results', () => {
    expect(unwrapApiResult({ ok: true, data: { status: 'ok' } })).toEqual({ status: 'ok' });
  });

  it('throws the server message for error results', () => {
    expect(() =>
      unwrapApiResult({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Project not found.', status: 404 },
      }),
    ).toThrow('Project not found.');
  });
});

describe('getMobileEgaApiClient', () => {
  afterEach(() => {
    setMobileEgaApiClientForTesting(null);
  });

  it('returns the injected fake when set for testing', () => {
    const fake = makeFakeClient();
    setMobileEgaApiClientForTesting(fake);
    expect(getMobileEgaApiClient()).toBe(fake);
  });

  it('rebuilds the real client after a reset with the full Wave 2 surface', () => {
    setMobileEgaApiClientForTesting(makeFakeClient());
    setMobileEgaApiClientForTesting(null);
    const client = getMobileEgaApiClient();
    expect(typeof client.projects.list).toBe('function');
    expect(typeof client.goals.list).toBe('function');
    expect(typeof client.tasks.list).toBe('function');
    expect(typeof client.tasks.setRecurrence).toBe('function');
    expect(typeof client.today.get).toBe('function');
    expect(typeof client.today.clearCompleted).toBe('function');
    expect(typeof client.health).toBe('function');
  });
});

describe('getMobileSessionAccessToken', () => {
  afterEach(() => {
    setMobileEgaApiClientForTesting(null);
  });

  it('returns null before session handlers are configured', async () => {
    configureMobileApiClient({
      getSession: async () => null,
      setSession: async () => {},
      clearSession: async () => {},
      onUnauthorized: () => {},
    });
    expect(await getMobileSessionAccessToken()).toBeNull();
  });

  it('returns the access token of the configured session', async () => {
    configureMobileApiClient({
      getSession: async () => ({
        session: {
          accessToken: 'token-123',
          refreshToken: 'refresh-123',
          expiresAt: 9999999999,
        },
        user: { id: 'u-1', email: 'a@b.c' },
      }),
      setSession: async () => {},
      clearSession: async () => {},
      onUnauthorized: () => {},
    });
    expect(await getMobileSessionAccessToken()).toBe('token-123');
  });
});
