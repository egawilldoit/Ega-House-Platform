import { getCurrentUser } from "@/lib/services/auth-service";
import { getTimerWorkspaceData } from "@/lib/services/timer-service";

export type TimerSearchParams = {
  actionError?: string;
  actionSuccess?: string;
  stoppedTaskId?: string;
};

export async function getTimerPageModel(searchParams: TimerSearchParams) {
  const actionError = searchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = searchParams.actionSuccess?.slice(0, 180) ?? null;
  const stoppedTaskId = searchParams.stoppedTaskId?.slice(0, 80) ?? null;
  const [workspaceData, user] = await Promise.all([getTimerWorkspaceData(), getCurrentUser()]);
  const { tasks, openSessions, todayTaskBreakdown, todayTotalDurationSeconds, sessionHistory, taskTotalDurations } = workspaceData;
  const activeSession = openSessions[0] ?? null;
  const trackedTotalSeconds = Object.values(taskTotalDurations).reduce((sum, v) => sum + v, 0);
  return {
    actionError,
    actionSuccess,
    stoppedTaskId,
    ownerUserId: user?.id ?? null,
    tasks,
    openSessions,
    todayTaskBreakdown,
    todayTotalDurationSeconds,
    sessionHistory,
    taskTotalDurations,
    activeSession,
    trackedTotalSeconds,
  };
}

export type TimerPageModel = Awaited<ReturnType<typeof getTimerPageModel>>;
