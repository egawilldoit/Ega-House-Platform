import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { getMobileQueryClient } from '@/lib/query/query-client';
import { MobileQueryProvider } from '@/lib/query/provider';
import type { MobileAuthSessionResponse, StoredMobileSession } from '@/types/auth';

type AuthContextValue = ReturnType<typeof useAuth>;
type CapturedClientConfig = {
  getSession: () => Promise<StoredMobileSession | null>;
  setSession: (value: StoredMobileSession) => Promise<void>;
  clearSession: () => Promise<void>;
  onUnauthorized: () => void;
};

const mockLoginMobile = jest.fn<Promise<MobileAuthSessionResponse>, []>();
const mockLogoutMobileSession = jest.fn<Promise<void>, []>();
const mockRefreshMobileSession = jest.fn<Promise<MobileAuthSessionResponse>, [string]>();
let mockStoredSession: StoredMobileSession | null = null;
let mockCapturedClientConfig: CapturedClientConfig | null = null;
let mockCapturedOnUnauthorized: (() => void) | null = null;

jest.mock('@/lib/api/auth', () => ({
  loginMobile: (...args: unknown[]) => mockLoginMobile(...(args as [])),
  logoutMobileSession: (...args: unknown[]) => mockLogoutMobileSession(...(args as [])),
  refreshMobileSession: (...args: unknown[]) => mockRefreshMobileSession(...(args as [string])),
}));

jest.mock('@/lib/api/client', () => ({
  configureMobileApiClient: (config: CapturedClientConfig) => {
    mockCapturedClientConfig = config;
    mockCapturedOnUnauthorized = config.onUnauthorized;
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
        <AuthProvider><Probe /></AuthProvider>
      </MobileQueryProvider>,
    );
  });
  void renderer;

  return () => {
    if (!auth) throw new Error('auth context did not mount');
    return auth;
  };
}

describe('AuthProvider account isolation and session ref synchronization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredSession = null;
    mockCapturedClientConfig = null;
    mockCapturedOnUnauthorized = null;
    getMobileQueryClient().clear();
  });

  it('clears cached User A data on sign out before User B can authenticate', async () => {
    const getAuth = await renderAuth();
    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('a@example.com'));
    await act(async () => getAuth().signIn('a@example.com', 'password-a'));

    getMobileQueryClient().setQueryData(['tasks'], { secret: 'A_ONLY' });
    expect(getMobileQueryClient().getQueryData(['tasks'])).toBeDefined();

    mockLogoutMobileSession.mockResolvedValueOnce(undefined);
    await act(async () => getAuth().signOut());

    expect(getAuth().isAuthenticated).toBe(false);
    expect(getMobileQueryClient().getQueryData(['tasks'])).toBeUndefined();

    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('b@example.com'));
    await act(async () => getAuth().signIn('b@example.com', 'password-b'));
    expect(getAuth().user?.email).toBe('b@example.com');
    expect(getMobileQueryClient().getQueryCache().getAll()).toHaveLength(0);
  });

  it('clears cached data when authentication becomes terminally unauthorized', async () => {
    const getAuth = await renderAuth();
    mockLoginMobile.mockResolvedValueOnce(makeSessionResponse('a@example.com'));
    await act(async () => getAuth().signIn('a@example.com', 'password'));
    getMobileQueryClient().setQueryData(['goals'], { secret: 'A_GOALS' });

    await act(async () => mockCapturedOnUnauthorized?.());

    expect(getAuth().isAuthenticated).toBe(false);
    expect(getMobileQueryClient().getQueryData(['goals'])).toBeUndefined();
  });

  it('makes a freshly rotated token observable synchronously through getSession', async () => {
    await renderAuth();
    const config = mockCapturedClientConfig;
    expect(config).not.toBeNull();

    const next: StoredMobileSession = {
      session: { accessToken: 'fresh', refreshToken: 'refresh', expiresAt: 9999999999 },
      user: { id: 'user-1', email: 'u@example.com' },
    };
    await config!.setSession(next);

    expect((await config!.getSession())?.session.accessToken).toBe('fresh');
  });

  it('makes a restored cold-start session observable through getSession before another write', async () => {
    const restored = makeSessionResponse('cold@example.com');
    mockStoredSession = { session: restored.session, user: restored.user };

    await renderAuth();
    expect((await mockCapturedClientConfig!.getSession())?.session.accessToken).toBe(
      'token-cold@example.com',
    );
  });
});
