"use server";

import { getCurrentUser } from "@/lib/services/auth-service";
import {
  getActiveTimerSession,
  stopTimerSession,
} from "@/lib/services/timer-service";
import { revalidateWorkspaceFor } from "@/lib/workspace/workspace-navigation";

import {
  readActiveTimerSnapshotWithDependencies,
  stopActiveTimerWithDependencies,
  type ActiveTimerActionDependencies,
} from "@/lib/timer/active-timer-actions-core";
import type {
  ActiveTimerReadResult,
  ActiveTimerStopOutcomeResult,
} from "@/lib/timer/active-timer-contract";

const dependencies: ActiveTimerActionDependencies = {
  getCurrentUser,
  getActiveTimerSession,
  stopTimerSession,
  revalidateTimerSurfaces: () => {
    revalidateWorkspaceFor("timer", { returnTo: "/timer" });
  },
};

/**
 * Canonical read used by the global chip on focus, reconnect and owner-scoped
 * realtime changes. Never called on a per-second cadence.
 */
export async function readActiveTimerSnapshotAction(): Promise<ActiveTimerReadResult> {
  return readActiveTimerSnapshotWithDependencies(dependencies);
}

/**
 * Non-redirecting stop for the chip and popout. The exact persisted session id
 * is required; `stopTimerSession` remains the sole write authority.
 */
export async function stopActiveTimerSessionAction(
  sessionId: string,
): Promise<ActiveTimerStopOutcomeResult> {
  return stopActiveTimerWithDependencies(sessionId, dependencies);
}
