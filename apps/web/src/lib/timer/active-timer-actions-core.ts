import type {
  ActiveTimerReadResult,
  ActiveTimerSessionLike,
  ActiveTimerStopOutcomeResult,
} from "./active-timer-contract";
import {
  ACTIVE_TIMER_INVALID_SESSION_MESSAGE,
  ACTIVE_TIMER_UNAUTHENTICATED_MESSAGE,
  ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
  toActiveTimerSnapshot,
} from "./active-timer-contract";

const MAX_SESSION_ID_LENGTH = 200;

type TimerStopServiceResult = {
  errorMessage: string | null;
  stoppedTaskId: string | null;
  outcome: "stopped" | "already_stopped" | null;
};

/**
 * Narrow dependency surface so the security/idempotence behaviour can be
 * proven without a database or Next.js request context.
 */
export type ActiveTimerActionDependencies = {
  getCurrentUser: () => Promise<{ id: string } | null>;
  getActiveTimerSession: () => Promise<{
    data: ActiveTimerSessionLike | null;
    errorMessage: string | null;
  }>;
  stopTimerSession: (options: {
    sessionId: string;
  }) => Promise<TimerStopServiceResult>;
  revalidateTimerSurfaces: () => void;
  nowIso?: () => string;
};

function nowIso(dependencies: ActiveTimerActionDependencies) {
  return dependencies.nowIso?.() ?? new Date().toISOString();
}

function unavailableRead(): ActiveTimerReadResult {
  return {
    ok: false,
    reason: "unavailable",
    message: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
  };
}

/**
 * Authenticated canonical read for the global chip.
 *
 * Returns only what the chip renders; the action never trusts caller-supplied
 * identities or session data.
 */
export async function readActiveTimerSnapshotWithDependencies(
  dependencies: ActiveTimerActionDependencies,
): Promise<ActiveTimerReadResult> {
  // Fail closed: no timer read without a verified identity.
  const user = await dependencies.getCurrentUser().catch(() => null);
  if (!user) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: ACTIVE_TIMER_UNAUTHENTICATED_MESSAGE,
    };
  }

  try {
    const result = await dependencies.getActiveTimerSession();
    if (result.errorMessage) {
      return unavailableRead();
    }

    return {
      ok: true,
      syncedAt: nowIso(dependencies),
      session: toActiveTimerSnapshot(result.data),
    };
  } catch {
    return unavailableRead();
  }
}

export function normalizeTimerSessionId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sessionId = value.trim();
  if (!sessionId || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return null;
  }

  return sessionId;
}

/**
 * Idempotent, non-redirecting stop for the chip and popout.
 *
 * Reuses the canonical `stopTimerSession` service: identity and owner equality
 * are re-checked there against the exact persisted session id. Stopping an
 * already-ended session is reported as success by the service and therefore
 * here; no newer session is ever touched by an old chip/popout.
 */
export async function stopActiveTimerWithDependencies(
  input: unknown,
  dependencies: ActiveTimerActionDependencies,
): Promise<ActiveTimerStopOutcomeResult> {
  // Authenticate before validating input so an anonymous caller learns nothing
  // about session-id shape.
  const user = await dependencies.getCurrentUser().catch(() => null);
  if (!user) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: ACTIVE_TIMER_UNAUTHENTICATED_MESSAGE,
      stoppedTaskId: null,
    };
  }

  const sessionId = normalizeTimerSessionId(input);
  if (!sessionId) {
    return {
      ok: false,
      reason: "invalid_session",
      message: ACTIVE_TIMER_INVALID_SESSION_MESSAGE,
      stoppedTaskId: null,
    };
  }

  try {
    const result = await dependencies.stopTimerSession({ sessionId });
    if (result.errorMessage) {
      return {
        ok: false,
        reason: "unavailable",
        message: result.errorMessage,
        stoppedTaskId: result.stoppedTaskId,
      };
    }

    if (!result.outcome) {
      return {
        ok: false,
        reason: "unavailable",
        message: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
        stoppedTaskId: null,
      };
    }

    dependencies.revalidateTimerSurfaces();

    return {
      ok: true,
      outcome: result.outcome,
      stoppedTaskId: result.stoppedTaskId,
      syncedAt: nowIso(dependencies),
    };
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: ACTIVE_TIMER_UNAVAILABLE_MESSAGE,
      stoppedTaskId: null,
    };
  }
}
