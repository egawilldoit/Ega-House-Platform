type TimerTaskOption = {
  id: string;
  title: string;
  status: string;
};

function normalizeStatus(status: string | null | undefined) {
  return String(status ?? "")
    .trim()
    .toLowerCase();
}

export function isTaskCompletedForTimerStart(status: string | null | undefined) {
  const normalized = normalizeStatus(status);
  return normalized === "done" || normalized === "complete" || normalized === "completed";
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
