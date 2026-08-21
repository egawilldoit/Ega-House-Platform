/**
 * Regression test: the CANONICAL mobile transport (@ega/api-client HttpClient
 * reached through getMobileEgaApiClient) must preserve the single-flight
 * refresh contract owned by lib/api/client.ts. Concurrent authenticated 401s
 * through the platform-neutral client must produce exactly ONE shared refresh,
 * each original request must retry at most once, and a second 401 must be
 * terminal. Mirrors the harness of refresh-single-flight.test.ts.
 */
import { configureMobileApiClient } from '@/lib/api/client';
import {
  getMobileEgaApiClient,
  setMobileEgaApiClientForTesting,
} from '@/lib/api/ega';

type SessionBundle = {
  session: { accessToken: string; refreshToken: string; expiresAt: number };
  user: { id: string; email: string };
};

const REFRESH_PATH = '/api/mobile/auth/refresh';
const EXPIRED_ACCESS_TOKEN = 'expired-access-token';

function makeHandlers() {
  let stored: SessionBundle | null = {
    session: { accessToken: EXPIRED_ACCESS_TOKEN, refreshToken: 'refresh-token-1', expiresAt: 0 },
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

function unauthorizedResponse() {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }),
  } as unknown as Response;
}

function okDataResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ tasks: [] }),
  } as unknown as Response;
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

type FetchCallCounts = { refreshCalls: number; dataCalls: number };

function spyOnFetchWithExpiredThenFreshData(): jest.SpyInstance {
  const counts: FetchCallCounts = { refreshCalls: 0, dataCalls: 0 };
  (spyOnFetchWithExpiredThenFreshData as unknown as { counts: FetchCallCounts }).counts = counts;
  return jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes(REFRESH_PATH)) {
      counts.refreshCalls += 1;
      if (counts.refreshCalls > 1) {
        return { ok: false, status: 400 } as unknown as Response;
      }
      return okRefreshResponse();
    }

    counts.dataCalls += 1;
    const headers = ((init as { headers?: Record<string, string> })?.headers ?? {}) as Record<string, string>;
    const token = headers.Authorization?.replace(/^Bearer\s+/, '') ?? '';
    if (token === EXPIRED_ACCESS_TOKEN) {
      return unauthorizedResponse();
    }
    return okDataResponse();
  });
}

function fetchCounts(): FetchCallCounts {
  return (spyOnFetchWithExpiredThenFreshData as unknown as { counts: FetchCallCounts }).counts;
}

describe('canonical @ega/api-client transport refresh single-flight', () => {
  beforeEach(() => {
    setMobileEgaApiClientForTesting(null);
  });

  afterEach(() => {
    setMobileEgaApiClientForTesting(null);
    jest.restoreAllMocks();
  });

  it('fires exactly one refresh for concurrent canonical-client 401s and retries each request once', async () => {
    makeHandlers();
    const fetchMock = spyOnFetchWithExpiredThenFreshData();

    const client = getMobileEgaApiClient();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => client.tasks.list({ limit: index })),
    );

    expect(fetchCounts()).toEqual({ refreshCalls: 1, dataCalls: 16 });
    expect(fetchMock).toHaveBeenCalledTimes(17);
    expect(results.every((result) => result.ok && Array.isArray(result.data.tasks))).toBe(true);
  });

  it('treats a second 401 as terminal without a second refresh or session clear', async () => {
    const handlers = makeHandlers();
    const counts = { refreshCalls: 0, dataCalls: 0 };
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(REFRESH_PATH)) {
        counts.refreshCalls += 1;
        return okRefreshResponse();
      }
      counts.dataCalls += 1;
      return unauthorizedResponse();
    });

    const client = getMobileEgaApiClient();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => client.tasks.list({ limit: index })),
    );

    expect(results.every(
      (result) =>
        !result.ok &&
        result.error.code === 'UNAUTHENTICATED' &&
        result.error.status === 401,
    )).toBe(true);
    expect(counts).toEqual({ refreshCalls: 1, dataCalls: 16 });
    expect(handlers.clearSession).not.toHaveBeenCalled();
    expect(handlers.onUnauthorized).not.toHaveBeenCalled();
  });

  it('clears the session exactly once when concurrent canonical-client requests share a failed refresh', async () => {
    const handlers = makeHandlers();
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(REFRESH_PATH)) {
        return { ok: false, status: 400 } as unknown as Response;
      }
      return unauthorizedResponse();
    });

    const client = getMobileEgaApiClient();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) => client.tasks.list({ limit: index })),
    );

    expect(results.every(
      (result) => !result.ok && result.error.code === 'UNAUTHENTICATED',
    )).toBe(true);
    expect(handlers.clearSession).toHaveBeenCalledTimes(1);
    expect(handlers.onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
