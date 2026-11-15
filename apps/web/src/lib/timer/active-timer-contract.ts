/**
 * Wire contract for the global floating timer chip and its Document
 * Picture-in-Picture window.
 *
 * Directive-free so the Server Actions and the client provider can share the
 * exact shape. Task titles already render in the authenticated workspace; owner
 * ids, emails and service credentials never cross this boundary.
 */

import { getTaskContextHref } from "@/lib/task-navigation";

export type ActiveTimerSyncPhase =
  | "synced"
  | "stale"
  | "unauthenticated";

export type ActiveTimerSessionSnapshot = {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  projectName: string;
  projectSlug: string | null;
  /** Canonical persisted start instant. Elapsed time is always derived from it. */
  startedAt: string;
  taskHref: string;
};

export type ActiveTimerReadResult =
  | {
      ok: true;
      /** Server-observed instant that produced this confirmed read. */
      syncedAt: string;
      session: ActiveTimerSessionSnapshot | null;
    }
  | {
      ok: false;
      reason: "unauthenticated" | "unavailable";
      message: string;
    };

export type ActiveTimerStopOutcomeResult =
  | {
      ok: true;
      outcome: "stopped" | "already_stopped";
      stoppedTaskId: string | null;
      syncedAt: string;
    }
  | {
      ok: false;
      reason: "unauthenticated" | "invalid_session" | "unavailable";
      message: string;
      stoppedTaskId: string | null;
    };

export const ACTIVE_TIMER_UNAUTHENTICATED_MESSAGE =
  "Your session expired. Sign in again to use the floating timer.";
export const ACTIVE_TIMER_UNAVAILABLE_MESSAGE =
  "Could not confirm the active timer with the server. Showing the last known state.";
export const ACTIVE_TIMER_OFFLINE_MESSAGE =
  "Offline - showing the last known timer state. Reconnecting will refresh it automatically.";
export const ACTIVE_TIMER_INVALID_SESSION_MESSAGE =
  "That timer session is no longer available.";

export type ActiveTimerSessionLike = {
  sessionId: string;
  taskId: string;
  taskTitle: string;
  projectName: string;
  projectSlug: string | null;
  startedAt: string;
};

/** Project the service row onto the serializable client snapshot. */
export function toActiveTimerSnapshot(
  session: ActiveTimerSessionLike | null,
): ActiveTimerSessionSnapshot | null {
  if (!session) {
    return null;
  }

  return {
    sessionId: session.sessionId,
    taskId: session.taskId,
    taskTitle: session.taskTitle,
    projectName: session.projectName,
    projectSlug: session.projectSlug,
    startedAt: session.startedAt,
    taskHref: getTaskContextHref(session.taskId, session.projectSlug),
  };
}
