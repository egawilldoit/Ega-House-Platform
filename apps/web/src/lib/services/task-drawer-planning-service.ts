import {
  getTaskById,
  getTaskRemindersForTasks,
  resolveSupabaseClient,
  type TaskRecurrenceRecord,
  type TaskReminderRecord,
} from "@/lib/services/task-service";
import { getIdeaNoteProjectOptions } from "@/lib/services/idea-note-service";

/**
 * Planning fields the task drawer edits outside the one-field patch path.
 *
 * `getTaskDrawerDetail` intentionally loads only the fields the drawer header
 * needs. Scheduling, recurrence and reminder rows keep their dedicated
 * services because they carry side effects, so this composition helper loads
 * them together for the drawer's planning section.
 */
export type TaskDrawerPlanning = {
  projectId: string | null;
  goalId: string | null;
  projectName: string | null;
  goalName: string | null;
  dueDate: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  calendarSyncEnabled: boolean;
  calendarReminderMinutes: number;
  recurrenceRule: TaskRecurrenceRecord["rule"] | null;
  reminders: TaskReminderRecord[];
  projectOptions: Array<{ id: string; name: string }>;
};

export async function getTaskDrawerPlanning(
  taskId: string,
): Promise<TaskDrawerPlanning | null> {
  const normalizedId = taskId.trim();
  if (!normalizedId) return null;

  const taskResult = await getTaskById(normalizedId);
  if (!taskResult.data) return null;

  let reminders: TaskReminderRecord[] = [];
  let projectOptions: Array<{ id: string; name: string }> = [];
  try {
    const supabase = await resolveSupabaseClient();
    const remindersByTaskId = await getTaskRemindersForTasks(supabase, [
      normalizedId,
    ]);
    reminders = remindersByTaskId[normalizedId] ?? [];
  } catch {
    // A reminder read failure must not hide the rest of the drawer. The
    // reminder panel will simply show no pending reminder until a refresh.
  }

  try {
    projectOptions = await getIdeaNoteProjectOptions();
  } catch {
    projectOptions = [];
  }

  const task = taskResult.data;
  return {
    projectId: task.project_id,
    goalId: task.goal_id,
    projectName: task.projects?.name ?? null,
    goalName: task.goals?.title ?? null,
    dueDate: task.due_date,
    scheduledStartAt: task.scheduled_start_at,
    scheduledEndAt: task.scheduled_end_at,
    calendarSyncEnabled: task.calendar_sync_enabled,
    calendarReminderMinutes: task.calendar_reminder_minutes,
    recurrenceRule: task.task_recurrences[0]?.rule ?? null,
    reminders,
    projectOptions,
  };
}
