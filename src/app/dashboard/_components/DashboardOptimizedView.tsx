import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { AppShell } from "@/components/layout/app-shell";
import { OwnerScopedRealtimeRefresh } from "@/components/realtime/owner-scoped-realtime-refresh";
import { TimerStopOutcomePrompt } from "@/components/timer/timer-stop-outcome-prompt";

import { CommandCenterSpotlight } from "./CommandCenterSpotlight";
import { DashboardHeroSection } from "./DashboardHeroSection";
import { FocusPanelCard } from "./FocusPanelCard";
import { GoalMovementCard } from "./GoalMovementCard";
import { ProjectStateCard } from "./ProjectStateCard";
import { ReviewPulseCard } from "./ReviewPulseCard";
import { TimerSummaryCard } from "./TimerSummaryCard";
import { TodayPlannerCard } from "./TodayPlannerCard";

import type { DashboardData } from "../_lib/dashboard-data";

interface DashboardOptimizedViewProps {
  data: DashboardData;
  displayName?: string;
  ownerUserId: string | null;
  completedCount: number;
  completionRate: number | null;
  urgentCount: number;
  activeProjectCount: number;
  totalProjectCount: number;
  stoppedTaskId: string | null;
}

export function DashboardOptimizedView({
  data,
  displayName = "operator",
  ownerUserId,
  completedCount,
  completionRate,
  urgentCount,
  activeProjectCount,
  totalProjectCount,
  stoppedTaskId,
}: DashboardOptimizedViewProps) {
  const { health, focusPanel, activeTimer, todayPlanner, projectStatuses, goals, timerSummary, latestReview, linearProject, workStats } = data;

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
        ownerUserId={ownerUserId}
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

      <div id="dashboard-main">
        <DashboardHeroSection
          displayName={displayName}
          completionRate={completionRate}
          todayCount={tasks.length}
          completedCount={completedCount}
          urgentCount={urgentCount}
          activeProjectCount={activeProjectCount}
          totalProjectCount={totalProjectCount}
          timerSummary={timerSummary.data}
          workStats={workStats.data}
          workStatsError={workStats.error}
        />

        <section className="workspace-main-rail-grid">
          <CommandCenterSpotlight
            project={linearProject}
            activeTimer={activeTimer}
            health={health}
            timerSummary={timerSummary.data}
          />
          <ReviewPulseCard
            review={latestReview}
            goals={goals}
            health={health}
          />
        </section>

        <section className="mt-6 grid items-start gap-6 xl:grid-cols-2">
          <TodayPlannerCard planner={todayPlanner} />
          <FocusPanelCard activeTimer={activeTimer} focusPanel={focusPanel} />
          <GoalMovementCard goals={goals} />
        </section>

        <section className="mt-6 grid items-start gap-6 xl:grid-cols-[0.96fr_1.04fr]">
          <ProjectStateCard
            projects={projectStatuses}
            activeProjectCount={activeProjectCount}
            totalProjectCount={totalProjectCount}
          />
          <TimerSummaryCard summary={timerSummary} activeTimer={activeTimer} />
        </section>
      </div>
    </AppShell>
  );
}
