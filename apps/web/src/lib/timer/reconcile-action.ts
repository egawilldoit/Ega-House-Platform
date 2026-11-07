"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/services/auth-service";
import {
  getActiveTimerSession,
  getTimerWorkspaceData,
} from "@/lib/services/timer-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";

import type {
  TimerReconcileResult,
  TimerReconcileSurface,
} from "./reconcile-contract";

const UNAUTHENTICATED_MESSAGE =
  "Your session expired. Sign in again to sync the timer.";
const UNAVAILABLE_MESSAGE =
  "Could not confirm the timer state with the server. Showing the last synced state.";

function unavailable(): TimerReconcileResult {
  return { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE };
}

/**
 * Verified reconcile for the PWA timer surfaces.
 *
 * Unlike a blind `router.refresh()`, this proves an authenticated canonical
 * read succeeded before the client may claim a synced state. `revalidatePath`
 * runs inside a Server Function, which updates the viewed path immediately for
 * the caller (Next.js 16 documented behavior).
 *
 * Returns only an identifier and a timestamp; task titles and owner ids never
 * cross this boundary.
 */
export async function reconcileTimerSurface(
  surface: TimerReconcileSurface,
): Promise<TimerReconcileResult> {
  // Fail closed: never touch timer data without a verified identity.
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: UNAUTHENTICATED_MESSAGE,
    };
  }

  // Accept only the two known surfaces; arbitrary paths are not a contract.
  const target: TimerReconcileSurface = surface === "today" ? "today" : "timer";

  if (target === "today") {
    try {
      const { data, errorMessage } = await getActiveTimerSession();
      if (errorMessage) {
        return unavailable();
      }
      revalidatePath("/today");
      return {
        ok: true,
        syncedAt: new Date().toISOString(),
        activeSessionId: data?.sessionId ?? null,
      };
    } catch {
      return unavailable();
    }
  }

  try {
    const timeContext = await getWebTimeContext().catch(() => null);
    const workspace = await getTimerWorkspaceData(
      timeContext ? { timezone: timeContext.timezone } : undefined,
    );
    revalidatePath("/timer");
    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      activeSessionId: workspace.openSessions[0]?.id ?? null,
    };
  } catch {
    return unavailable();
  }
}
