import { getCurrentUser } from "@/lib/services/auth-service";
import { getTimerWorkspaceData } from "@/lib/services/timer-service";
import { getWebTimeContext } from "@/lib/services/time-context-service";

export type TimerSearchParams = {
  actionError?: string;
  actionSuccess?: string;
  stoppedTaskId?: string;
};

export async function getTimerPageModel(searchParams: TimerSearchParams) {
  const actionError = searchParams.actionError?.slice(0, 180) ?? null;
  const actionSuccess = searchParams.actionSuccess?.slice(0, 180) ?? null;
  const stoppedTaskId = searchParams.stoppedTaskId?.slice(0, 80) ?? null;
  // Timer tracked-today uses the owner's persisted EGA House timezone so web
  // Timer and the Hono Timer transport agree on the local day.
  const timeContext = await getWebTimeContext().catch(() => null);
  const [workspaceData, user] = await Promise.all([
    getTimerWorkspaceData(timeContext ? { timezone: timeContext.timezone } : undefined),
    getCurrentUser(),
  ]);
  const { tasks, openSessions, todayTaskBreakdown, todayTotalDurationSeconds, sessionHistory, taskTotalDurations } = workspaceData;
  const activeSession = openSessions[0] ?? null;
  const trackedTotalSeconds = Object.values(taskTotalDurations).reduce((sum, v) => sum + v, 0);
  return {
    actionError,
    actionSuccess,
    stoppedTaskId,
    ownerUserId: user?.id ?? null,
    timezone: timeContext?.timezone ?? null,
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
