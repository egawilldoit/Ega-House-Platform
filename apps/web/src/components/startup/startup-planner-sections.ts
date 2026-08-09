import type { StartupPlannerData, StartupPlannerTask } from "@/lib/services/startup-planner-service";
import { isTaskCompletedStatus } from "@/lib/task-domain";

export type StartupPlannerSectionState = {
  blockersCount: number;
  goalsCount: number;
  focusCount: number;
  dueSoonCount: number;
  planThisWeekCount: number;
  hasLatestReview: boolean;
};

function isActionableTask(task: StartupPlannerTask) {
  return !isTaskCompletedStatus(task.status);
}

export function getStartupPlannerSectionState(data: StartupPlannerData): StartupPlannerSectionState {
  return {
    blockersCount: data.blockersCarryForward.length,
    goalsCount: data.keyGoals.length,
    focusCount: data.focusTasks.length,
    dueSoonCount: data.dueSoonTasks.length,
    planThisWeekCount: data.planThisWeekTasks.filter(isActionableTask).length,
    hasLatestReview: Boolean(data.review.latest),
  };
}
