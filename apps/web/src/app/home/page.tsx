import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getOperatorSnapshotData } from "@/lib/services/operator-service";
import { getWorkspaceShellMetrics } from "@/lib/workspace-shell";

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
  const [snapshotResult, metrics, user] = await Promise.all([
    getOperatorSnapshotData(),
    getWorkspaceShellMetrics(),
    getCurrentUser(),
  ]);

  const model = buildHomeModel({ snapshot: snapshotResult.data, metrics });

  return (
    <AppShell
      eyebrow="Workspace"
      title="Home"
      description="What to do now, what needs attention, and what to start quickly."
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
