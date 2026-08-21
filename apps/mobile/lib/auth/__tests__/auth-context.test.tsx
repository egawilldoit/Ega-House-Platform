import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { getMobileQueryClient } from '@/lib/query/query-client';
import { MobileQueryProvider } from '@/lib/query/provider';
import type {
  MobileAuthSessionResponse,
  StoredMobileSession,
} from '@/types/auth';

type AuthContextValue = ReturnType<typeof useAuth>;

const mockLoginMobile = jest.fn<Promise<MobileAuthSessionResponse>, []>();
const mockLogoutMobileSession = jest.fn<Promise<void>, []>();
const mockRefreshMobileSession = jest.fn<
  Promise<MobileAuthSessionResponse>,
  [string]
>();

let mockStoredSession: StoredMobileSession | null = null;
let mockCapturedOnUnauthorized: (() => void) | null = null;

jest.mock('@/lib/api/auth', () => ({
  loginMobile: (...args: unknown[]) => mockLoginMobile(...(args as [])),
  logoutMobileSession: (...args: unknown[]) =>
    mockLogoutMobileSession(...(args as [])),
  refreshMobileSession: (...args: unknown[]) =>
    mockRefreshMobileSession(...(args as [string])),
}));

jest.mock('@/lib/api/client', () => ({
  configureMobileApiClient: (config: { onUnauthorized?: () => void }) => {
    mockCapturedOnUnauthorized = config.onUnauthorized ?? null;
  },
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

import { AuthProvider, useAuth } from '../auth-context';

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

async function renderAuth(): Promise<() => AuthContextValue> {
  let auth: AuthContextValue | null = null;
  let renderer: ReactTestRenderer | null = null;

  function Probe() {
    auth = useAuth();
    return null;
  }

  await act(async () => {
    renderer = create(
      <MobileQueryProvider>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </MobileQueryProvider>,
    );
  });

  if (!auth) {
    throw new Error('auth context did not mount');
  }

  return () => {
    if (!auth) {
      throw new Error('auth context unmounted');
    }
    return auth;
  };
}

describe('auth-context query cache isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredSession = null;
    mockCapturedOnUnauthorized = null;
    getMobileQueryClient().clear();
  });

  it('clears cached query data on signOut so user B cannot read user A data', async () => {
    const getAuth = await renderAuth();

    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('a@example.com'));
    await act(async () => {
      await getAuth().signIn('a@example.com', 'password-a');
    });

    getMobileQueryClient().setQueryData(['tasks'], {
      tasks: [{ id: 't-1', title: 'A_SECRET' }],
    });
    expect(getMobileQueryClient().getQueryData(['tasks'])).toMatchObject({
      tasks: [{ title: 'A_SECRET' }],
    });

    mockLogoutMobileSession.mockResolvedValueOnce(undefined);
    await act(async () => {
      await getAuth().signOut();
    });

    expect(getAuth().isAuthenticated).toBe(false);
    expect(getMobileQueryClient().getQueryData(['tasks'])).toBeUndefined();

    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('b@example.com'));
    await act(async () => {
      await getAuth().signIn('b@example.com', 'password-b');
    });

    expect(getAuth().user?.email).toBe('b@example.com');
    expect(getAuth().isAuthenticated).toBe(true);
    expect(getMobileQueryClient().getQueryData(['tasks'])).toBeUndefined();
  });

  it('keeps cache empty when the signOut API call fails', async () => {
    const getAuth = await renderAuth();

    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('a@example.com'));
    await act(async () => {
      await getAuth().signIn('a@example.com', 'password-a');
    });

    getMobileQueryClient().setQueryData(['projects'], { secret: 'A_DATA' });

    mockLogoutMobileSession.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      await getAuth().signOut();
    });

    expect(getAuth().isAuthenticated).toBe(false);
    expect(getMobileQueryClient().getQueryData(['projects'])).toBeUndefined();
    expect(getMobileQueryClient().getQueryCache().getAll()).toHaveLength(0);
  });

  it('clears cache on unauthorized and failed login as B never exposes A data', async () => {
    const getAuth = await renderAuth();

    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('a@example.com'));
    await act(async () => {
      await getAuth().signIn('a@example.com', 'password-a');
    });

    getMobileQueryClient().setQueryData(['goals'], { secret: 'A_GOALS' });
    expect(mockCapturedOnUnauthorized).not.toBeNull();

    await act(async () => {
      mockCapturedOnUnauthorized?.();
    });

    expect(getAuth().isAuthenticated).toBe(false);
    expect(getMobileQueryClient().getQueryData(['goals'])).toBeUndefined();

    mockLoginMobile.mockRejectedValueOnce(new Error('invalid credentials'));
    await act(async () => {
      await expect(
        getAuth().signIn('b@example.com', 'wrong-password'),
      ).rejects.toThrow('invalid credentials');
    });

    expect(getAuth().isAuthenticated).toBe(false);
    expect(getMobileQueryClient().getQueryData(['goals'])).toBeUndefined();
    expect(getMobileQueryClient().getQueryCache().getAll()).toHaveLength(0);
  });

  it('clears cache when bootstrap refresh fails for a restored session', async () => {
    const expiring = makeSessionResponse('a@example.com');
    expiring.session.expiresAt = Math.floor(Date.now() / 1000) - 10;
    mockStoredSession = {
      session: expiring.session,
      user: expiring.user,
    };
    mockRefreshMobileSession.mockRejectedValueOnce(new Error('refresh failed'));

    getMobileQueryClient().setQueryData(['notes'], { secret: 'A_NOTES' });
    expect(getMobileQueryClient().getQueryData(['notes'])).toMatchObject({
      secret: 'A_NOTES',
    });

    await renderAuth();
    await act(async () => {});

    expect(mockStoredSession).toBeNull();
    expect(getMobileQueryClient().getQueryData(['notes'])).toBeUndefined();
  });
});
