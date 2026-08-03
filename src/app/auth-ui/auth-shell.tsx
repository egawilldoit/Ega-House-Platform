import type { ReactNode } from "react";

import "./auth.css";
import { AuthMotion } from "./auth-motion";

export type AuthTheme = "black-signal" | "signal-cream";

type AuthShellProps = {
  theme: AuthTheme;
  children: ReactNode;
};

export function AuthShell({ theme, children }: AuthShellProps) {
  return (
    <AuthMotion>
      <main className="auth-root" data-auth-theme={theme}>
        <div className="auth-noise" aria-hidden="true" />
        {children}
      </main>
    </AuthMotion>
  );
}
