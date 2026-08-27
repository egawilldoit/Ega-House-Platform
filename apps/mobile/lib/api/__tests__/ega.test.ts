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
import type { MobileTodayResponse } from '@ega/contracts/mobile';

const EMPTY_TODAY_RESPONSE: MobileTodayResponse = {
  ok: true,
  date: '2026-08-10',
  sections: { planned: [], inProgress: [], blocked: [], completed: [] },
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
    today: {
      get: jest.fn(async (): Promise<ApiResult<MobileTodayResponse>> => ({ ok: true as const, data: EMPTY_TODAY_RESPONSE })),
      plan: jest.fn(),
      remove: jest.fn(),
      updateStatus: jest.fn(),
      clearCompleted: jest.fn(),
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
