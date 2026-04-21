import { NextResponse } from "next/server";

import type {
  MobileApiErrorCode,
  MobileApiErrorResponse,
  MobileTaskListItem,
} from "@/lib/contracts/mobile";
import type { TaskRecord } from "@/lib/services/task-service";
import { isTaskDueToday, isTaskOverdue } from "@/lib/task-due-date";
import type { TaskStatus } from "@/lib/task-domain";

export function mobileErrorResponse(
  code: MobileApiErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>,
) {
  const payload: MobileApiErrorResponse = {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };

  return NextResponse.json(payload, { status });
}

export function mapTaskRecordToMobileTaskItem(
  task: TaskRecord,
  trackedDurationSeconds: number,
): MobileTaskListItem {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    blockedReason: task.blocked_reason,
    status: task.status as MobileTaskListItem["status"],
    priority: task.priority as MobileTaskListItem["priority"],
    dueDate: task.due_date,
    estimateMinutes: task.estimate_minutes,
    updatedAt: task.updated_at,
    focusRank: task.focus_rank,
    trackedDurationSeconds,
    project: {
      id: task.project_id,
      name: task.projects?.name ?? "Unknown project",
    },
    goal: task.goal_id
      ? {
          id: task.goal_id,
          title: task.goals?.title ?? "Unknown goal",
        }
      : null,
  };
}

export function getMobileTaskCounters(tasks: MobileTaskListItem[]) {
  const initialStatusCounts: Record<TaskStatus, number> = {
    todo: 0,
    in_progress: 0,
    done: 0,
    blocked: 0,
  };

  return tasks.reduce(
    (counters, task) => {
      counters.byStatus[task.status] += 1;
      counters.total += 1;
      if (task.focusRank !== null) {
        counters.pinned += 1;
      }
      if (isTaskOverdue(task.dueDate, task.status)) {
        counters.overdue += 1;
      }
      if (isTaskDueToday(task.dueDate, task.status)) {
        counters.dueToday += 1;
      }

      return counters;
    },
    {
      total: 0,
      byStatus: initialStatusCounts,
      pinned: 0,
      overdue: 0,
      dueToday: 0,
    },
  );
}
