import { refreshMobileSessionIfConfigured } from '@/lib/api/client';
import type { MobileAuthSession } from '@/types/auth';

export const RESUME_REFRESH_BUFFER_SECONDS = 45;
export const RESUME_REFRESH_COOLDOWN_MS = 60_000;

export type ResumeRefreshSessionInput = Pick<MobileAuthSession, 'refreshToken' | 'expiresAt'>;

type ResumeRefreshDeps = {
  getSession: () => Promise<ResumeRefreshSessionInput | null>;
  refresh?: typeof refreshMobileSessionIfConfigured;
  bufferSeconds?: number;
  cooldownMs?: number;
  now?: () => number;
};

export function isSessionNearExpiry(expiresAt: number, nowSeconds: number, bufferSeconds: number) {
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

        if (
          !isSessionNearExpiry(
            session.expiresAt,
            Math.floor(attemptedAt / 1000),
            bufferSeconds,
          )
        ) {
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
