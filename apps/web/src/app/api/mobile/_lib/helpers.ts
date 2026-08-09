import { NextResponse } from "next/server";

import type {
  MobileApiErrorCode,
  MobileApiErrorResponse,
  MobileTaskListItem,
} from "@/lib/contracts/mobile";
import { captureServerException } from "@/lib/monitoring/capture-server-exception";
import {
  getTaskById,
  getTaskRecurrencesForTasks,
  getTaskRemindersForTasks,
  type TaskRecord,
} from "@/lib/services/task-service";
import { isTaskDueToday, isTaskOverdue } from "@/lib/task-due-date";
import type { TaskStatus } from "@/lib/task-domain";

export function mobileErrorResponse(
  code: MobileApiErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>,
  options?: {
    cause?: unknown;
    route?: string;
    operation?: string;
    report?: boolean;
  },
) {
  const shouldReport = options?.report ?? status >= 500;
  if (shouldReport) {
    captureServerException(options?.cause ?? new Error(message), {
      area: "api.mobile",
      operation: options?.operation ?? "mobileErrorResponse",
      extras: {
        code,
        status,
        message,
        route: options?.route,
        details,
      },
    });
  }

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
    reminders: (task.task_reminders ?? []).map((reminder) => ({
      id: reminder.id,
      taskId: reminder.task_id,
      remindAt: reminder.remind_at,
      channel: reminder.channel,
      status: reminder.status,
      sentAt: reminder.sent_at,
      failureReason: reminder.failure_reason,
      createdAt: reminder.created_at,
      updatedAt: reminder.updated_at,
    })),
    recurrence: task.task_recurrences[0]
      ? {
          rule: task.task_recurrences[0].rule,
          anchorDate: task.task_recurrences[0].anchor_date,
          timezone: task.task_recurrences[0].timezone,
          nextOccurrenceDate: task.task_recurrences[0].next_occurrence_date,
          lastGeneratedAt: task.task_recurrences[0].last_generated_at,
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

export async function getMobileTaskItemById(
  supabase: Parameters<typeof getTaskRemindersForTasks>[0],
  taskId: string,
  trackedDurationSeconds = 0,
) {
  const taskResult = await getTaskById(taskId, { supabase });
  if (taskResult.errorMessage || !taskResult.data) {
    return {
      errorMessage: taskResult.errorMessage,
      data: null,
    };
  }

  try {
    const [remindersByTaskId, recurrencesByTaskId] = await Promise.all([
      getTaskRemindersForTasks(supabase, [taskResult.data.id]),
      getTaskRecurrencesForTasks(supabase, [taskResult.data.id]),
    ]);
    return {
      errorMessage: null,
      data: mapTaskRecordToMobileTaskItem(
        {
          ...taskResult.data,
          task_reminders: remindersByTaskId[taskResult.data.id] ?? [],
          task_recurrences: recurrencesByTaskId[taskResult.data.id] ?? [],
        },
        trackedDurationSeconds,
      ),
    };
  } catch (error) {
    captureServerException(error, {
      area: "api.mobile",
      operation: "getMobileTaskItemById",
      extras: {
        taskId,
      },
    });
    return {
      errorMessage: "Unable to load task detail metadata right now.",
      data: null,
    };
  }
}
