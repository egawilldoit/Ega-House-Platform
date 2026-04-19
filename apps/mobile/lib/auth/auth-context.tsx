import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type AuthContextValue = {
  isAuthenticated: boolean;
  // Temporary shell only. Next step: accept credentials and call mobile auth API.
  signIn: () => void;
  // Temporary shell only. Next step: call logout endpoint and clear persisted session.
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Temporary in-memory state for current bootstrap flow.
  // TODO(EGA-Next): initialize from mobileSessionStorage and keep it in sync.
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const value = useMemo(
    () => ({
      isAuthenticated,
      signIn: () => setIsAuthenticated(true),
      signOut: () => setIsAuthenticated(false),
    }),
    [isAuthenticated],
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
