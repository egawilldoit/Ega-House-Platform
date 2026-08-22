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
import { AppState } from 'react-native';

import { configureMobileApiClient } from '@/lib/api/client';
import {
  loginMobile,
  logoutMobileSession as logoutApiSession,
  refreshMobileSession as refreshApiSession,
} from '@/lib/api/auth';
import { createResumeRefresh } from '@/lib/lifecycle/resume-refresh';
import { clearMobileQueryCache } from '@/lib/query/query-client';
import { mobileTimerStorage } from '@/lib/storage/timer';
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
      applySessionBundle(value);
      await mobileSessionStorage.setSession(value);
    },
    [applySessionBundle],
  );

  const clearSession = useCallback(async () => {
    applySessionBundle(null);
    await mobileSessionStorage.clearSession();
    clearMobileQueryCache();
    await mobileTimerStorage.clear();
  }, [applySessionBundle]);

  const signOut = useCallback(async () => {
    try {
      if (sessionBundleRef.current?.session.accessToken) {
        await logoutApiSession();
      }
    } catch {
      // Local session is still cleared below.
    }

    setError(null);
    await clearSession();
  }, [clearSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      clearMobileQueryCache();
      await mobileTimerStorage.clear();

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
      setSession: async (value) => {
        await persistSession(value);
      },
      clearSession: async () => {
        await clearSession();
      },
      onUnauthorized: () => {
        setError('Your session expired. Please sign in again.');
        clearSession().catch(() => {});
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

    bootstrap().catch(async () => {
      if (!isCancelled) {
        await clearSession();
        setIsReady(true);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [applySessionBundle, clearSession, persistSession]);

  useEffect(() => {
    const resumeRefresh = createResumeRefresh({
      getSession: async () => sessionBundleRef.current?.session ?? null,
    });

    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void resumeRefresh();
      }
    });

    return () => subscription.remove();
  }, []);

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
