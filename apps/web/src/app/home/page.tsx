import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getOperatorSnapshotData } from "@/lib/services/operator-service";
import { getActiveTimerSession } from "@/lib/services/timer-service";
import { getShellIdentity, getWorkspaceShellMetrics } from "@/lib/workspace-shell";

import { AuthenticatedHomePage } from "./_components/authenticated-home-page";
import { buildHomeModel } from "./_lib/home-page-model";

export const metadata: Metadata = {
  title: "Home",
  description: "What to do now, what needs attention, and what to start quickly.",
};

/**
 * Authenticated workspace Home (`/home`).
 *
 * This is the product entry surface. The public marketing home remains at `/`
 * for unauthenticated visitors and is a separate component tree.
 */
export default async function HomeRoute() {
  const [snapshotResult, metrics, user, identity] = await Promise.all([
    getOperatorSnapshotData(),
    getWorkspaceShellMetrics(),
    getCurrentUser(),
    getShellIdentity(),
  ]);

  // Bounded active-session read, only when the canonical Operator snapshot says
  // a timer is running. It supplies startedAt for the live elapsed display; Home
  // never computes timer math itself and never loads the full Timer page model.
  let activeTimerStartedAt: string | null = null;
  if (snapshotResult.data?.activeTimer) {
    const activeTimerResult = await getActiveTimerSession();
    activeTimerStartedAt = activeTimerResult.data?.startedAt ?? null;
  }

  const model = buildHomeModel({ snapshot: snapshotResult.data, metrics, activeTimerStartedAt });

  return (
    <AppShell
      title={`Welcome back, ${identity.name}`}
      description="What to do now, what needs attention, and what to start next."
    >
      <OwnerScopedRealtimeRefresh
        ownerUserId={user?.id ?? null}
        channelPrefix="home"
        tables={["tasks", "task_sessions"]}
      />
      <AuthenticatedHomePage model={model} />
    </AppShell>
  );
}
