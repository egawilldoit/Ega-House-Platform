import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { configureMobileApiClient } from '@/lib/api/client';
import {
  loginMobile,
  logoutMobileSession as logoutApiSession,
  refreshMobileSession as refreshApiSession,
} from '@/lib/api/auth';
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
  const [error, setError] = useState<string | null>(null);

  const persistSession = useCallback(async (value: StoredMobileSession) => {
    setSessionBundle(value);
    await mobileSessionStorage.setSession(value);
  }, []);

  const clearSession = useCallback(async () => {
    setSessionBundle(null);
    await mobileSessionStorage.clearSession();
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (sessionBundle?.session.accessToken) {
        await logoutApiSession();
      }
    } catch {
      // Local session is still cleared below.
    }

    setError(null);
    await clearSession();
  }, [clearSession, sessionBundle?.session.accessToken]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
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
      getSession: async () => sessionBundle,
      setSession: async (value) => {
        setSessionBundle(value);
        await mobileSessionStorage.setSession(value);
      },
      clearSession: async () => {
        await clearSession();
      },
      onUnauthorized: () => {
        setError('Your session expired. Please sign in again.');
        setSessionBundle(null);
      },
    });
  }, [clearSession, sessionBundle]);

  useEffect(() => {
    let isCancelled = false;

    async function bootstrap() {
      const restored = await mobileSessionStorage.getSession();
      if (isCancelled) {
        return;
      }

      if (!restored) {
        setSessionBundle(null);
        setIsReady(true);
        return;
      }

      if (!isSessionNearExpiry(restored.session)) {
        setSessionBundle(restored);
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
  }, [clearSession, persistSession]);

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
