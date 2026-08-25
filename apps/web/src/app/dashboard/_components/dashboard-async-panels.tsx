import { Suspense } from "react";

import { getHeroPanelData, getCommandCenterPanelData, getPlannerPanelData, getFocusPanelData, getGoalsPanelData, getProjectsPanelData, getReviewPulsePanelData, getTimerSummaryPanelData } from "../_lib/dashboard-data";
import { displayNameForUser } from "../_lib/dashboard-helpers";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getWorkspaceShellMetrics } from "@/lib/workspace-shell";

import { CommandCenterSpotlight } from "./CommandCenterSpotlight";
import { DashboardHeroSection } from "./DashboardHeroSection";
import { FocusPanelCard } from "./FocusPanelCard";
import { GoalMovementCard } from "./GoalMovementCard";
import { ProjectStateCard } from "./ProjectStateCard";
import { ReviewPulseCard } from "./ReviewPulseCard";
import { TimerSummaryCard } from "./TimerSummaryCard";
import { TodayPlannerCard } from "./TodayPlannerCard";
import { DashboardSummaryStrip } from "./DashboardSummaryStrip";
import { AttentionQueueCard, buildAttentionItems } from "./AttentionQueueCard";

import { HeroSkeleton } from "./skeletons";

async function HeroPanelAsync() {
  const user = await getCurrentUser();
  const data = await getHeroPanelData(user?.id ?? null, displayNameForUser(user));
  return (
    <DashboardHeroSection
      displayName={data.displayName}
      completionRate={data.completionRate}
      todayCount={data.tasks.length}
      completedCount={data.completedCount}
      urgentCount={data.urgentCount}
      activeProjectCount={data.activeProjectCount}
      totalProjectCount={data.totalProjectCount}
      timerSummary={data.timerSummary}
      workStats={data.workStats}
      workStatsError={data.workStatsError}
    />
  );
}

async function CommandCenterAsync() {
  const data = await getCommandCenterPanelData();
  return (
    <CommandCenterSpotlight
      project={data.linearProject}
      activeTimer={data.activeTimer}
      health={data.health}
      timerSummary={data.timerSummary.data}
    />
  );
}

async function ReviewPulseAsync() {
  const data = await getReviewPulsePanelData();
  return <ReviewPulseCard review={data.latestReview} goals={data.goals} health={data.health} />;
}

async function PlannerAsync() {
  const data = await getPlannerPanelData();
  return <TodayPlannerCard planner={data.todayPlanner} />;
}

async function FocusAsync() {
  const data = await getFocusPanelData();
  return <FocusPanelCard activeTimer={data.activeTimer} focusPanel={data.focusPanel} />;
}

async function GoalsAsync() {
  const data = await getGoalsPanelData();
  return <GoalMovementCard goals={data.goals} />;
}

async function ProjectsAsync() {
  const data = await getProjectsPanelData();
  return (
    <ProjectStateCard
      projects={data.projectStatuses}
      activeProjectCount={data.activeProjectCount}
      totalProjectCount={data.totalProjectCount}
    />
  );
}

async function TimerSummaryAsync() {
  const data = await getTimerSummaryPanelData();
  return <TimerSummaryCard summary={data.timerSummary} activeTimer={data.activeTimer} />;
}

async function SummaryStripAsync() {
  const user = await getCurrentUser();
  const [hero, goals, review, metrics] = await Promise.all([
    getHeroPanelData(user?.id ?? null, displayNameForUser(user)),
    getGoalsPanelData(),
    getReviewPulsePanelData(),
    getWorkspaceShellMetrics(),
  ]);

  const activeGoals = (goals.goals.data ?? []).filter((g) => g.status === "active").length;
  const goalsTotal = (goals.goals.data ?? []).length;
  const pendingReviews = review.latestReview.data ? 0 : 1;

  return (
    <DashboardSummaryStrip
      focusItems={hero.tasks.length}
      focusDelta={null}
      activeGoals={activeGoals}
      goalsTotal={goalsTotal}
      pendingReviews={pendingReviews}
      timeTrackedLabel={hero.timerSummary?.trackedTodayLabel ?? "--"}
      timeTrackedDelta={null}
      completionRate={hero.completionRate}
    />
  );
}

async function AttentionQueueAsync() {
  const [metrics, goals, projects] = await Promise.all([
    getWorkspaceShellMetrics(),
    getGoalsPanelData(),
    getProjectsPanelData(),
  ]);

  const atRiskGoals = (goals.goals.data ?? []).filter((g) => g.health === "at_risk" || g.health === "off_track").map((g) => ({ id: g.id, title: g.title }));
  const dueProjects = (projects.projectStatuses.data ?? []).slice(0, 3).map((p) => ({ id: p.id, name: p.name, slug: p.slug }));

  const items = buildAttentionItems({
    blockedCount: metrics.blockedTaskCount,
    overdueCount: metrics.overdueTaskCount,
    dueTodayCount: metrics.dueTodayTaskCount,
    reviewMissing: metrics.reviewMissing,
    atRiskGoals,
    dueProjects,
  });

  return <AttentionQueueCard items={items} />;
}

export {
  HeroPanelAsync,
  CommandCenterAsync,
  ReviewPulseAsync,
  PlannerAsync,
  FocusAsync,
  GoalsAsync,
  ProjectsAsync,
  TimerSummaryAsync,
  SummaryStripAsync,
  AttentionQueueAsync,
  HeroSkeleton,
};

// Re-export Suspense for the page consumer.
export { Suspense };
