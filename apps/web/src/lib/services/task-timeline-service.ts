import type { TimelineRange } from "@/lib/task-timeline";
import { createClient } from "@/lib/supabase/server";
import {
  getActiveTasksForOwner,
  type NormalizedTaskRow,
} from "@/lib/services/task-read-service";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type TimelineDependencyRow = Readonly<{
  taskId: string;
  blockedByTaskId: string;
}>;

export type TaskTimelineData = Readonly<{
  tasks: NormalizedTaskRow[];
  dependencies: TimelineDependencyRow[];
}>;

const TIMELINE_SCHEDULED_ROW_CAP = 300;
const TIMELINE_UNSCHEDULED_ROW_CAP = 120;
const TIMELINE_DEPENDENCY_ROW_CAP = 1000;

/**
 * Bounded, owner-scoped read for the timeline.
 *
 * Scheduled rows are limited to the visible window (a bar may span into the
 * window from either side). Tasks missing a start or due date are fetched
 * separately for the unscheduled list; they are never given fabricated dates.
 * RLS confines both queries to the authenticated owner.
 */
export async function getTaskTimelineData(input: {
  range: TimelineRange;
  supabase?: SupabaseServerClient;
}): Promise<TaskTimelineData> {
  const supabase = input.supabase ?? (await createClient());
  const { start, end } = input.range;
  const scheduledFilter = [
    `and(start_date.lte.${end},due_date.gte.${start})`,
    `and(start_date.gte.${start},start_date.lte.${end})`,
    `and(due_date.gte.${start},due_date.lte.${end})`,
  ].join(",");

  const [scheduledResult, unscheduledResult] = await Promise.all([
    getActiveTasksForOwner({
      supabase,
      archiveFilter: "active",
      orderByUpdatedAt: false,
      applyQuery: (query) =>
        query
          .or(scheduledFilter)
          .order("start_date", { ascending: true })
          .limit(TIMELINE_SCHEDULED_ROW_CAP),
    }),
    getActiveTasksForOwner({
      supabase,
      archiveFilter: "active",
      orderByUpdatedAt: false,
      applyQuery: (query) =>
        query
          .or("start_date.is.null,due_date.is.null")
          .order("due_date", { ascending: true })
          .limit(TIMELINE_UNSCHEDULED_ROW_CAP),
    }),
  ]);

  if (scheduledResult.errorMessage) {
    throw new Error(`Failed to load timeline tasks: ${scheduledResult.errorMessage}`);
  }
  if (unscheduledResult.errorMessage) {
    throw new Error(`Failed to load unscheduled tasks: ${unscheduledResult.errorMessage}`);
  }

  const taskById = new Map<string, NormalizedTaskRow>();
  for (const task of [...scheduledResult.data, ...unscheduledResult.data]) {
    taskById.set(task.id, task);
  }
  const tasks = [...taskById.values()];
  const taskIds = tasks.map((task) => task.id);

  if (taskIds.length === 0) {
    return { tasks: [], dependencies: [] };
  }

  const dependencyResult = await supabase
    .from("task_dependencies")
    .select("task_id,blocked_by_task_id")
    .in("task_id", taskIds)
    .limit(TIMELINE_DEPENDENCY_ROW_CAP);

  if (dependencyResult.error) {
    throw new Error(`Failed to load task dependencies: ${dependencyResult.error.message}`);
  }

  return {
    tasks,
    dependencies: (dependencyResult.data ?? []).map((row) => ({
      taskId: String(row.task_id),
      blockedByTaskId: String(row.blocked_by_task_id),
    })),
  };
}
