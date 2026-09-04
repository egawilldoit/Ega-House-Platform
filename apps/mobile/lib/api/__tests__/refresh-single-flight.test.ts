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

function makeBundle(
  id: string,
): SessionBundle & { user: { id: string; email: string } } {
  return {
    session: {
      accessToken: `access-${id}`,
      refreshToken: `refresh-${id}`,
      expiresAt: 9999999999,
    },
    user: { id, email: `${id}@example.com` },
  };
}

type DeferredResponse = {
  promise: Promise<Response>;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
};

function createDeferredResponse(): DeferredResponse {
  let resolve!: (value: Response) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Drain every pending microtask so an in-flight performRefresh has observably
 * captured its starting session before the test mutates auth state.
 */
async function flushRefreshStart() {
  await new Promise<void>((resolveTimer) => setTimeout(resolveTimer, 0));
}

describe('mobile refresh races against logout and account switch', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not resurrect a cleared session when logout completes before an older refresh resolves', async () => {
    const handlers = makeHandlers();
    const deferred = createDeferredResponse();
    jest.spyOn(global, 'fetch').mockReturnValueOnce(deferred.promise);

    const refreshPromise = refreshMobileSessionIfConfigured();
    await flushRefreshStart();

    await handlers.clearSession();
    deferred.resolve(okRefreshResponse());

    expect(await refreshPromise).toBe(false);
    expect(handlers.setSession).not.toHaveBeenCalled();
    expect(await handlers.getSession()).toBeNull();
  });

  it("does not install an older user's refreshed session after a different user signs in", async () => {
    const handlers = makeHandlers();
    const deferred = createDeferredResponse();
    jest.spyOn(global, 'fetch').mockReturnValueOnce(deferred.promise);

    const refreshPromise = refreshMobileSessionIfConfigured();
    await flushRefreshStart();

    const userB = makeBundle('user-b');
    await handlers.setSession(userB);
    deferred.resolve(okRefreshResponse());

    expect(await refreshPromise).toBe(false);
    expect(handlers.setSession).toHaveBeenCalledTimes(1);
    expect(await handlers.getSession()).toEqual(userB);
  });

  it('skips terminal cleanup when the session changed mid-flight so a stale failure cannot destroy the new session', async () => {
    const handlers = makeHandlers();
    const deferred = createDeferredResponse();
    jest.spyOn(global, 'fetch').mockReturnValueOnce(deferred.promise);

    const refreshPromise = refreshMobileSessionIfConfigured();
    await flushRefreshStart();

    const userB = makeBundle('user-b');
    await handlers.setSession(userB);
    deferred.resolve({ ok: false, status: 401 } as unknown as Response);

    expect(await refreshPromise).toBe(false);
    expect(handlers.clearSession).not.toHaveBeenCalled();
    expect(handlers.onUnauthorized).not.toHaveBeenCalled();
    expect(await handlers.getSession()).toEqual(userB);
  });

  it('keeps logged-out state when an in-flight refresh fails after logout without crashing callers', async () => {
    const handlers = makeHandlers();
    const deferred = createDeferredResponse();
    jest.spyOn(global, 'fetch').mockReturnValueOnce(deferred.promise);

    const refreshPromise = refreshMobileSessionIfConfigured();
    await flushRefreshStart();

    await handlers.clearSession();
    deferred.reject(new Error('network down'));

    await expect(refreshPromise).resolves.toBe(false);
    expect(handlers.onUnauthorized).not.toHaveBeenCalled();
    expect(await handlers.getSession()).toBeNull();
  });

  it('installs nothing when eight concurrent refresh callers race a mid-flight logout', async () => {
    const handlers = makeHandlers();
    const deferred = createDeferredResponse();
    jest.spyOn(global, 'fetch').mockReturnValueOnce(deferred.promise);

    const refreshPromises = Array.from({ length: 8 }, () =>
      refreshMobileSessionIfConfigured(),
    );
    await flushRefreshStart();

    await handlers.clearSession();
    deferred.resolve(okRefreshResponse());

    const results = await Promise.all(refreshPromises);
    expect(results.every((ok) => ok === false)).toBe(true);
    expect(handlers.setSession).not.toHaveBeenCalled();
    expect(await handlers.getSession()).toBeNull();
  });
});

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

  it('rejects a malformed successful refresh without installing an invalid session', async () => {
    const handlers = makeHandlers();
    const existingSession = await handlers.getSession();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as unknown as Response);

    await expect(refreshMobileSessionIfConfigured()).resolves.toBe(false);
    expect(handlers.setSession).not.toHaveBeenCalled();
    expect(handlers.clearSession).not.toHaveBeenCalled();
    expect(handlers.onUnauthorized).not.toHaveBeenCalled();
    expect(await handlers.getSession()).toEqual(existingSession);
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
        mobileApiFetch<{ ok: boolean }>(`/api/tasks?i=${index}`),
      ),
    );

    expect(refreshCalls).toBe(1);
    expect(dataCalls).toBe(16);
    expect(fetchMock).toHaveBeenCalledTimes(17);
    expect(results.every((result) => result.ok === true)).toBe(true);
  });

  it('surfaces a terminal second 401 after the single retry without looping or clearing', async () => {
    const handlers = makeHandlers();

    let refreshCalls = 0;
    let dataCalls = 0;
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        return okRefreshResponse();
      }

      dataCalls += 1;
      return {
        ok: false,
        status: 401,
        text: async () => '{"error":{"message":"expired"}}',
      } as unknown as Response;
    });

    await expect(mobileApiFetch<{ ok: boolean }>('/api/tasks')).rejects.toThrow('expired');

    expect(dataCalls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(handlers.clearSession).not.toHaveBeenCalled();
    expect(handlers.onUnauthorized).not.toHaveBeenCalled();
  });
});
