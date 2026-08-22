/**
 * Regression tests for the mobile refresh boundary.
 *
 * The canonical refresh transport is the Hono `/api/auth/refresh` route.
 * Concurrent authenticated 401s must still share exactly one rotating-token
 * refresh and each original request may retry at most once.
 */
import {
  configureMobileApiClient,
  mobileApiFetch,
  refreshMobileSessionIfConfigured,
} from '@/lib/api/client';

type SessionBundle = {
  session: { accessToken: string; refreshToken: string; expiresAt: number };
  user: { id: string; email: string };
};

function makeHandlers() {
  let stored: SessionBundle | null = {
    session: { accessToken: 'expired-access-token', refreshToken: 'refresh-token-1', expiresAt: 0 },
    user: { id: 'user-1', email: 'user@example.com' },
  };
  const setSession = jest.fn(async (value: SessionBundle) => {
    stored = value;
  });
  const clearSession = jest.fn(async () => {
    stored = null;
  });
  const onUnauthorized = jest.fn(() => {});
  const handlers = {
    getSession: jest.fn(async (): Promise<SessionBundle | null> => stored),
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
      ok: true,
      session: {
        accessToken: 'fresh-access-token',
        refreshToken: 'refresh-token-2',
        expiresAt: 9999999999,
      },
      user: { id: 'user-1', email: 'user@example.com' },
    }),
  } as unknown as Response;
}

describe('mobile session refresh single-flight', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the canonical Hono refresh endpoint and fires exactly one request for concurrent callers', async () => {
    makeHandlers();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(okRefreshResponse());

    const results = await Promise.all(
      Array.from({ length: 8 }, () => refreshMobileSessionIfConfigured()),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/auth\/refresh$/);
    expect(results.every((ok) => ok === true)).toBe(true);
  });

  it('clears the session exactly once for a terminal refresh rejection', async () => {
    const handlers = makeHandlers();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
    } as unknown as Response);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => refreshMobileSessionIfConfigured()),
    );

    expect(results.every((ok) => ok === false)).toBe(true);
    expect(handlers.clearSession).toHaveBeenCalledTimes(1);
    expect(handlers.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not clear local session state for transient server refresh failures', async () => {
    const handlers = makeHandlers();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);

    expect(await refreshMobileSessionIfConfigured()).toBe(false);
    expect(handlers.clearSession).not.toHaveBeenCalled();
    expect(handlers.onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not clear local session state when the refresh network request fails', async () => {
    const handlers = makeHandlers();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    expect(await refreshMobileSessionIfConfigured()).toBe(false);
    expect(handlers.clearSession).not.toHaveBeenCalled();
    expect(handlers.onUnauthorized).not.toHaveBeenCalled();
  });

  it('retries concurrent authenticated requests once after the shared refresh', async () => {
    makeHandlers();

    let refreshCalls = 0;
    let dataCalls = 0;
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        return okRefreshResponse();
      }

      dataCalls += 1;
      const headers = new Headers((init as RequestInit)?.headers);
      const token = headers.get('Authorization')?.replace(/^Bearer\s+/, '') ?? '';
      if (token === 'expired-access-token') {
        return {
          ok: false,
          status: 401,
          text: async () => '{"error":{"message":"expired"}}',
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => '{"ok":true}',
      } as unknown as Response;
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        mobileApiFetch<{ ok: boolean }>(`/api/mobile/tasks?i=${index}`),
      ),
    );

    expect(refreshCalls).toBe(1);
    expect(dataCalls).toBe(16);
    expect(fetchMock).toHaveBeenCalledTimes(17);
    expect(results.every((result) => result.ok === true)).toBe(true);
  });
});
