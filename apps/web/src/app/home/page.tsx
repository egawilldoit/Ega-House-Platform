import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getOperatorSnapshotData } from "@/lib/services/operator-service";
import { getActiveTimerSession } from "@/lib/services/timer-service";
import { getShellIdentity, getWorkspaceShellMetricsResult } from "@/lib/workspace-shell";

import { AuthenticatedHomePage } from "./_components/authenticated-home-page";
import { buildHomeGreeting, type HomeGreeting } from "./_lib/home-greeting";
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
 *
 * The primary composition (greeting, Now, quick actions, Today, Next,
 * Attention) never waits on secondary Activity analytics: the Activity pulse
 * streams in through its own Suspense section.
 */
export default async function HomeRoute() {
  const [snapshotResult, attentionResult, user, identity] = await Promise.all([
    getOperatorSnapshotData(),
    getWorkspaceShellMetricsResult(),
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

  const model = buildHomeModel({
    snapshot: snapshotResult.data,
    attention: attentionResult.available
      ? {
          overdue: attentionResult.metrics.overdueTaskCount,
          dueToday: attentionResult.metrics.dueTodayTaskCount,
          reviewMissing: attentionResult.metrics.reviewMissing,
        }
      : null,
    activeTimerStartedAt,
  });

  // Greeting/date come from the canonical Time Context already embedded in the
  // Operator snapshot — never from the runtime or browser timezone.
  const greeting: HomeGreeting | null = snapshotResult.data
    ? buildHomeGreeting({
        date: snapshotResult.data.date,
        timezone: snapshotResult.data.timezone,
        name: identity.name,
      })
    : null;

  return (
    <AppShell
      title={`Welcome back, ${identity.name}`}
      description="What to do now, what needs attention, and what to start next."
    >
      <OwnerScopedRealtimeRefresh
        ownerUserId={user?.id ?? null}
        channelPrefix="home"
        tables={["tasks", "task_sessions", "week_reviews"]}
      />
      <AuthenticatedHomePage model={model} greeting={greeting} name={identity.name} />
    </AppShell>
  );
}
