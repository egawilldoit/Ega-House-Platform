/**
 * Unit tests for the mobile timer API wrappers (lib/api/timer.ts).
 * mobileApiFetch is mocked, so the suite proves the wrappers hit the right
 * endpoints with the right method/auth/body — with zero network access.
 */
import type { MobileTimerResponse, MobileTimerStopResponse } from '@ega/contracts';
import { mobileApiFetch } from '@/lib/api/client';
import { getMobileTimerState, startMobileTimer, stopMobileTimer } from '@/lib/api/timer';

jest.mock('@/lib/api/client', () => ({
  mobileApiFetch: jest.fn(),
}));

const mockedMobileApiFetch = mobileApiFetch as jest.Mock;

const TIMER_STATE: MobileTimerResponse = {
  ok: true,
  timer: {
    activeSession: null,
    summary: {
      trackedTodaySeconds: 0,
      trackedTodayLabel: '0m',
      trackedTotalSeconds: 0,
      trackedTotalLabel: '0m',
      sessionsTodayCount: 0,
      longestSessionSeconds: null,
      longestSessionLabel: null,
      longestSessionTaskTitle: null,
    },
  },
};

const STOP_RESPONSE: MobileTimerStopResponse = {
  ok: true,
  stoppedTaskId: 'task-1',
  timer: TIMER_STATE.timer,
};

describe('mobile timer API wrappers', () => {
  beforeEach(() => {
    mockedMobileApiFetch.mockReset();
  });

  it('getMobileTimerState GETs /api/mobile/timer with auth', async () => {
    mockedMobileApiFetch.mockResolvedValueOnce(TIMER_STATE);

    const result = await getMobileTimerState();

    expect(result).toEqual(TIMER_STATE);
    expect(mockedMobileApiFetch).toHaveBeenCalledWith('/api/mobile/timer', {
      method: 'GET',
      auth: true,
    });
  });

  it('startMobileTimer POSTs the taskId to /api/mobile/timer/start', async () => {
    mockedMobileApiFetch.mockResolvedValueOnce(TIMER_STATE);

    const result = await startMobileTimer({ taskId: 'task-1' });

    expect(result).toEqual(TIMER_STATE);
    expect(mockedMobileApiFetch).toHaveBeenCalledWith('/api/mobile/timer/start', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ taskId: 'task-1' }),
    });
  });

  it('stopMobileTimer POSTs the sessionId to /api/mobile/timer/stop', async () => {
    mockedMobileApiFetch.mockResolvedValueOnce(STOP_RESPONSE);

    const result = await stopMobileTimer({ sessionId: 'session-1' });

    expect(result).toEqual(STOP_RESPONSE);
    expect(mockedMobileApiFetch).toHaveBeenCalledWith('/api/mobile/timer/stop', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ sessionId: 'session-1' }),
    });
  });

  it('stopMobileTimer posts an empty body when no sessionId is given', async () => {
    mockedMobileApiFetch.mockResolvedValueOnce(STOP_RESPONSE);

    await stopMobileTimer();

    expect(mockedMobileApiFetch).toHaveBeenCalledWith('/api/mobile/timer/stop', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({}),
    });
  });

  it('propagates errors thrown by mobileApiFetch', async () => {
    mockedMobileApiFetch.mockRejectedValueOnce(new Error('A timer is already running. Stop it first.'));

    await expect(startMobileTimer({ taskId: 'task-1' })).rejects.toThrow(
      'A timer is already running. Stop it first.',
    );
  });
});
