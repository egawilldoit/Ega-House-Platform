import { isTaskCompletedStatus } from "@/lib/task-domain";

type FocusQueueTask = {
  id: string;
  focus_rank: number | null;
  status: string;
  updated_at: string;
};

export function isTaskPinned(focusRank: number | null | undefined) {
  return typeof focusRank === "number" && Number.isFinite(focusRank);
}

export function sortFocusQueueTasks<T extends { focus_rank: number | null; updated_at: string }>(
  tasks: T[],
) {
  return tasks
    .filter((task) => isTaskPinned(task.focus_rank))
    .sort((left, right) => {
      const rankDelta = (left.focus_rank ?? 0) - (right.focus_rank ?? 0);

      if (rankDelta !== 0) {
        return rankDelta;
      }

      return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    });
}

export function getNextFocusQueueTaskId(tasks: FocusQueueTask[]) {
  const queue = sortFocusQueueTasks(tasks);

  const nextOpenTask = queue.find((task) => !isTaskCompletedStatus(task.status));
  return nextOpenTask?.id ?? queue[0]?.id ?? null;
}
