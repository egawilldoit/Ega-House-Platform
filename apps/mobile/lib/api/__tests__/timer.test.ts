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
    health: jest.fn(),
    auth: { login: jest.fn(), refresh: jest.fn(), logout: jest.fn() },
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
    projects: {},
    goals: {},
    tasks: {},
    today: {},
  } as unknown as EgaApiClient;
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
