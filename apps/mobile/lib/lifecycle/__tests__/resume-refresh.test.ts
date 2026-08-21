import {
  createResumeRefresh,
  RESUME_REFRESH_COOLDOWN_MS,
} from '../resume-refresh';

const NOW_MS = 1_800_000_000_000;

function secondsFromNow(offsetSeconds: number) {
  return Math.floor(NOW_MS / 1000) + offsetSeconds;
}

type DepsOverrides = {
  refreshToken?: string;
  expiresAt?: number;
};

function makeDeps(overrides: DepsOverrides = {}) {
  const refresh = jest.fn(async () => true);
  const deps = {
    getSession: jest.fn(async () => ({
      refreshToken: overrides.refreshToken ?? 'refresh-token',
      expiresAt: overrides.expiresAt ?? secondsFromNow(-10),
    })),
    refresh,
    now: () => NOW_MS,
  };
  return { deps, refresh };
}

describe('createResumeRefresh', () => {
  it('refreshes once when the session is within the buffer of expiry', async () => {
    const { deps, refresh } = makeDeps({ expiresAt: secondsFromNow(10) });
    const resumeRefresh = createResumeRefresh(deps);

    await expect(resumeRefresh()).resolves.toBe(true);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the session is still fresh', async () => {
    const { deps, refresh } = makeDeps({ expiresAt: secondsFromNow(3600) });
    const resumeRefresh = createResumeRefresh(deps);

    await expect(resumeRefresh()).resolves.toBe(false);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh when there is no session', async () => {
    const { deps, refresh } = makeDeps();
    deps.getSession.mockResolvedValue(null as never);
    const resumeRefresh = createResumeRefresh(deps);

    await expect(resumeRefresh()).resolves.toBe(false);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh when the session has no refresh token', async () => {
    const { deps, refresh } = makeDeps({ refreshToken: '' });
    const resumeRefresh = createResumeRefresh(deps);

    await expect(resumeRefresh()).resolves.toBe(false);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('bounds repeated foreground events to a single refresh within the cooldown', async () => {
    const { deps, refresh } = makeDeps({ expiresAt: secondsFromNow(10) });
    const resumeRefresh = createResumeRefresh(deps);

    await Promise.all([
      resumeRefresh(),
      resumeRefresh(),
      resumeRefresh(),
      resumeRefresh(),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('allows a new attempt only after the cooldown elapses', async () => {
    let currentTime = NOW_MS;
    const { deps, refresh } = makeDeps({ expiresAt: secondsFromNow(10) });
    const resumeRefresh = createResumeRefresh({ ...deps, now: () => currentTime });

    await resumeRefresh();
    currentTime += RESUME_REFRESH_COOLDOWN_MS - 1;
    await resumeRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);

    currentTime += 1;
    await resumeRefresh();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('counts a failed refresh attempt against the cooldown', async () => {
    const refresh = jest.fn(async () => {
      throw new Error('network down');
    });
    const deps = {
      getSession: jest.fn(async () => ({
        refreshToken: 'refresh-token',
        expiresAt: secondsFromNow(10),
      })),
      refresh,
      now: () => NOW_MS,
    };
    const resumeRefresh = createResumeRefresh(deps);

    await expect(resumeRefresh()).resolves.toBe(false);
    await expect(resumeRefresh()).resolves.toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
