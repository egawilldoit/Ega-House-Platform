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
import { displayNameForUser } from "./_lib/dashboard-helpers";
import { getActiveTimer, getTodayPlanner, getTimerSummary, getDashboardHealthData } from "./_lib/dashboard-data";
import "./_components/dashboard.css";

export const metadata = {
  title: "Dashboard",
  description: "Read-only operational snapshot across health, tasks, and timer.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ stoppedTaskId?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const stoppedTaskId = resolvedSearchParams.stoppedTaskId?.slice(0, 80) ?? null;
  const user = await getCurrentUser();
  const displayName = displayNameForUser(user);

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

      <main id="dashboard-main" className="flex flex-col gap-6">
        <Suspense fallback={<HeroSkeleton />}>
          <HeroPanelAsync />
        </Suspense>

        <section className="workspace-main-rail-grid">
          <Suspense fallback={<CommandCenterSkeleton />}>
            <CommandCenterAsync />
          </Suspense>
          <Suspense fallback={<ReviewPulseSkeleton />}>
            <ReviewPulseAsync />
          </Suspense>
        </section>

        <section className="grid items-start gap-6 xl:grid-cols-2">
          <Suspense fallback={<PlannerSkeleton />}>
            <PlannerAsync />
          </Suspense>
          <Suspense fallback={<FocusSkeleton />}>
            <FocusAsync />
          </Suspense>
          <Suspense fallback={<GoalsSkeleton />}>
            <GoalsAsync />
          </Suspense>
        </section>

        <section className="grid items-start gap-6 xl:grid-cols-[0.96fr_1.04fr]">
          <Suspense fallback={<ProjectsSkeleton />}>
            <ProjectsAsync />
          </Suspense>
          <Suspense fallback={<TimerSummarySkeleton />}>
            <TimerSummaryAsync />
          </Suspense>
        </section>
      </main>
    </AppShell>
  );
}
