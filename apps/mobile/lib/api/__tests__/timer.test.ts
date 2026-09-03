/**
 * Unit tests for the mobile timer API wrappers (lib/api/timer.ts).
 * Proves every timer call delegates to the shared @ega/api-client timer
 * resource — the only mobile mutation path for task sessions.
 */
import type { ApiResult, EgaApiClient } from '@ega/api-client';
import type {
  TimerStartResponse,
  TimerStopResponse,
  TimerWorkspaceState,
} from '@ega/contracts/mobile';

import { getMobileEgaApiClient, setMobileEgaApiClientForTesting } from '@/lib/api/ega';
import { fetchTimerWorkspace, startTimerForTask, stopTimerSession } from '@/lib/api/timer';

const WORKSPACE: TimerWorkspaceState = {
  activeSession: {
    sessionId: 'session-1',
    taskId: 'task-1',
    startedAt: '2026-08-22T10:00:00.000Z',
    elapsedLabel: '1h 5m',
    taskTitle: 'Ship canonical timer',
  },
  summary: {
    trackedTodaySeconds: 3900,
    trackedTodayLabel: '1h 5m',
    trackedTotalSeconds: 7800,
    trackedTotalLabel: '2h 10m',
    sessionsTodayCount: 2,
    longestSessionSeconds: 3900,
    longestSessionLabel: '1h 5m',
    longestSessionTaskTitle: 'Ship canonical timer',
  },
};

const START_RESPONSE: TimerStartResponse = {
  ok: true,
  activeSession: WORKSPACE.activeSession!,
};

const STOP_RESPONSE: TimerStopResponse = { ok: true, sessionId: 'session-1', taskId: 'task-1' };

function makeFakeClient(overrides: Partial<EgaApiClient['timer']> = {}): EgaApiClient {
  return {
    health: jest.fn(async () => ({ ok: true as const, data: { status: 'ok' as const } })),
    auth: { login: jest.fn(), refresh: jest.fn(), logout: jest.fn() },
    projects: {
      list: jest.fn(), getBySlug: jest.fn(), create: jest.fn(), updateStatus: jest.fn(), archive: jest.fn(), unarchive: jest.fn(), remove: jest.fn(),
    },
    goals: {
      list: jest.fn(), create: jest.fn(), updateStatus: jest.fn(), updateHealth: jest.fn(), updateNextStep: jest.fn(), archive: jest.fn(), unarchive: jest.fn(),
    },
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
    operator: {
      create: jest.fn(), revise: jest.fn(), approve: jest.fn(), apply: jest.fn(), dismiss: jest.fn(), get: jest.fn(), list: jest.fn(),
    },
    weeklyReview: { get: jest.fn() },
    healthSnapshot: { getSnapshot: jest.fn() },
    friction: { radar: jest.fn() },
    timeContext: {
      get: jest.fn(),
    },
    timer: {
      workspace: jest.fn(
        async (): Promise<ApiResult<TimerWorkspaceState>> => ({ ok: true, data: WORKSPACE }),
      ),
      start: jest.fn(
        async (): Promise<ApiResult<TimerStartResponse>> => ({ ok: true, data: START_RESPONSE }),
      ),
      stop: jest.fn(
        async (): Promise<ApiResult<TimerStopResponse>> => ({ ok: true, data: STOP_RESPONSE }),
      ),
      ...overrides,
    },
    notifications: {
      list: jest.fn(), unreadCount: jest.fn(), markRead: jest.fn(), markOpened: jest.fn(), markAllRead: jest.fn(), registerDevice: jest.fn(), unregisterDevice: jest.fn(), preferences: jest.fn(), updatePreferences: jest.fn(),
    },
  };
}

describe('mobile timer api wrappers', () => {
  beforeEach(() => {
    setMobileEgaApiClientForTesting(null);
  });

  afterEach(() => {
    setMobileEgaApiClientForTesting(null);
  });

  it('fetchTimerWorkspace reads the canonical workspace through the shared client', async () => {
    const client = makeFakeClient();
    setMobileEgaApiClientForTesting(client);

    await expect(fetchTimerWorkspace()).resolves.toBe(WORKSPACE);
    expect(getMobileEgaApiClient().timer.workspace).toHaveBeenCalledTimes(1);
  });

  it('startTimerForTask starts through /api/timer/start with the bound task id', async () => {
    const client = makeFakeClient();
    setMobileEgaApiClientForTesting(client);

    await expect(startTimerForTask('task-9')).resolves.toBe(START_RESPONSE);
    expect(client.timer.start).toHaveBeenCalledWith('task-9');
  });

  it('stopTimerSession stops the requested session and allows the implicit newest form', async () => {
    const client = makeFakeClient();
    setMobileEgaApiClientForTesting(client);

    await expect(stopTimerSession('session-1')).resolves.toBe(STOP_RESPONSE);
    expect(client.timer.stop).toHaveBeenCalledWith('session-1');

    await stopTimerSession();
    expect(client.timer.stop).toHaveBeenLastCalledWith(undefined);
  });

  it('surfaces server error envelopes as thrown messages without local fallbacks', async () => {
    const conflict: ApiResult<TimerStartResponse> = {
      ok: false,
      error: {
        code: 'VALIDATION',
        message: 'A timer is already running. Stop it before starting a new one.',
        status: 400,
      },
    };
    const client = makeFakeClient({ start: jest.fn(async () => conflict) });
    setMobileEgaApiClientForTesting(client);

    await expect(startTimerForTask('task-9')).rejects.toThrow(
      'A timer is already running. Stop it before starting a new one.',
    );
  });
});
