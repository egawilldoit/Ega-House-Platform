import { Suspense } from "react";

import { getHeroPanelData, getCommandCenterPanelData, getPlannerPanelData, getFocusPanelData, getGoalsPanelData, getProjectsPanelData, getReviewPulsePanelData, getTimerSummaryPanelData } from "../_lib/dashboard-data";
import { displayNameForUser } from "../_lib/dashboard-helpers";
import { getCurrentUser } from "@/lib/services/auth-service";

import { CommandCenterSpotlight } from "./CommandCenterSpotlight";
import { DashboardHeroSection } from "./DashboardHeroSection";
import { FocusPanelCard } from "./FocusPanelCard";
import { GoalMovementCard } from "./GoalMovementCard";
import { ProjectStateCard } from "./ProjectStateCard";
import { ReviewPulseCard } from "./ReviewPulseCard";
import { TimerSummaryCard } from "./TimerSummaryCard";
import { TodayPlannerCard } from "./TodayPlannerCard";

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

export {
  HeroPanelAsync,
  CommandCenterAsync,
  ReviewPulseAsync,
  PlannerAsync,
  FocusAsync,
  GoalsAsync,
  ProjectsAsync,
  TimerSummaryAsync,
  HeroSkeleton,
};

// Re-export Suspense for the page consumer.
export { Suspense };
