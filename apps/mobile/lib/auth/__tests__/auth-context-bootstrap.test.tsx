/**
 * Regression test: mounting AuthProvider with a stored session that is already
 * near expiry must perform exactly ONE proactive refresh during bootstrap and
 * persist the refreshed bundle back to SecureStore under the canonical key.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

import { AuthProvider, useAuth } from '@/lib/auth/auth-context';
import { mobileSessionStorage } from '@/lib/storage/session';

const SESSION_KEY = 'ega.mobile.session';
const REFRESH_PATH = '/api/mobile/auth/refresh';

type CapturedAuth = {
  isReady: boolean;
  isAuthenticated: boolean;
  hasAccessToken: boolean;
  error: string | null;
};

let captured: CapturedAuth;

function Probe() {
  const auth = useAuth();
  captured = {
    isReady: auth.isReady,
    isAuthenticated: auth.isAuthenticated,
    hasAccessToken: Boolean(auth.session?.accessToken),
    error: auth.error,
  };
  return null;
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error('auth bootstrap condition not met within timeout');
}

async function renderProvider(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  });
  return renderer;
}

describe('AuthProvider bootstrap restore', () => {
  let fetchMock: jest.SpyInstance;
  let refreshCalls: number;

  beforeEach(() => {
    mockStore.clear();
    refreshCalls = 0;
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(REFRESH_PATH)) {
        refreshCalls += 1;
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              session: {
                accessToken: 'bootstrap-refreshed-access',
                refreshToken: 'bootstrap-refreshed-refresh',
                expiresAt: Math.floor(Date.now() / 1000) + 3600,
              },
              user: { id: 'user-1', email: 'user@example.com' },
            }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('performs exactly one proactive refresh for a near-expiry stored session and persists the new bundle', async () => {
    const staleExpiresAt = Math.floor(Date.now() / 1000) - 10;
    const staleBundle = {
      session: {
        accessToken: 'stored-expiring-access',
        refreshToken: 'stored-expiring-refresh',
        expiresAt: staleExpiresAt,
      },
      user: { id: 'user-1', email: 'user@example.com' },
    };
    mockStore.set(
      SESSION_KEY,
      JSON.stringify(staleBundle),
    );

    const renderer = await renderProvider();
    await waitFor(() => captured?.isReady === true);

    expect(refreshCalls).toBe(1);
    expect(captured.isAuthenticated).toBe(true);
    expect(captured.hasAccessToken).toBe(true);
    expect(captured.error).toBeNull();

    const persistedRaw = mockStore.get(SESSION_KEY);
    expect(persistedRaw).toBeDefined();
    const persisted = JSON.parse(persistedRaw as string) as typeof staleBundle;
    expect(persisted.session.expiresAt).toBeGreaterThan(staleExpiresAt);
    expect(persisted.session.refreshToken).not.toBe(staleBundle.session.refreshToken);

    await act(async () => {
      renderer.unmount();
    });
  });

  it('does not refresh when the stored session is still fresh', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    mockStore.set(
      SESSION_KEY,
      JSON.stringify({
        session: {
          accessToken: 'stored-fresh-access',
          refreshToken: 'stored-fresh-refresh',
          expiresAt: nowSeconds + 3600,
        },
        user: { id: 'user-1', email: 'user@example.com' },
      }),
    );

    const renderer = await renderProvider();
    await waitFor(() => captured?.isReady === true);

    expect(refreshCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.isAuthenticated).toBe(true);
    expect(captured.error).toBeNull();

    const restored = await mobileSessionStorage.getSession();
    expect(restored?.session.expiresAt).toBe(nowSeconds + 3600);

    await act(async () => {
      renderer.unmount();
    });
  });
});
