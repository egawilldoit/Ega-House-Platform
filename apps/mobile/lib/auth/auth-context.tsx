import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { configureMobileApiClient } from '@/lib/api/client';
import {
  loginMobile,
  logoutMobileSession as logoutApiSession,
  refreshMobileSession as refreshApiSession,
} from '@/lib/api/auth';
import { clearMobileQueryCache } from '@/lib/query/query-client';
import { mobileSessionStorage } from '@/lib/storage/session';
import type { MobileAuthSession, MobileAuthUser, StoredMobileSession } from '@/types/auth';

type AuthContextValue = {
  isReady: boolean;
  isAuthenticated: boolean;
  session: MobileAuthSession | null;
  user: MobileAuthUser | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const REFRESH_BUFFER_SECONDS = 45;

function isSessionNearExpiry(session: MobileAuthSession) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return session.expiresAt <= nowSeconds + REFRESH_BUFFER_SECONDS;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [sessionBundle, setSessionBundle] = useState<StoredMobileSession | null>(null);
  const sessionBundleRef = useRef<StoredMobileSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySessionBundle = useCallback((value: StoredMobileSession | null) => {
    sessionBundleRef.current = value;
    setSessionBundle(value);
  }, []);

  const persistSession = useCallback(
    async (value: StoredMobileSession) => {
      // Update the ref before awaiting storage so authenticated requests issued
      // in the same turn immediately observe a rotated/restored access token.
      applySessionBundle(value);
      await mobileSessionStorage.setSession(value);
    },
    [applySessionBundle],
  );

  const clearSession = useCallback(async () => {
    // Remove in-memory authority first, then durable storage/cache. This keeps
    // a second account from observing queries produced by the previous user.
    applySessionBundle(null);
    await mobileSessionStorage.clearSession();
    clearMobileQueryCache();
  }, [applySessionBundle]);

  const signOut = useCallback(async () => {
    try {
      // Best-effort detach push endpoint before token invalidation
      const { bestEffortUnregisterBeforeLogout } = await import('@/lib/notifications/registration');
      await bestEffortUnregisterBeforeLogout();
    } catch {
      // never block logout on notification cleanup
    }

    try {
      if (sessionBundleRef.current?.session.accessToken) {
        await logoutApiSession();
      }
    } catch {
      // Local authority must still be removed even when remote sign-out fails.
    }

    setError(null);
    await clearSession();
  }, [clearSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      clearMobileQueryCache();

      const response = await loginMobile({
        email: email.trim(),
        password,
      });

      await persistSession({
        session: response.session,
        user: response.user,
      });
    },
    [persistSession],
  );

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    configureMobileApiClient({
      getSession: async () => sessionBundleRef.current,
      setSession: persistSession,
      clearSession,
      onUnauthorized: () => {
        setError('Your session expired. Please sign in again.');
        void clearSession();
      },
    });
  }, [clearSession, persistSession]);

  useEffect(() => {
    let isCancelled = false;

    async function bootstrap() {
      const restored = await mobileSessionStorage.getSession();
      if (isCancelled) {
        return;
      }

      if (!restored) {
        applySessionBundle(null);
        setIsReady(true);
        return;
      }

      if (!isSessionNearExpiry(restored.session)) {
        applySessionBundle(restored);
        setIsReady(true);
        return;
      }

      try {
        const refreshed = await refreshApiSession(restored.session.refreshToken);
        const nextBundle = {
          session: refreshed.session,
          user: refreshed.user ?? restored.user,
        };

        if (!isCancelled) {
          await persistSession(nextBundle);
        }
      } catch {
        if (!isCancelled) {
          await clearSession();
        }
      } finally {
        if (!isCancelled) {
          setIsReady(true);
        }
      }
    }

    void bootstrap().catch(async () => {
      if (!isCancelled) {
        await clearSession();
        setIsReady(true);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [applySessionBundle, clearSession, persistSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady,
      isAuthenticated: Boolean(sessionBundle?.session.accessToken),
      session: sessionBundle?.session ?? null,
      user: sessionBundle?.user ?? null,
      error,
      signIn,
      signOut,
      clearError,
    }),
    [clearError, error, isReady, sessionBundle, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
