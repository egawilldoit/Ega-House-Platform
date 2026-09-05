import { refreshMobileSessionIfConfigured } from '@/lib/api/client';

/**
 * Proactive foreground session refresh.
 *
 * Bootstrap (`auth-context`) only refreshes once at launch and the API client
 * only refreshes reactively after an authenticated 401. An app that stays
 * backgrounded across token expiry would otherwise pay a 401 churn on every
 * foreground refetch. This helper runs on `AppState → active` and invokes
 * the EXISTING single-flight refresh authority when the live session is near
 * expiry — it owns no session state, duplicates no refresh policy, and never
 * clears or rewrites the session itself:
 *
 * - cooldown bounds repeated foreground events;
 * - concurrent events share one in-flight attempt;
 * - transient/malformed/terminal refresh outcomes keep existing semantics
 *   inside `refreshMobileSessionIfConfigured` (logout wins, account switch
 *   wins via commit-time identity check, stale failure never destroys a
 *   newer session).
 */
export const RESUME_REFRESH_BUFFER_SECONDS = 45;
export const RESUME_REFRESH_COOLDOWN_MS = 60_000;

export type ResumeRefreshSessionInput = {
  refreshToken: string;
  expiresAt: number;
};

type ResumeRefreshDeps = {
  getSession: () => Promise<ResumeRefreshSessionInput | null>;
  refresh?: () => Promise<boolean>;
  bufferSeconds?: number;
  cooldownMs?: number;
  now?: () => number;
};

export function isResumeRefreshDue(
  expiresAt: number,
  nowSeconds: number,
  bufferSeconds: number,
): boolean {
  return expiresAt <= nowSeconds + bufferSeconds;
}

export function createResumeRefresh(deps: ResumeRefreshDeps) {
  const {
    getSession,
    refresh = refreshMobileSessionIfConfigured,
    bufferSeconds = RESUME_REFRESH_BUFFER_SECONDS,
    cooldownMs = RESUME_REFRESH_COOLDOWN_MS,
    now = () => Date.now(),
  } = deps;

  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let attemptInFlight: Promise<boolean> | null = null;

  return function resumeRefresh(): Promise<boolean> {
    const attemptedAt = now();
    if (attemptedAt - lastAttemptAt < cooldownMs) {
      return Promise.resolve(false);
    }

    if (attemptInFlight) {
      return attemptInFlight;
    }

    attemptInFlight = (async () => {
      try {
        const session = await getSession();
        if (!session?.refreshToken) {
          return false;
        }

        if (!isResumeRefreshDue(session.expiresAt, Math.floor(attemptedAt / 1000), bufferSeconds)) {
          return false;
        }

        lastAttemptAt = attemptedAt;
        return await refresh();
      } catch {
        return false;
      } finally {
        attemptInFlight = null;
      }
    })();

    return attemptInFlight;
  };
}
