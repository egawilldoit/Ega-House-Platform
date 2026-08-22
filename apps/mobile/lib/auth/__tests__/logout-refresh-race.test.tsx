/**
 * Product-level regression tests for the logout-vs-refresh and
 * account-switch-vs-refresh races, driven through the REAL AuthProvider and
 * the REAL mobile API client. Only the auth transport module and durable
 * storage are mocked; refresh single-flight runs for real over a controlled
 * global fetch.
 */
import { act, create } from 'react-test-renderer';

import { getMobileQueryClient } from '@/lib/query/query-client';
import { MobileQueryProvider } from '@/lib/query/provider';
import type { MobileAuthSessionResponse, StoredMobileSession } from '@/types/auth';

type AuthContextValue = ReturnType<typeof useAuth>;

const mockLoginMobile = jest.fn<Promise<MobileAuthSessionResponse>, []>();
const mockLogoutMobileSession = jest.fn<Promise<void>, []>();
let mockStoredSession: StoredMobileSession | null = null;

jest.mock('@/lib/api/auth', () => ({
  loginMobile: (...args: unknown[]) => mockLoginMobile(...(args as [])),
  logoutMobileSession: (...args: unknown[]) => mockLogoutMobileSession(...(args as [])),
}));

jest.mock('@/lib/storage/session', () => ({
  mobileSessionStorage: {
    getSession: jest.fn(() => Promise.resolve(mockStoredSession)),
    setSession: jest.fn((session: StoredMobileSession) => {
      mockStoredSession = session;
      return Promise.resolve();
    }),
    clearSession: jest.fn(() => {
      mockStoredSession = null;
      return Promise.resolve();
    }),
  },
}));

// NOTE: '@/lib/api/client' is intentionally NOT mocked so the production
// single-flight refresh participates in these races.
import { AuthProvider, useAuth } from '../auth-context';
import { mobileApiFetch } from '@/lib/api/client';

function makeSessionResponse(email: string): MobileAuthSessionResponse {
  return {
    ok: true,
    session: {
      accessToken: `token-${email}`,
      refreshToken: `refresh-${email}`,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
    user: { id: `user-${email}`, email },
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function unauthorizedResponse() {
  return {
    ok: false,
    status: 401,
    text: async () => '{"error":{"message":"expired"}}',
  } as unknown as Response;
}

function createDeferredResponse() {
  let resolve!: (value: Response) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushRefreshStart() {
  await act(async () => {
    await new Promise<void>((resolveTimer) => setTimeout(resolveTimer, 0));
  });
}

async function renderAuth(): Promise<() => AuthContextValue> {
  let auth: AuthContextValue | null = null;
  function Probe() {
    auth = useAuth();
    return null;
  }

  await act(async () => {
    create(
      <MobileQueryProvider>
        <AuthProvider><Probe /></AuthProvider>
      </MobileQueryProvider>,
    );
  });

  return () => {
    if (!auth) throw new Error('auth context did not mount');
    return auth;
  };
}

describe('AuthProvider vs in-flight refresh races', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredSession = null;
    getMobileQueryClient().clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the user signed out when logout completes while a 401-driven refresh is in flight', async () => {
    const getAuth = await renderAuth();

    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('a@example.com'));
    await act(async () => getAuth().signIn('a@example.com', 'password-a'));
    expect(getAuth().isAuthenticated).toBe(true);

    const deferred = createDeferredResponse();
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        return deferred.promise;
      }
      return unauthorizedResponse();
    });

    const backgroundRequest = mobileApiFetch('/api/mobile/tasks').catch(() => 'rejected');
    await flushRefreshStart();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/auth\/refresh$/),
      expect.anything(),
    );

    mockLogoutMobileSession.mockResolvedValueOnce(undefined);
    await act(async () => getAuth().signOut());
    expect(getAuth().isAuthenticated).toBe(false);

    deferred.resolve(jsonResponse(makeSessionResponse('a@example.com')));
    await act(async () => {
      await backgroundRequest;
      await new Promise<void>((resolveTimer) => setTimeout(resolveTimer, 0));
    });

    expect(getAuth().isAuthenticated).toBe(false);
    expect(getAuth().session).toBeNull();
    expect(getAuth().user).toBeNull();
    expect(mockStoredSession).toBeNull();
  });

  it("does not let User A's resolved refresh pollute User B's freshly installed session", async () => {
    const getAuth = await renderAuth();

    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('a@example.com'));
    await act(async () => getAuth().signIn('a@example.com', 'password-a'));

    const deferred = createDeferredResponse();
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/auth/refresh')) {
        return deferred.promise;
      }
      return unauthorizedResponse();
    });

    const backgroundRequest = mobileApiFetch('/api/mobile/tasks').catch(() => 'rejected');
    await flushRefreshStart();

    getMobileQueryClient().setQueryData(['tasks'], { secret: 'A_ONLY' });
    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('b@example.com'));
    await act(async () => getAuth().signIn('b@example.com', 'password-b'));
    expect(getAuth().user?.email).toBe('b@example.com');
    expect(getMobileQueryClient().getQueryCache().getAll()).toHaveLength(0);

    deferred.resolve(jsonResponse(makeSessionResponse('a@example.com')));
    await act(async () => {
      await backgroundRequest;
      await new Promise<void>((resolveTimer) => setTimeout(resolveTimer, 0));
    });

    expect(getAuth().user?.email).toBe('b@example.com');
    expect(getAuth().session?.accessToken).toBe('token-b@example.com');
    expect(getAuth().session?.refreshToken).toBe('refresh-b@example.com');
    expect(mockStoredSession?.user.email).toBe('b@example.com');
    expect(getAuth().isAuthenticated).toBe(true);
  });
});
