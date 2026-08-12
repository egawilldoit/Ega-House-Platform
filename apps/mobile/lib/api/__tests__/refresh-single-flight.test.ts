/**
 * Regression test: concurrent authenticated 401s must trigger exactly ONE
 * refresh call (single-flight). Without this, N concurrent 401s cause N
 * parallel refresh POSTs against a rotating refresh token; providers that
 * reject token reuse then clear the session mid-burst.
 *
 * Reproduced at runtime (2026-08-12): 8 concurrent expired-token requests
 * produced 7 refresh calls; on one run the rotation race cleared the session
 * 7 times and only 1 of 8 requests succeeded.
 */
import { configureMobileApiClient, refreshMobileSessionIfConfigured } from '@/lib/api/client';

type SessionBundle = {
  session: { accessToken: string; refreshToken: string; expiresAt: number };
  user: { id: string; email: string };
};

function makeHandlers() {
  const setSession = jest.fn(async () => {});
  const clearSession = jest.fn(async () => {});
  const onUnauthorized = jest.fn(() => {});
  const handlers = {
    getSession: jest.fn(async (): Promise<SessionBundle | null> => ({
      session: { accessToken: 'expired-access-token', refreshToken: 'refresh-token-1', expiresAt: 0 },
      user: { id: 'user-1', email: 'user@example.com' },
    })),
    setSession,
    clearSession,
    onUnauthorized,
  };
  configureMobileApiClient(handlers);
  return handlers;
}

function okRefreshResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      session: { accessToken: 'fresh-access-token', refreshToken: 'refresh-token-2', expiresAt: 9999999999 },
      user: { id: 'user-1', email: 'user@example.com' },
    }),
  } as unknown as Response;
}

describe('mobile session refresh single-flight', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fires exactly one refresh request for many concurrent 401-triggered calls', async () => {
    makeHandlers();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(okRefreshResponse());

    const results = await Promise.all(
      Array.from({ length: 8 }, () => refreshMobileSessionIfConfigured()),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.every((ok) => ok === true)).toBe(true);
  });

  it('clears the session exactly once when the single refresh fails', async () => {
    const handlers = makeHandlers();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
    } as unknown as Response);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => refreshMobileSessionIfConfigured()),
    );

    expect(results.every((ok) => ok === false)).toBe(true);
    expect(handlers.clearSession).toHaveBeenCalledTimes(1);
    expect(handlers.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('keeps returning the shared in-flight result to late callers', async () => {
    makeHandlers();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(okRefreshResponse());

    const first = refreshMobileSessionIfConfigured();
    const late = refreshMobileSessionIfConfigured();

    expect(await first).toBe(true);
    expect(await late).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
