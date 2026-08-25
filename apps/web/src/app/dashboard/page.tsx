import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { TimerStopOutcomePrompt } from "@/components/timer/timer-stop-outcome-prompt";
import { getCurrentUser } from "@/lib/services/auth-service";

import {
  AttentionQueueAsync,
  FocusAsync,
  PlannerAsync,
  ProjectsAsync,
  ReviewPulseAsync,
  SummaryStripAsync,
} from "./_components/dashboard-async-panels";
import { McpComingSoonAnnouncement } from "./_components/McpComingSoonAnnouncement";
import { PanelErrorBoundary } from "./_components/PanelErrorBoundary";
import {
  FocusSkeleton,
  PlannerSkeleton,
  ProjectsSkeleton,
  ReviewPulseSkeleton,
} from "./_components/skeletons";
import {
  getActiveTimer,
  getTodayPlanner,
  getDashboardData,
} from "./_lib/dashboard-data";
import "./_components/dashboard.css";
import "./_components/dashboard-editorial.css";

export const metadata = {
  title: "Dashboard",
  description: "What needs your attention, what you are doing today, and what to do next.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ stoppedTaskId?: string; debug?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const stoppedTaskId = resolvedSearchParams.stoppedTaskId?.slice(0, 80) ?? null;
  const user = await getCurrentUser();

  if (resolvedSearchParams.debug === "1") {
    const data = await getDashboardData({ ownerUserId: user?.id ?? null });
    return (
      <pre
        className="p-8 text-xs overflow-auto font-mono"
        data-dashboard-debug
        aria-label="Dashboard raw data dump"
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }

  const [activeTimer, todayPlanner] = await Promise.all([getActiveTimer(), getTodayPlanner()]);

  const tasks = todayPlanner.data?.all ?? [];
  const stoppedTaskTitle =
    tasks.find((task) => task.id === stoppedTaskId)?.title ??
    (activeTimer.data?.taskId === stoppedTaskId ? activeTimer.data.taskTitle : "this task");
  const showStoppedTaskPrompt = Boolean(!activeTimer.data && stoppedTaskId);

  return (
    <AppShell
      eyebrow="Command"
      title="Dashboard"
      description="What needs your attention, what you are doing today, and what to do next."
      contentClassName="pb-10"
    >
      <OwnerScopedRealtimeRefresh
        ownerUserId={user?.id ?? null}
        channelPrefix="dashboard"
        tables={["task_sessions", "tasks"]}
      />

      {showStoppedTaskPrompt ? (
        <TimerStopOutcomePrompt
          taskId={stoppedTaskId ?? ""}
          taskTitle={stoppedTaskTitle}
          returnTo="/dashboard"
        />
      ) : null}

      <a
        href="#dashboard-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--background)] focus:text-[var(--foreground)] focus:rounded-lg focus:ring-2"
      >
        Skip to main content
      </a>

      <main id="dashboard-main" aria-label="Dashboard main content" className="flex flex-col gap-6">
        <PanelErrorBoundary panelName="Summary">
          <Suspense
            fallback={
              <div className="grid grid-cols-12 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="col-span-12 sm:col-span-6 lg:col-span-3 h-[110px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[var(--ega-skeleton)]" />
                ))}
              </div>
            }
          >
            <SummaryStripAsync />
          </Suspense>
        </PanelErrorBoundary>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-5">
            <PanelErrorBoundary panelName="Today planner">
              <Suspense fallback={<PlannerSkeleton />}>
                <PlannerAsync />
              </Suspense>
            </PanelErrorBoundary>
          </div>
          <div className="col-span-12 lg:col-span-7">
            <PanelErrorBoundary panelName="Focus panel">
              <Suspense fallback={<FocusSkeleton />}>
                <FocusAsync />
              </Suspense>
            </PanelErrorBoundary>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-4">
            <PanelErrorBoundary panelName="Attention queue">
              <Suspense
                fallback={<div className="h-[320px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--ega-border)] bg-[var(--ega-skeleton)]" />}
              >
                <AttentionQueueAsync />
              </Suspense>
            </PanelErrorBoundary>
          </div>
          <div className="col-span-12 lg:col-span-5">
            <PanelErrorBoundary panelName="Project state">
              <Suspense fallback={<ProjectsSkeleton />}>
                <ProjectsAsync />
              </Suspense>
            </PanelErrorBoundary>
          </div>
          <div className="col-span-12 lg:col-span-3">
            <PanelErrorBoundary panelName="Review pulse">
              <Suspense fallback={<ReviewPulseSkeleton />}>
                <ReviewPulseAsync />
              </Suspense>
            </PanelErrorBoundary>
          </div>
        </div>

        <McpComingSoonAnnouncement />
      </main>
    </AppShell>
  );
}
