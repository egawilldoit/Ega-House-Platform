import { isTaskCompletedStatus } from "@/lib/task-domain";

type TimerTaskOption = {
  id: string;
  title: string;
  status: string;
};

export function isTaskCompletedForTimerStart(status: string | null | undefined) {
  return isTaskCompletedStatus(status);
}

export function getTimerStartTaskOptions<T extends TimerTaskOption>(tasks: readonly T[]) {
  return tasks.filter((task) => !isTaskCompletedForTimerStart(task.status));
}

export function getTimerStartEmptyStateCopy(totalTaskCount: number) {
  if (totalTaskCount > 0) {
    return "No active tasks available. Reopen a task to start a new session.";
  }

  return "No tasks available yet. Create a task to start tracking focused work.";
}
