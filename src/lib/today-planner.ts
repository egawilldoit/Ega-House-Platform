import { isTaskPinned } from "@/lib/focus-queue";
import { isTaskDueToday, isTaskOverdue } from "@/lib/task-due-date";
import { isTaskCompletedStatus } from "@/lib/task-domain";

export type TodayPlannerTask = {
  id: string;
  title: string;
  blocked_reason?: string | null;
  status: string;
  priority: string;
  focus_rank: number | null;
  due_date: string | null;
  estimate_minutes: number | null;
  updated_at: string;
  completed_at?: string | null;
  projectName: string;
  goalTitle: string | null;
  hasActiveSession?: boolean;
  trackedTodaySeconds?: number;
  completedToday?: boolean;
};

export type TodayPlannerData<T extends TodayPlannerTask = TodayPlannerTask> = {
  planned: T[];
  inProgress: T[];
  blocked: T[];
  completed: T[];
  all: T[];
};

function compareTodayTaskPriority(left: TodayPlannerTask, right: TodayPlannerTask) {
  const leftPinned = isTaskPinned(left.focus_rank);
  const rightPinned = isTaskPinned(right.focus_rank);

  if (leftPinned && rightPinned && left.focus_rank !== right.focus_rank) {
    return (left.focus_rank ?? 0) - (right.focus_rank ?? 0);
  }

  if (leftPinned !== rightPinned) {
    return leftPinned ? -1 : 1;
  }

  const leftDueCritical = Number(isTaskOverdue(left.due_date, left.status) || isTaskDueToday(left.due_date, left.status));
  const rightDueCritical = Number(isTaskOverdue(right.due_date, right.status) || isTaskDueToday(right.due_date, right.status));

  if (leftDueCritical !== rightDueCritical) {
    return rightDueCritical - leftDueCritical;
  }

  if (left.due_date && right.due_date && left.due_date !== right.due_date) {
    return left.due_date.localeCompare(right.due_date);
  }

  if (left.hasActiveSession !== right.hasActiveSession) {
    return left.hasActiveSession ? -1 : 1;
  }

  return right.updated_at.localeCompare(left.updated_at);
}

export function buildTodayPlanner<T extends TodayPlannerTask>(tasks: T[]): TodayPlannerData<T> {
  const buckets = tasks.reduce<TodayPlannerData<T>>(
    (result, task) => {
      if (isTaskCompletedStatus(task.status)) {
        if (task.completedToday) {
          result.completed.push(task);
          result.all.push(task);
        }
        return result;
      }

      const shouldIncludeOpenTask =
        task.status === "in_progress" ||
        task.status === "blocked" ||
        task.hasActiveSession === true ||
        (task.trackedTodaySeconds ?? 0) > 0 ||
        isTaskPinned(task.focus_rank) ||
        isTaskOverdue(task.due_date, task.status) ||
        isTaskDueToday(task.due_date, task.status);

      if (!shouldIncludeOpenTask) {
        return result;
      }

      if (task.status === "blocked") {
        result.blocked.push(task);
      } else if (task.status === "in_progress" || task.hasActiveSession) {
        result.inProgress.push(task);
      } else {
        result.planned.push(task);
      }

      result.all.push(task);
      return result;
    },
    {
      planned: [],
      inProgress: [],
      blocked: [],
      completed: [],
      all: [],
    },
  );

  buckets.planned.sort(compareTodayTaskPriority);
  buckets.inProgress.sort(compareTodayTaskPriority);
  buckets.blocked.sort(compareTodayTaskPriority);
  buckets.completed.sort((left, right) =>
    (right.completed_at ?? right.updated_at).localeCompare(left.completed_at ?? left.updated_at),
  );
  buckets.all.sort(compareTodayTaskPriority);

  return buckets;
}
