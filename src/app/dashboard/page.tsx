import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { TimerStopOutcomePrompt } from "@/components/timer/timer-stop-outcome-prompt";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCurrentUser } from "@/lib/services/auth-service";

import {
  CommandCenterAsync,
  FocusAsync,
  GoalsAsync,
  HeroPanelAsync,
  PlannerAsync,
  ProjectsAsync,
  ReviewPulseAsync,
  TimerSummaryAsync,
} from "./_components/dashboard-async-panels";
import { McpComingSoonAnnouncement } from "./_components/McpComingSoonAnnouncement";
import { PanelErrorBoundary } from "./_components/PanelErrorBoundary";
import {
  CommandCenterSkeleton,
  FocusSkeleton,
  GoalsSkeleton,
  HeroSkeleton,
  PlannerSkeleton,
  ProjectsSkeleton,
  ReviewPulseSkeleton,
  TimerSummarySkeleton,
} from "./_components/skeletons";
import {
  getActiveTimer,
  getTodayPlanner,
  getTimerSummary,
  getDashboardHealthData,
  getDashboardData,
} from "./_lib/dashboard-data";
import "./_components/dashboard.css";
import "./_components/dashboard-editorial.css";

export const metadata = {
  title: "Dashboard",
  description: "Read-only operational snapshot across health, tasks, and timer.",
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

  const [activeTimer, todayPlanner, timerSummary, health] = await Promise.all([
    getActiveTimer(),
    getTodayPlanner(),
    getTimerSummary(),
    getDashboardHealthData(),
  ]);

  const tasks = todayPlanner.data?.all ?? [];
  const stoppedTaskTitle =
    tasks.find((task) => task.id === stoppedTaskId)?.title ??
    (activeTimer.data?.taskId === stoppedTaskId ? activeTimer.data.taskTitle : "this task");
  const showStoppedTaskPrompt = Boolean(!activeTimer.data && stoppedTaskId);

  return (
    <AppShell
      eyebrow="Operational Command"
      title="Dashboard"
      description="A live snapshot of task pressure, goal movement, project health, timer activity, and review momentum."
      contentClassName="pb-20"
      actions={
        <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite" aria-atomic="true">
          <StatusBadge
            status={health.state === "healthy" ? "done" : "blocked"}
            label={health.state === "healthy" ? "System healthy" : "Probe degraded"}
          />
          <Badge tone="muted">
            {timerSummary.data
              ? `${timerSummary.data.sessionsTodayCount} sessions today`
              : "Timer summary pending"}
          </Badge>
        </div>
      }
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
        <McpComingSoonAnnouncement />

        <PanelErrorBoundary panelName="Hero">
          <Suspense fallback={<HeroSkeleton />}>
            <HeroPanelAsync />
          </Suspense>
        </PanelErrorBoundary>

        <section className="workspace-main-rail-grid">
          <PanelErrorBoundary panelName="Command center">
            <Suspense fallback={<CommandCenterSkeleton />}>
              <CommandCenterAsync />
            </Suspense>
          </PanelErrorBoundary>
          <PanelErrorBoundary panelName="Review pulse">
            <Suspense fallback={<ReviewPulseSkeleton />}>
              <ReviewPulseAsync />
            </Suspense>
          </PanelErrorBoundary>
        </section>

        <section className="grid items-start gap-6 xl:grid-cols-2">
          <PanelErrorBoundary panelName="Today planner">
            <Suspense fallback={<PlannerSkeleton />}>
              <PlannerAsync />
            </Suspense>
          </PanelErrorBoundary>
          <PanelErrorBoundary panelName="Focus panel">
            <Suspense fallback={<FocusSkeleton />}>
              <FocusAsync />
            </Suspense>
          </PanelErrorBoundary>
          <PanelErrorBoundary panelName="Goal movement">
            <Suspense fallback={<GoalsSkeleton />}>
              <GoalsAsync />
            </Suspense>
          </PanelErrorBoundary>
        </section>

        <section className="grid items-start gap-6 xl:grid-cols-[0.96fr_1.04fr]">
          <PanelErrorBoundary panelName="Project state">
            <Suspense fallback={<ProjectsSkeleton />}>
              <ProjectsAsync />
            </Suspense>
          </PanelErrorBoundary>
          <PanelErrorBoundary panelName="Timer summary">
            <Suspense fallback={<TimerSummarySkeleton />}>
              <TimerSummaryAsync />
            </Suspense>
          </PanelErrorBoundary>
        </section>
      </main>
    </AppShell>
  );
}
