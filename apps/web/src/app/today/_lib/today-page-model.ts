import { isTaskCompletedStatus } from "@/lib/task-domain";
import { getCurrentUser } from "@/lib/services/auth-service";
import { getTodayPlannerData } from "@/lib/services/today-planner-service";

export type TodaySearchParams = {
  actionError?: string;
  actionSuccess?: string;
  stoppedTaskId?: string;
};

export async function getTodayPageModel(searchParams: TodaySearchParams) {
  const actionError = searchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = searchParams.actionSuccess?.slice(0, 180) ?? null;
  const stoppedTaskId = searchParams.stoppedTaskId?.slice(0, 80) ?? null;
  const [todayResult, user] = await Promise.all([getTodayPlannerData(), getCurrentUser()]);
  if (todayResult.errorMessage || !todayResult.data) {
    return { error: todayResult.errorMessage ?? "Could not load Today planner", actionError, actionSuccess, stoppedTaskId, user, todayData: null as any };
  }
  const todayData = todayResult.data;
  const returnTo = "/today";
  const activeTimerSessionId = todayData.activeTimer?.sessionId ?? null;
  const flexibleTodayActionable = todayData.flexibleTasks.filter((t) => !isTaskCompletedStatus(t.status) && t.status !== "blocked");
  const stoppedTaskTitle = [
    ...todayData.plannedToday,
    ...todayData.planned,
    ...todayData.inProgress,
    ...todayData.blocked,
    ...todayData.completed,
    ...todayData.focusQueue,
    ...todayData.suggestions.pinned,
    ...todayData.suggestions.inProgress,
  ].find((t) => t.id === stoppedTaskId)?.title ?? "this task";
  const showStoppedTaskPrompt = Boolean(!todayData.activeTimer && stoppedTaskId);
  const allTodayCount = todayData.summary.plannedCount + todayData.summary.inProgressCount + todayData.summary.blockedCount + todayData.summary.completedCount;
  return {
    actionError,
    actionSuccess,
    stoppedTaskId,
    stoppedTaskTitle,
    showStoppedTaskPrompt,
    todayData,
    returnTo,
    activeTimerSessionId,
    flexibleTodayActionable,
    allTodayCount,
    user,
    error: null as string | null,
  };
}

export type TodayPageModel = Awaited<ReturnType<typeof getTodayPageModel>>;
