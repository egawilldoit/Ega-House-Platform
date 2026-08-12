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

  it('fires exactly one refresh for concurrent mobileApiFetch 401 retries and shares the result', async () => {
    makeHandlers();

    let refreshCalls = 0;
    let dataCalls = 0;
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/mobile/auth/refresh')) {
        refreshCalls += 1;
        if (refreshCalls > 1) {
          return { ok: false, status: 400 } as unknown as Response;
        }
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
        json: async () => ({ ok: true }),
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

  it('clears the session once when concurrent mobileApiFetch retries share a failed refresh', async () => {
    const handlers = makeHandlers();
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/mobile/auth/refresh')) {
        return { ok: false, status: 400 } as unknown as Response;
      }
      return { ok: false, status: 401 } as unknown as Response;
    });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        mobileApiFetch<{ ok: boolean }>(`/api/mobile/tasks?i=${index}`),
      ),
    );

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(handlers.clearSession).toHaveBeenCalledTimes(1);
    expect(handlers.onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
